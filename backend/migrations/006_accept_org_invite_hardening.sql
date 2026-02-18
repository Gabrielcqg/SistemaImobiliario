-- ============================================================
-- MIGRATION: Harden invite acceptance RPC + compatibility alias
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_organization_invite(p_token text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_token uuid;
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_invite public.organization_invites%ROWTYPE;
  v_org_name text;
  v_existing_role text;
  v_existing_status text;
  v_effective_seats integer;
  v_active_members integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'not_authenticated',
      DETAIL = 'Authentication is required to accept an organization invite.';
  END IF;

  BEGIN
    v_token := nullif(trim(coalesce(p_token, '')), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_invalid_or_expired',
      DETAIL = 'Invite token is invalid or malformed.';
  END;

  SELECT *
    INTO v_invite
  FROM public.organization_invites i
  WHERE i.invite_token = v_token
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_invalid_or_expired',
      DETAIL = 'Invite token was not found.';
  END IF;

  IF v_invite.status = 'accepted'
     AND coalesce(v_invite.accepted_by, v_user_id) <> v_user_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_invalid_or_expired',
      DETAIL = 'Invite token was already accepted by another user.';
  END IF;

  IF v_invite.status <> 'pending'
     AND NOT (
       v_invite.status = 'accepted'
       AND coalesce(v_invite.accepted_by, v_user_id) = v_user_id
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_invalid_or_expired',
      DETAIL = format(
        'Invite token is not pending (status=%s).',
        coalesce(v_invite.status, 'null')
      );
  END IF;

  IF v_invite.status = 'pending'
     AND v_invite.expires_at IS NOT NULL
     AND v_invite.expires_at <= now() THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_invalid_or_expired',
      DETAIL = 'Invite token is expired.';
  END IF;

  IF coalesce(lower(v_invite.email), '') <> ''
     AND v_user_email <> ''
     AND lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION USING
      MESSAGE = 'invite_email_mismatch',
      DETAIL = format(
        'Invite email (%s) does not match authenticated email (%s).',
        lower(v_invite.email),
        v_user_email
      );
  END IF;

  SELECT m.role, m.status
    INTO v_existing_role, v_existing_status
  FROM public.organization_members m
  WHERE m.organization_id = v_invite.organization_id
    AND m.user_id = v_user_id
  LIMIT 1;

  IF v_existing_role IS NULL OR coalesce(v_existing_status, 'disabled') <> 'active' THEN
    SELECT coalesce(s.seats_total, o.seats_total, 1)
      INTO v_effective_seats
    FROM public.organizations o
    LEFT JOIN public.organization_subscriptions s
      ON s.org_id = o.id
    WHERE o.id = v_invite.organization_id
    FOR UPDATE;

    SELECT count(*)
      INTO v_active_members
    FROM public.organization_members m
    WHERE m.organization_id = v_invite.organization_id
      AND m.status = 'active';

    IF v_effective_seats IS NULL OR v_effective_seats < 1 THEN
      v_effective_seats := 1;
    END IF;

    IF v_active_members >= v_effective_seats THEN
      RAISE EXCEPTION USING
        MESSAGE = 'no_seats_available',
        DETAIL = format(
          'Organization %s reached seat limit (%s/%s).',
          v_invite.organization_id,
          v_active_members,
          v_effective_seats
        );
    END IF;

    BEGIN
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (v_invite.organization_id, v_user_id, v_invite.role, 'active')
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        status = 'active'
      RETURNING organization_members.role, organization_members.status
      INTO v_existing_role, v_existing_status;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM ILIKE '%No seats available%' THEN
          RAISE EXCEPTION USING
            MESSAGE = 'no_seats_available',
            DETAIL = SQLERRM;
        END IF;
        RAISE;
    END;
  END IF;

  IF v_invite.status = 'pending' THEN
    UPDATE public.organization_invites
    SET
      status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = now(),
      revoked_at = NULL
    WHERE id = v_invite.id;
  ELSE
    UPDATE public.organization_invites
    SET
      accepted_by = coalesce(accepted_by, v_user_id),
      accepted_at = coalesce(accepted_at, now()),
      revoked_at = NULL
    WHERE id = v_invite.id;
  END IF;

  PERFORM public.refresh_subscription_seats_used(v_invite.organization_id);

  SELECT o.name
    INTO v_org_name
  FROM public.organizations o
  WHERE o.id = v_invite.organization_id;

  RETURN QUERY
  SELECT v_invite.organization_id, v_org_name, coalesce(v_existing_role, v_invite.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_org_invite(_token text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT organization_id, organization_name, role
  FROM public.accept_organization_invite(_token);
$$;

REVOKE ALL ON FUNCTION public.accept_organization_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.accept_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_org_invite(text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT m.organization_id
  FROM public.organization_members m
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
  ORDER BY m.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_org_id()
  TO authenticated, service_role;

COMMIT;

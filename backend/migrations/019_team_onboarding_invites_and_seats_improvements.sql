-- ============================================================
-- MIGRATION: Team onboarding invite clarity + seat expansion
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_organization_invite(p_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT organization_id
    INTO v_org_id
  FROM public.organization_invites
  WHERE id = p_invite_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = v_org_id
      AND m.user_id = v_actor
      AND m.status = 'active'
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not allowed to revoke invites.';
  END IF;

  UPDATE public.organization_invites
  SET
    status = 'revoked',
    revoked_at = now(),
    expires_at = now(),
    accepted_by = NULL,
    accepted_at = NULL
  WHERE id = p_invite_id
    AND status = 'pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_organization_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invite(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.increase_organization_seats(
  p_organization_id uuid,
  p_additional_seats integer DEFAULT 1
)
RETURNS TABLE (
  organization_id uuid,
  seats_total integer,
  seats_used integer,
  pending_invites integer,
  seats_available integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current_seats integer;
  v_new_seats integer;
  v_seats_used integer;
  v_pending_invites integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required.';
  END IF;

  IF coalesce(p_additional_seats, 0) < 1 THEN
    RAISE EXCEPTION 'additional_seats_must_be_positive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_actor
      AND m.status = 'active'
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not allowed to change seats.';
  END IF;

  SELECT o.seats_total
    INTO v_current_seats
  FROM public.organizations o
  WHERE o.id = p_organization_id
  FOR UPDATE;

  IF v_current_seats IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  v_new_seats := greatest(1, v_current_seats + p_additional_seats);

  UPDATE public.organizations o
  SET seats_total = v_new_seats
  WHERE o.id = p_organization_id;

  INSERT INTO public.organization_subscriptions (org_id, seats_total)
  VALUES (p_organization_id, v_new_seats)
  ON CONFLICT (org_id)
  DO UPDATE SET seats_total = EXCLUDED.seats_total;

  SELECT count(*)::integer
    INTO v_seats_used
  FROM public.organization_members m
  WHERE m.organization_id = p_organization_id
    AND m.status = 'active';

  SELECT count(*)::integer
    INTO v_pending_invites
  FROM public.organization_invites i
  WHERE i.organization_id = p_organization_id
    AND i.status = 'pending'
    AND (i.expires_at IS NULL OR i.expires_at > now());

  PERFORM public.refresh_subscription_seats_used(p_organization_id);

  RETURN QUERY
  SELECT
    p_organization_id,
    v_new_seats,
    coalesce(v_seats_used, 0),
    coalesce(v_pending_invites, 0),
    greatest(0, v_new_seats - (coalesce(v_seats_used, 0) + coalesce(v_pending_invites, 0)));
END;
$$;

REVOKE ALL ON FUNCTION public.increase_organization_seats(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increase_organization_seats(uuid, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_bootstrap_context()
RETURNS TABLE (
  active_org_id uuid,
  org_name text,
  org_kind text,
  my_role text,
  memberships_count integer,
  needs_org_choice boolean,
  seats_total integer,
  members_used integer,
  pending_invites integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_active_org_id uuid;
  v_org_name text;
  v_org_kind text;
  v_my_role text;
  v_memberships_count integer := 0;
  v_needs_org_choice boolean := false;
  v_seats_total integer := 0;
  v_members_used integer := 0;
  v_pending_invites integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT count(distinct m.organization_id)::integer
    INTO v_memberships_count
  FROM public.organization_members m
  WHERE m.user_id = v_user_id
    AND m.status = 'active';

  SELECT p.active_organization_id
    INTO v_active_org_id
  FROM public.profiles p
  WHERE p.id = v_user_id
  LIMIT 1;

  IF v_active_org_id IS NOT NULL THEN
    SELECT
      o.name,
      o.kind::text,
      m.role::text,
      coalesce(s.seats_total, o.seats_total, 0)
      INTO v_org_name, v_org_kind, v_my_role, v_seats_total
    FROM public.organization_members m
    INNER JOIN public.organizations o
      ON o.id = m.organization_id
    LEFT JOIN public.organization_subscriptions s
      ON s.org_id = o.id
    WHERE m.user_id = v_user_id
      AND m.organization_id = v_active_org_id
      AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF v_org_name IS NULL OR v_my_role IS NULL THEN
      v_active_org_id := NULL;
      v_org_name := NULL;
      v_org_kind := NULL;
      v_my_role := NULL;
      v_seats_total := 0;
    END IF;
  END IF;

  IF v_active_org_id IS NULL AND v_memberships_count = 1 THEN
    SELECT
      m.organization_id,
      o.name,
      o.kind::text,
      m.role::text,
      coalesce(s.seats_total, o.seats_total, 0)
      INTO v_active_org_id, v_org_name, v_org_kind, v_my_role, v_seats_total
    FROM public.organization_members m
    INNER JOIN public.organizations o
      ON o.id = m.organization_id
    LEFT JOIN public.organization_subscriptions s
      ON s.org_id = o.id
    WHERE m.user_id = v_user_id
      AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF v_active_org_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, active_organization_id)
      VALUES (v_user_id, v_active_org_id)
      ON CONFLICT (id)
      DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
    END IF;
  ELSIF v_active_org_id IS NULL AND v_memberships_count > 1 THEN
    v_needs_org_choice := true;
  END IF;

  IF v_active_org_id IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_members_used
    FROM public.organization_members m
    WHERE m.organization_id = v_active_org_id
      AND m.status = 'active';

    SELECT count(*)::integer
      INTO v_pending_invites
    FROM public.organization_invites i
    WHERE i.organization_id = v_active_org_id
      AND i.status = 'pending'
      AND (i.expires_at IS NULL OR i.expires_at > now());
  END IF;

  RETURN QUERY
  SELECT
    v_active_org_id,
    v_org_name,
    v_org_kind,
    v_my_role,
    v_memberships_count,
    v_needs_org_choice,
    coalesce(v_seats_total, 0),
    coalesce(v_members_used, 0),
    coalesce(v_pending_invites, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_bootstrap_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bootstrap_context()
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

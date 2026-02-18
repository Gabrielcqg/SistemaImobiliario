-- ============================================================
-- MIGRATION: Org security, seats, invitation hardening, session limits and org scoping
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------
-- 1) Organization member/invite hardening
-- -----------------------------------------------------------------
ALTER TABLE IF EXISTS public.organization_members
  ADD COLUMN IF NOT EXISTS status text;

UPDATE public.organization_members
SET status = 'active'
WHERE status IS NULL;

ALTER TABLE IF EXISTS public.organization_members
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE IF EXISTS public.organization_members
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE IF EXISTS public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_status_check;

ALTER TABLE IF EXISTS public.organization_members
  ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('active', 'invited', 'disabled'));

CREATE INDEX IF NOT EXISTS idx_organization_members_org_status
  ON public.organization_members(organization_id, status);

-- -----------------------------------------------------------------
-- 1.1) Non-recursive ownership helper + organization_members RLS
-- -----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_org_owner(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_org_owner(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.is_org_owner(
  p_org_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.owner_user_id = coalesce(p_user_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid)
  TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY';

    -- Legacy policies from 004 and previous iterations.
    EXECUTE 'DROP POLICY IF EXISTS organization_members_select_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_insert_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_update_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_delete_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_select_own_or_owner_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_insert_owner_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_update_owner_policy ON public.organization_members';
    EXECUTE 'DROP POLICY IF EXISTS organization_members_delete_owner_policy ON public.organization_members';

    EXECUTE $policy$
      CREATE POLICY organization_members_select_own_or_owner_policy
      ON public.organization_members
      FOR SELECT
      TO authenticated
      USING (
        organization_members.user_id = auth.uid()
        OR public.is_org_owner(organization_members.organization_id)
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY organization_members_insert_owner_policy
      ON public.organization_members
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.is_org_owner(organization_members.organization_id)
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY organization_members_update_owner_policy
      ON public.organization_members
      FOR UPDATE
      TO authenticated
      USING (
        public.is_org_owner(organization_members.organization_id)
      )
      WITH CHECK (
        public.is_org_owner(organization_members.organization_id)
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY organization_members_delete_owner_policy
      ON public.organization_members
      FOR DELETE
      TO authenticated
      USING (
        public.is_org_owner(organization_members.organization_id)
      )
    $policy$;
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.organization_invites
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE IF EXISTS public.organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_contact_check;

ALTER TABLE IF EXISTS public.organization_invites
  ADD CONSTRAINT organization_invites_contact_check
  CHECK (
    nullif(trim(coalesce(email, '')), '') IS NOT NULL
    OR nullif(trim(coalesce(phone, '')), '') IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.touch_organization_invites_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_organization_invites_updated_at ON public.organization_invites;
CREATE TRIGGER trg_touch_organization_invites_updated_at
  BEFORE UPDATE ON public.organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_organization_invites_updated_at();

CREATE OR REPLACE FUNCTION public.normalize_invitation_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(trim(NEW.email));
    IF NEW.email = '' THEN
      NEW.email := NULL;
    END IF;
  END IF;

  IF NEW.phone IS NOT NULL THEN
    NEW.phone := regexp_replace(trim(NEW.phone), '[^0-9+]', '', 'g');
    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_invitation_contact ON public.organization_invites;
CREATE TRIGGER trg_normalize_invitation_contact
  BEFORE INSERT OR UPDATE ON public.organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_invitation_contact();

-- -----------------------------------------------------------------
-- 2) Subscriptions / seats snapshot
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  seats_total integer NOT NULL CHECK (seats_total >= 1),
  seats_used integer NOT NULL DEFAULT 0 CHECK (seats_used >= 0),
  plan_code text NOT NULL DEFAULT 'starter',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_organization_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_organization_subscriptions_updated_at ON public.organization_subscriptions;
CREATE TRIGGER trg_touch_organization_subscriptions_updated_at
  BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_organization_subscriptions_updated_at();

CREATE OR REPLACE FUNCTION public.sync_subscription_from_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.organization_subscriptions (org_id, seats_total)
  VALUES (NEW.id, NEW.seats_total)
  ON CONFLICT (org_id)
  DO UPDATE SET seats_total = EXCLUDED.seats_total;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_subscription_from_organization ON public.organizations;
CREATE TRIGGER trg_sync_subscription_from_organization
  AFTER INSERT OR UPDATE OF seats_total ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subscription_from_organization();

CREATE OR REPLACE FUNCTION public.refresh_subscription_seats_used(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.organization_subscriptions s
  SET seats_used = (
    SELECT count(*)
    FROM public.organization_members m
    WHERE m.organization_id = p_org_id
      AND m.status = 'active'
  )
  WHERE s.org_id = p_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_subscription_seats_used_from_members()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := coalesce(NEW.organization_id, OLD.organization_id);
  PERFORM public.refresh_subscription_seats_used(v_org_id);
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_subscription_seats_used_from_members ON public.organization_members;
CREATE TRIGGER trg_sync_subscription_seats_used_from_members
  AFTER INSERT OR UPDATE OF status, organization_id OR DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subscription_seats_used_from_members();

INSERT INTO public.organization_subscriptions (org_id, seats_total, seats_used)
SELECT
  o.id,
  o.seats_total,
  COALESCE((
    SELECT count(*)
    FROM public.organization_members m
    WHERE m.organization_id = o.id
      AND m.status = 'active'
  ), 0)
FROM public.organizations o
ON CONFLICT (org_id)
DO UPDATE SET
  seats_total = EXCLUDED.seats_total,
  seats_used = EXCLUDED.seats_used;

-- -----------------------------------------------------------------
-- 3) Replace seat-limit triggers with status-aware versions
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_organization_membership_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_seats integer;
  v_members_count integer;
BEGIN
  IF coalesce(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT kind, seats_total
    INTO v_kind, v_seats
  FROM public.organizations
  WHERE id = NEW.organization_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  SELECT count(*)
    INTO v_members_count
  FROM public.organization_members
  WHERE organization_id = NEW.organization_id
    AND status = 'active';

  IF TG_OP = 'UPDATE'
     AND OLD.organization_id = NEW.organization_id
     AND coalesce(OLD.status, 'active') = 'active' THEN
    v_members_count := greatest(v_members_count - 1, 0);
  END IF;

  IF v_kind = 'individual' AND v_members_count >= 1 THEN
    RAISE EXCEPTION 'Individual account allows only one active member.';
  END IF;

  IF v_members_count >= v_seats THEN
    RAISE EXCEPTION 'No seats available in this organization.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_organization_membership_limits ON public.organization_members;
CREATE TRIGGER trg_enforce_organization_membership_limits
  BEFORE INSERT OR UPDATE OF status, organization_id ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_organization_membership_limits();

CREATE OR REPLACE FUNCTION public.enforce_organization_invite_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_seats integer;
  v_members_count integer;
  v_pending_count integer;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT kind, seats_total
    INTO v_kind, v_seats
  FROM public.organizations
  WHERE id = NEW.organization_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  IF v_kind = 'individual' THEN
    RAISE EXCEPTION 'Individual account does not allow invites.';
  END IF;

  SELECT count(*)
    INTO v_members_count
  FROM public.organization_members
  WHERE organization_id = NEW.organization_id
    AND status = 'active';

  SELECT count(*)
    INTO v_pending_count
  FROM public.organization_invites
  WHERE organization_id = NEW.organization_id
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now());

  IF TG_OP = 'UPDATE'
     AND OLD.organization_id = NEW.organization_id
     AND OLD.status = 'pending' THEN
    v_pending_count := greatest(v_pending_count - 1, 0);
  END IF;

  IF (v_members_count + v_pending_count) >= v_seats THEN
    RAISE EXCEPTION 'No seats available for new invites.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_organization_invite_limits ON public.organization_invites;
CREATE TRIGGER trg_enforce_organization_invite_limits
  BEFORE INSERT OR UPDATE OF status, organization_id ON public.organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_organization_invite_limits();

-- -----------------------------------------------------------------
-- 4) Invitation RPCs (create/revoke/preview/accept)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_invites(
  p_organization_id uuid,
  p_emails text[],
  p_role text DEFAULT 'member',
  p_expires_in_days integer DEFAULT 7
)
RETURNS TABLE (
  email text,
  status text,
  invite_token uuid,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_role text := lower(coalesce(p_role, 'member'));
  v_invite public.organization_invites%ROWTYPE;
  v_access_allowed boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'member') THEN
    v_role := 'member';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_actor
      AND m.status = 'active'
      AND m.role IN ('owner', 'admin')
  )
  INTO v_access_allowed;

  IF NOT v_access_allowed THEN
    RAISE EXCEPTION 'Not allowed to invite members.';
  END IF;

  FOREACH v_email IN ARRAY coalesce(p_emails, ARRAY[]::text[])
  LOOP
    v_email := lower(trim(coalesce(v_email, '')));

    IF v_email = '' OR position('@' IN v_email) = 0 THEN
      email := v_email;
      status := 'invalid';
      invite_token := NULL;
      message := 'E-mail invalido.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.organization_members m
      INNER JOIN auth.users u
        ON u.id = m.user_id
      WHERE m.organization_id = p_organization_id
        AND m.status = 'active'
        AND lower(coalesce(u.email, '')) = v_email
    ) THEN
      email := v_email;
      status := 'already_member';
      invite_token := NULL;
      message := 'Este e-mail ja pertence a organizacao.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT *
      INTO v_invite
    FROM public.organization_invites i
    WHERE i.organization_id = p_organization_id
      AND lower(coalesce(i.email, '')) = v_email
      AND i.status = 'pending'
      AND (i.expires_at IS NULL OR i.expires_at > now())
    ORDER BY i.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_invite.id IS NOT NULL THEN
      UPDATE public.organization_invites
      SET
        role = v_role,
        invited_by = v_actor,
        status = 'pending',
        revoked_at = NULL,
        accepted_by = NULL,
        accepted_at = NULL,
        expires_at = now() + make_interval(days => greatest(1, p_expires_in_days))
      WHERE id = v_invite.id
      RETURNING * INTO v_invite;

      email := v_email;
      status := 'resent';
      invite_token := v_invite.invite_token;
      message := 'Convite reenviado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.organization_invites (
        organization_id,
        email,
        role,
        status,
        invited_by,
        expires_at
      )
      VALUES (
        p_organization_id,
        v_email,
        v_role,
        'pending',
        v_actor,
        now() + make_interval(days => greatest(1, p_expires_in_days))
      )
      RETURNING * INTO v_invite;

      email := v_email;
      status := 'invited';
      invite_token := v_invite.invite_token;
      message := 'Convite enviado.';
      RETURN NEXT;
    EXCEPTION
      WHEN OTHERS THEN
        email := v_email;
        invite_token := NULL;
        IF SQLERRM ILIKE '%No seats available%' THEN
          status := 'no_seat';
          message := 'Sem assentos disponiveis para convidar.';
        ELSIF SQLERRM ILIKE '%Individual account does not allow invites%' THEN
          status := 'not_allowed';
          message := 'Conta individual nao permite convites.';
        ELSE
          status := 'error';
          message := SQLERRM;
        END IF;
        RETURN NEXT;
    END;
  END LOOP;

  RETURN;
END;
$$;

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
    accepted_by = NULL,
    accepted_at = NULL
  WHERE id = p_invite_id
    AND status = 'pending';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_invite_preview(p_token text)
RETURNS TABLE (
  invite_id uuid,
  organization_id uuid,
  organization_name text,
  invite_email text,
  invite_role text,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT
    i.id,
    i.organization_id,
    o.name,
    i.email,
    i.role,
    i.expires_at
  FROM public.organization_invites i
  INNER JOIN public.organizations o
    ON o.id = i.organization_id
  WHERE i.invite_token = v_token
    AND i.status = 'pending'
    AND (i.expires_at IS NULL OR i.expires_at > now())
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_organization_invite(p_token text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid;
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_invite public.organization_invites%ROWTYPE;
  v_org_name text;
  v_existing_role text;
  v_existing_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid invite token.';
  END;

  SELECT *
    INTO v_invite
  FROM public.organization_invites
  WHERE invite_token = v_token
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite is invalid or expired.';
  END IF;

  IF coalesce(lower(v_invite.email), '') <> ''
     AND v_user_email <> ''
     AND lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'Invite e-mail does not match the authenticated user.';
  END IF;

  SELECT m.role, m.status
    INTO v_existing_role, v_existing_status
  FROM public.organization_members m
  WHERE m.organization_id = v_invite.organization_id
    AND m.user_id = v_user_id
  LIMIT 1;

  IF v_existing_role IS NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_invite.organization_id, v_user_id, v_invite.role, 'active');
    v_existing_role := v_invite.role;
    v_existing_status := 'active';
  ELSIF v_existing_status <> 'active' THEN
    UPDATE public.organization_members
    SET
      role = v_invite.role,
      status = 'active'
    WHERE organization_id = v_invite.organization_id
      AND user_id = v_user_id;
    v_existing_role := v_invite.role;
    v_existing_status := 'active';
  END IF;

  UPDATE public.organization_invites
  SET
    status = 'accepted',
    accepted_by = v_user_id,
    accepted_at = now(),
    revoked_at = NULL
  WHERE id = v_invite.id;

  PERFORM public.refresh_subscription_seats_used(v_invite.organization_id);

  SELECT name
    INTO v_org_name
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  RETURN QUERY
  SELECT v_invite.organization_id, v_org_name, v_existing_role;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invites(uuid, text[], text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_invites(uuid, text[], text, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_organization_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invite(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_organization_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_invite_preview(text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.accept_organization_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------
-- 5) Session/device tracking with anti-sharing controls
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  device_fingerprint text NOT NULL,
  user_agent text,
  platform text,
  last_ip inet,
  token_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_device_sessions_user_id
  ON public.user_device_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_device_sessions_org_id
  ON public.user_device_sessions(organization_id);

CREATE INDEX IF NOT EXISTS idx_user_device_sessions_active
  ON public.user_device_sessions(user_id, last_seen_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_device_sessions_select_own_policy ON public.user_device_sessions;
CREATE POLICY user_device_sessions_select_own_policy
ON public.user_device_sessions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_sessions_insert_own_policy ON public.user_device_sessions;
CREATE POLICY user_device_sessions_insert_own_policy
ON public.user_device_sessions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_sessions_update_own_policy ON public.user_device_sessions;
CREATE POLICY user_device_sessions_update_own_policy
ON public.user_device_sessions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_device_sessions_delete_own_policy ON public.user_device_sessions;
CREATE POLICY user_device_sessions_delete_own_policy
ON public.user_device_sessions
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.organization_id
  FROM public.organization_members m
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_org_id()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bootstrap_personal_org_for_user(
  p_user_id uuid,
  p_email text DEFAULT NULL,
  p_full_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_workspace_name text;
  v_email text := lower(coalesce(p_email, ''));
  v_full_name text := nullif(trim(coalesce(p_full_name, '')), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required.';
  END IF;

  -- Serializa por usuario para manter a criacao idempotente em concorrencia.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT m.organization_id
    INTO v_org_id
  FROM public.organization_members m
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  SELECT o.id
    INTO v_org_id
  FROM public.organizations o
  WHERE o.owner_user_id = p_user_id
    AND o.kind = 'individual'
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    v_workspace_name := CASE
      WHEN v_full_name IS NOT NULL THEN format('Workspace pessoal de %s', v_full_name)
      WHEN nullif(trim(coalesce(v_email, '')), '') IS NOT NULL THEN format('Workspace pessoal (%s)', v_email)
      ELSE 'Workspace pessoal'
    END;

    INSERT INTO public.organizations (kind, name, owner_user_id, seats_total)
    VALUES ('individual', v_workspace_name, p_user_id, 1)
    RETURNING id INTO v_org_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = v_org_id
      AND m.user_id = p_user_id
  ) THEN
    UPDATE public.organization_members
    SET
      role = 'owner',
      status = 'active'
    WHERE organization_id = v_org_id
      AND user_id = p_user_id;
  ELSE
    INSERT INTO public.organization_members (
      organization_id,
      user_id,
      role,
      status
    )
    VALUES (
      v_org_id,
      p_user_id,
      'owner',
      'active'
    );
  END IF;

  PERFORM public.refresh_subscription_seats_used(v_org_id);

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_personal_org_for_user(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_personal_org_for_user(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_personal_org()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT
    lower(coalesce(u.email, '')),
    nullif(
      trim(
        coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'onboarding_full_name',
          ''
        )
      ),
      ''
    )
    INTO v_email, v_full_name
  FROM auth.users u
  WHERE u.id = v_user_id
  LIMIT 1;

  RETURN public.bootstrap_personal_org_for_user(v_user_id, v_email, v_full_name);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_personal_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_personal_org()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_auth_user_personal_org_bootstrap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_type text;
  v_full_name text;
BEGIN
  v_account_type := lower(
    coalesce(
      NEW.raw_user_meta_data ->> 'onboarding_account_type',
      'individual'
    )
  );

  IF v_account_type IN ('brokerage', 'join') THEN
    RETURN NEW;
  END IF;

  v_full_name := coalesce(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'onboarding_full_name',
    NULL
  );

  PERFORM public.bootstrap_personal_org_for_user(
    NEW.id,
    NEW.email,
    v_full_name
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_users_bootstrap_personal_org ON auth.users;
CREATE TRIGGER trg_auth_users_bootstrap_personal_org
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_personal_org_bootstrap();

CREATE OR REPLACE FUNCTION public.register_user_device_session(
  p_fingerprint text,
  p_user_agent text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_last_ip text DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS TABLE (
  status text,
  message text,
  active_count integer,
  session_limit integer,
  organization_kind text,
  organization_id uuid,
  should_sign_out_others boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_org_kind text := 'individual';
  v_limit integer := 1;
  v_active_count integer := 0;
  v_ip inet;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_fingerprint IS NULL OR trim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'Device fingerprint is required.';
  END IF;

  BEGIN
    IF nullif(trim(coalesce(p_last_ip, '')), '') IS NOT NULL THEN
      v_ip := p_last_ip::inet;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  SELECT m.organization_id, o.kind
    INTO v_org_id, v_org_kind
  FROM public.organization_members m
  INNER JOIN public.organizations o
    ON o.id = m.organization_id
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  IF v_org_kind = 'brokerage' THEN
    v_limit := 2;
  ELSE
    v_limit := 1;
  END IF;

  INSERT INTO public.user_device_sessions (
    user_id,
    organization_id,
    device_fingerprint,
    user_agent,
    platform,
    last_ip,
    token_hash,
    created_at,
    last_seen_at,
    revoked_at,
    revoked_reason
  )
  VALUES (
    v_user_id,
    v_org_id,
    trim(p_fingerprint),
    p_user_agent,
    p_platform,
    v_ip,
    CASE
      WHEN nullif(coalesce(p_session_token, ''), '') IS NULL THEN NULL
      ELSE encode(digest(p_session_token, 'sha256'), 'hex')
    END,
    now(),
    now(),
    NULL,
    NULL
  )
  ON CONFLICT (user_id, device_fingerprint)
  DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    user_agent = EXCLUDED.user_agent,
    platform = EXCLUDED.platform,
    last_ip = EXCLUDED.last_ip,
    token_hash = EXCLUDED.token_hash,
    last_seen_at = now(),
    revoked_at = NULL,
    revoked_reason = NULL;

  SELECT count(*)
    INTO v_active_count
  FROM public.user_device_sessions s
  WHERE s.user_id = v_user_id
    AND s.revoked_at IS NULL
    AND s.last_seen_at > (now() - interval '30 days');

  IF v_org_kind = 'individual' AND v_active_count > v_limit THEN
    UPDATE public.user_device_sessions
    SET
      revoked_at = now(),
      revoked_reason = 'replaced_by_new_login'
    WHERE user_id = v_user_id
      AND device_fingerprint <> trim(p_fingerprint)
      AND revoked_at IS NULL;

    status := 'ok';
    message := 'Sessao anterior revogada por seguranca.';
    active_count := 1;
    session_limit := v_limit;
    organization_kind := v_org_kind;
    organization_id := v_org_id;
    should_sign_out_others := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_org_kind = 'brokerage' AND v_active_count > v_limit THEN
    UPDATE public.user_device_sessions
    SET
      revoked_at = now(),
      revoked_reason = 'session_limit_exceeded'
    WHERE user_id = v_user_id
      AND device_fingerprint = trim(p_fingerprint);

    status := 'limit_exceeded';
    message := 'Limite de dispositivos atingido para esta conta.';
    active_count := v_active_count;
    session_limit := v_limit;
    organization_kind := v_org_kind;
    organization_id := v_org_id;
    should_sign_out_others := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  status := 'ok';
  message := 'Sessao registrada com sucesso.';
  active_count := v_active_count;
  session_limit := v_limit;
  organization_kind := v_org_kind;
  organization_id := v_org_id;
  should_sign_out_others := FALSE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_user_device_session(
  p_fingerprint text,
  p_session_token text DEFAULT NULL
)
RETURNS TABLE (
  is_revoked boolean,
  revoked_reason text,
  active_count integer,
  session_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := 1;
  v_kind text := 'individual';
  v_revoked_at timestamptz;
  v_revoked_reason text;
  v_active_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_fingerprint IS NULL OR trim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'Device fingerprint is required.';
  END IF;

  UPDATE public.user_device_sessions
  SET
    last_seen_at = now(),
    token_hash = CASE
      WHEN nullif(coalesce(p_session_token, ''), '') IS NULL THEN token_hash
      ELSE encode(digest(p_session_token, 'sha256'), 'hex')
    END
  WHERE user_id = v_user_id
    AND device_fingerprint = trim(p_fingerprint)
  RETURNING revoked_at, revoked_reason
  INTO v_revoked_at, v_revoked_reason;

  IF NOT FOUND THEN
    INSERT INTO public.user_device_sessions (
      user_id,
      organization_id,
      device_fingerprint,
      token_hash,
      created_at,
      last_seen_at
    )
    VALUES (
      v_user_id,
      public.current_user_org_id(),
      trim(p_fingerprint),
      CASE
        WHEN nullif(coalesce(p_session_token, ''), '') IS NULL THEN NULL
        ELSE encode(digest(p_session_token, 'sha256'), 'hex')
      END,
      now(),
      now()
    )
    RETURNING revoked_at, revoked_reason
    INTO v_revoked_at, v_revoked_reason;
  END IF;

  SELECT o.kind
    INTO v_kind
  FROM public.organization_members m
  INNER JOIN public.organizations o
    ON o.id = m.organization_id
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  IF v_kind = 'brokerage' THEN
    v_limit := 2;
  ELSE
    v_limit := 1;
  END IF;

  SELECT count(*)
    INTO v_active_count
  FROM public.user_device_sessions s
  WHERE s.user_id = v_user_id
    AND s.revoked_at IS NULL
    AND s.last_seen_at > (now() - interval '30 days');

  is_revoked := v_revoked_at IS NOT NULL;
  revoked_reason := v_revoked_reason;
  active_count := v_active_count;
  session_limit := v_limit;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.register_user_device_session(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_user_device_session(text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.touch_user_device_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_device_session(text, text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------
-- 6) org_id scoping and audit columns (CRM + listings)
-- -----------------------------------------------------------------
ALTER TABLE IF EXISTS public.clients
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.client_filters
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.automated_matches
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.listings
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_clients_org_id ON public.clients(org_id);
  END IF;

  IF to_regclass('public.client_filters') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_client_filters_org_id ON public.client_filters(org_id);
  END IF;

  IF to_regclass('public.automated_matches') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_automated_matches_org_id ON public.automated_matches(org_id);
  END IF;

  IF to_regclass('public.listings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_listings_org_id ON public.listings(org_id);
  END IF;
END;
$$;

WITH first_org AS (
  SELECT DISTINCT ON (m.user_id)
    m.user_id,
    m.organization_id
  FROM public.organization_members m
  WHERE m.status = 'active'
  ORDER BY m.user_id, m.created_at ASC
)
UPDATE public.clients c
SET
  org_id = fo.organization_id,
  created_by = coalesce(c.created_by, c.user_id),
  updated_by = coalesce(c.updated_by, c.user_id)
FROM first_org fo
WHERE c.org_id IS NULL
  AND c.user_id = fo.user_id;

UPDATE public.client_filters cf
SET
  org_id = c.org_id,
  created_by = coalesce(cf.created_by, c.user_id),
  updated_by = coalesce(cf.updated_by, c.user_id)
FROM public.clients c
WHERE cf.org_id IS NULL
  AND cf.client_id = c.id;

UPDATE public.automated_matches am
SET
  org_id = c.org_id,
  created_by = coalesce(am.created_by, c.user_id),
  updated_by = coalesce(am.updated_by, c.user_id)
FROM public.clients c
WHERE am.org_id IS NULL
  AND am.client_id = c.id;

CREATE OR REPLACE FUNCTION public.set_default_org_and_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_TABLE_NAME = 'clients' THEN
    IF NEW.org_id IS NULL THEN
      NEW.org_id := public.current_user_org_id();
    END IF;
    IF NEW.user_id IS NULL THEN
      NEW.user_id := v_actor;
    END IF;
  ELSIF TG_TABLE_NAME = 'client_filters' THEN
    IF NEW.org_id IS NULL THEN
      SELECT c.org_id INTO NEW.org_id
      FROM public.clients c
      WHERE c.id = NEW.client_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'automated_matches' THEN
    IF NEW.org_id IS NULL THEN
      SELECT c.org_id INTO NEW.org_id
      FROM public.clients c
      WHERE c.id = NEW.client_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
    NEW.created_by := v_actor;
  END IF;

  NEW.updated_by := v_actor;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_set_default_org_and_audit_fields ON public.clients;
CREATE TRIGGER trg_clients_set_default_org_and_audit_fields
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_org_and_audit_fields();

DROP TRIGGER IF EXISTS trg_client_filters_set_default_org_and_audit_fields ON public.client_filters;
CREATE TRIGGER trg_client_filters_set_default_org_and_audit_fields
  BEFORE INSERT OR UPDATE ON public.client_filters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_org_and_audit_fields();

DROP TRIGGER IF EXISTS trg_automated_matches_set_default_org_and_audit_fields ON public.automated_matches;
CREATE TRIGGER trg_automated_matches_set_default_org_and_audit_fields
  BEFORE INSERT OR UPDATE ON public.automated_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_org_and_audit_fields();

CREATE OR REPLACE FUNCTION public.enforce_client_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_org uuid;
BEGIN
  SELECT c.org_id
    INTO v_client_org
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  IF v_client_org IS NULL THEN
    RAISE EXCEPTION 'Client organization not found.';
  END IF;

  IF NEW.org_id IS NULL THEN
    NEW.org_id := v_client_org;
  ELSIF NEW.org_id <> v_client_org THEN
    RAISE EXCEPTION 'Organization mismatch for this client reference.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_filters_org_consistency ON public.client_filters;
CREATE TRIGGER trg_client_filters_org_consistency
  BEFORE INSERT OR UPDATE ON public.client_filters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_org_consistency();

DROP TRIGGER IF EXISTS trg_automated_matches_org_consistency ON public.automated_matches;
CREATE TRIGGER trg_automated_matches_org_consistency
  BEFORE INSERT OR UPDATE ON public.automated_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_org_consistency();

-- -----------------------------------------------------------------
-- 7) RLS policies for CRM and listings scoped by org
-- -----------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS clients_select_org_policy ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_insert_org_policy ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_update_org_policy ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_delete_org_policy ON public.clients';

    EXECUTE $policy$
      CREATE POLICY clients_select_org_policy
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_insert_org_policy
      ON public.clients
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_update_org_policy
      ON public.clients
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY clients_delete_org_policy
      ON public.clients
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = clients.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.client_filters') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.client_filters ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS client_filters_select_org_policy ON public.client_filters';
    EXECUTE 'DROP POLICY IF EXISTS client_filters_insert_org_policy ON public.client_filters';
    EXECUTE 'DROP POLICY IF EXISTS client_filters_update_org_policy ON public.client_filters';
    EXECUTE 'DROP POLICY IF EXISTS client_filters_delete_org_policy ON public.client_filters';

    EXECUTE $policy$
      CREATE POLICY client_filters_select_org_policy
      ON public.client_filters
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = client_filters.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_insert_org_policy
      ON public.client_filters
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = client_filters.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_update_org_policy
      ON public.client_filters
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = client_filters.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = client_filters.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY client_filters_delete_org_policy
      ON public.client_filters
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = client_filters.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.automated_matches') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.automated_matches ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS automated_matches_select_org_policy ON public.automated_matches';
    EXECUTE 'DROP POLICY IF EXISTS automated_matches_insert_org_policy ON public.automated_matches';
    EXECUTE 'DROP POLICY IF EXISTS automated_matches_update_org_policy ON public.automated_matches';
    EXECUTE 'DROP POLICY IF EXISTS automated_matches_delete_org_policy ON public.automated_matches';

    EXECUTE $policy$
      CREATE POLICY automated_matches_select_org_policy
      ON public.automated_matches
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = automated_matches.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_insert_org_policy
      ON public.automated_matches
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = automated_matches.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_update_org_policy
      ON public.automated_matches
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = automated_matches.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = automated_matches.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY automated_matches_delete_org_policy
      ON public.automated_matches
      FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = automated_matches.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.listings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS listings_select_org_scope_policy ON public.listings';

    EXECUTE $policy$
      CREATE POLICY listings_select_org_scope_policy
      ON public.listings
      FOR SELECT
      TO authenticated
      USING (
        listings.org_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.organization_members m
          WHERE m.organization_id = listings.org_id
            AND m.user_id = auth.uid()
            AND m.status = 'active'
        )
      )
    $policy$;
  END IF;
END;
$$;

COMMIT;

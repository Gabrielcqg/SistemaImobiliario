-- ============================================================
-- MIGRATION: Account Onboarding (Individual x Brokerage + Invites)
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('individual', 'brokerage')),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seats_total integer NOT NULL DEFAULT 1 CHECK (seats_total >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  UNIQUE (invite_token)
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_user_id
  ON public.organizations(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
  ON public.organization_members(user_id);

CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id
  ON public.organization_members(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_invites_organization_id
  ON public.organization_invites(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_invites_status
  ON public.organization_invites(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invites_pending_email
  ON public.organization_invites (organization_id, lower(email))
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.touch_organizations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_touch_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_organizations_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_organization_membership_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_seats integer;
  v_members_count integer;
BEGIN
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
  WHERE organization_id = NEW.organization_id;

  IF v_kind = 'individual' AND v_members_count >= 1 THEN
    RAISE EXCEPTION 'Individual account allows only one member.';
  END IF;

  IF v_members_count >= v_seats THEN
    RAISE EXCEPTION 'No seats available in this organization.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_organization_membership_limits ON public.organization_members;
CREATE TRIGGER trg_enforce_organization_membership_limits
  BEFORE INSERT ON public.organization_members
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
  WHERE organization_id = NEW.organization_id;

  SELECT count(*)
    INTO v_pending_count
  FROM public.organization_invites
  WHERE organization_id = NEW.organization_id
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now());

  IF (v_members_count + v_pending_count) >= v_seats THEN
    RAISE EXCEPTION 'No seats available for new invites.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_organization_invite_limits ON public.organization_invites;
CREATE TRIGGER trg_enforce_organization_invite_limits
  BEFORE INSERT ON public.organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_organization_invite_limits();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_policy ON public.organizations;
CREATE POLICY organizations_select_policy
ON public.organizations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = organizations.id
      AND m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS organizations_insert_policy ON public.organizations;
CREATE POLICY organizations_insert_policy
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS organizations_update_policy ON public.organizations;
CREATE POLICY organizations_update_policy
ON public.organizations
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS organization_members_select_policy ON public.organization_members;
CREATE POLICY organization_members_select_policy
ON public.organization_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members own
    WHERE own.organization_id = organization_members.organization_id
      AND own.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS organization_members_insert_policy ON public.organization_members;
CREATE POLICY organization_members_insert_policy
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = organization_members.organization_id
      AND o.owner_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_members.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS organization_members_update_policy ON public.organization_members;
CREATE POLICY organization_members_update_policy
ON public.organization_members
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_members.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_members.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS organization_members_delete_policy ON public.organization_members;
CREATE POLICY organization_members_delete_policy
ON public.organization_members
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_members.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS organization_invites_select_policy ON public.organization_invites;
CREATE POLICY organization_invites_select_policy
ON public.organization_invites
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = organization_invites.organization_id
      AND m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS organization_invites_insert_policy ON public.organization_invites;
CREATE POLICY organization_invites_insert_policy
ON public.organization_invites
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_invites.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS organization_invites_update_policy ON public.organization_invites;
CREATE POLICY organization_invites_update_policy
ON public.organization_invites
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_invites.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_invites.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS organization_invites_delete_policy ON public.organization_invites;
CREATE POLICY organization_invites_delete_policy
ON public.organization_invites
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members admin
    WHERE admin.organization_id = organization_invites.organization_id
      AND admin.user_id = auth.uid()
      AND admin.role IN ('owner', 'admin')
  )
);

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

  IF coalesce(lower(v_invite.email), '') <> '' AND v_user_email <> '' AND lower(v_invite.email) <> v_user_email THEN
    RAISE EXCEPTION 'Invite e-mail does not match the authenticated user.';
  END IF;

  SELECT m.role
    INTO v_existing_role
  FROM public.organization_members m
  WHERE m.organization_id = v_invite.organization_id
    AND m.user_id = v_user_id
  LIMIT 1;

  IF v_existing_role IS NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (v_invite.organization_id, v_user_id, v_invite.role);
    v_existing_role := v_invite.role;
  END IF;

  UPDATE public.organization_invites
  SET
    status = 'accepted',
    accepted_by = v_user_id,
    accepted_at = now()
  WHERE id = v_invite.id;

  SELECT name
    INTO v_org_name
  FROM public.organizations
  WHERE id = v_invite.organization_id;

  RETURN QUERY
  SELECT v_invite.organization_id, v_org_name, v_existing_role;
END;
$$;

REVOKE ALL ON FUNCTION public.get_organization_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_invite_preview(text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.accept_organization_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(text)
  TO authenticated, service_role;

COMMIT;

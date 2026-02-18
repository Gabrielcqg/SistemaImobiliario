-- ============================================================
-- MIGRATION: Active organization persistence + bootstrap RPC
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS active_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_profiles_active_organization_id
  ON public.profiles(active_organization_id);

CREATE OR REPLACE FUNCTION public.touch_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_touch_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profiles_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own_policy ON public.profiles;
CREATE POLICY profiles_select_own_policy
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_own_policy ON public.profiles;
CREATE POLICY profiles_insert_own_policy
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own_policy ON public.profiles;
CREATE POLICY profiles_update_own_policy
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_active_organization(p_organization_id uuid)
RETURNS TABLE (
  active_org_id uuid,
  my_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required.';
  END IF;

  SELECT m.role::text
    INTO v_role
  FROM public.organization_members m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user_id
  ORDER BY m.created_at ASC
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.profiles (id, active_organization_id)
  VALUES (v_user_id, p_organization_id)
  ON CONFLICT (id)
  DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;

  RETURN QUERY
  SELECT p_organization_id, v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid)
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

  SELECT count(*)::integer
    INTO v_memberships_count
  FROM public.organization_members m
  WHERE m.user_id = v_user_id;

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
      coalesce(o.seats_total, 0)
      INTO v_org_name, v_org_kind, v_my_role, v_seats_total
    FROM public.organization_members m
    INNER JOIN public.organizations o
      ON o.id = m.organization_id
    WHERE m.user_id = v_user_id
      AND m.organization_id = v_active_org_id
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
      coalesce(o.seats_total, 0)
      INTO v_active_org_id, v_org_name, v_org_kind, v_my_role, v_seats_total
    FROM public.organization_members m
    INNER JOIN public.organizations o
      ON o.id = m.organization_id
    WHERE m.user_id = v_user_id
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
    WHERE m.organization_id = v_active_org_id;

    SELECT count(*)::integer
      INTO v_pending_invites
    FROM public.organization_invites i
    WHERE i.organization_id = v_active_org_id
      AND i.status = 'pending';
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

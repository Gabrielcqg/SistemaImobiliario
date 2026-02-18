import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AccountType = "individual" | "brokerage" | "join";
export type OrganizationKind = "individual" | "brokerage";
export type OrganizationRole = "owner" | "admin" | "member";
export type OrganizationMemberStatus = "active" | "invited" | "disabled";

export type OrganizationSummary = {
  id: string;
  name: string;
  kind: OrganizationKind;
  seatsTotal: number;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  inviteToken: string;
  createdAt: string;
  expiresAt: string | null;
};

export type OrganizationMember = {
  id: string;
  userId: string;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  createdAt: string;
};

export type OrganizationContext = {
  organization: OrganizationSummary;
  role: OrganizationRole;
  membersUsed: number;
  pendingInvites: number;
  members: OrganizationMember[];
  invites: OrganizationInvite[];
};

export type CurrentOrganization = {
  organizationId: string;
  organizationName: string;
  organizationKind: OrganizationKind;
  role: OrganizationRole;
  seatsTotal: number;
  membersUsed: number;
  pendingInvites: number;
};

export type BootstrapContext = {
  activeOrganizationId: string | null;
  organizationName: string | null;
  organizationKind: OrganizationKind | null;
  myRole: OrganizationRole | null;
  membershipsCount: number;
  needsOrgChoice: boolean;
  seatsTotal: number;
  membersUsed: number;
  pendingInvites: number;
};

export type OrganizationChoiceItem = {
  organizationId: string;
  organizationName: string;
  organizationKind: OrganizationKind;
  role: OrganizationRole;
  createdAt: string;
};

export type BootstrapAccountInput = {
  accountType: AccountType;
  organizationName?: string | null;
  fullName?: string | null;
  inviteToken?: string | null;
  seatsRequested?: number | null;
  strictJoin?: boolean;
};

export type InviteCreationStatus =
  | "invited"
  | "resent"
  | "already_member"
  | "no_seat"
  | "invalid"
  | "error"
  | "not_allowed";

export type InviteCreationRow = {
  email: string;
  status: InviteCreationStatus;
  inviteToken: string | null;
  message: string;
};

export type InviteCreationSummary = {
  inserted: number;
  resent: number;
  alreadyMember: number;
  noSeat: number;
  invalid: number;
  failed: number;
  results: InviteCreationRow[];
};

type MembershipQueryRow = {
  organization_id: string;
  role: OrganizationRole;
  status?: OrganizationMemberStatus;
  organizations?: {
    id: string;
    name: string;
    kind: OrganizationKind;
    seats_total: number;
  } | null;
};

type InvitePreviewRow = {
  invite_id: string;
  organization_id: string;
  organization_name: string;
  invite_email: string;
  invite_role: OrganizationRole;
  expires_at: string | null;
};

type AcceptInviteResultRow = {
  organization_id: string;
  organization_name: string;
  role: OrganizationRole;
};

type AcceptInviteRpcError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
};

type AcceptInviteRpcDefinition = {
  name: "accept_org_invite" | "accept_organization_invite";
  payload: (token: string) => Record<string, string>;
};

export type AcceptInviteError = Error & {
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
  rpcName?: string;
  payload?: Record<string, unknown>;
  userId?: string;
  token?: string;
};

export type AcceptInviteResult = {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  rpcName: AcceptInviteRpcDefinition["name"];
  payload: Record<string, string>;
  userId: string;
};

type OrganizationSubscriptionRow = {
  seats_total?: number | null;
  seats_used?: number | null;
};

type BootstrapContextRpcRow = {
  active_org_id?: string | null;
  org_name?: string | null;
  org_kind?: OrganizationKind | null;
  my_role?: OrganizationRole | null;
  memberships_count?: number | null;
  needs_org_choice?: boolean | null;
  seats_total?: number | null;
  members_used?: number | null;
  pending_invites?: number | null;
};

const isMissingColumnError = (message?: string) =>
  typeof message === "string" && /column .* does not exist|PGRST204/i.test(message);

const isMissingFunctionError = (message?: string) =>
  typeof message === "string" && /function .* does not exist|42883|PGRST202/i.test(message);

const isMissingRelationError = (message?: string) =>
  typeof message === "string" && /relation .* does not exist|schema cache|PGRST/i.test(message);

function getAccountTypeFromUserMetadata(user: User): AccountType {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const accountTypeRaw = metadata.onboarding_account_type;
  if (
    accountTypeRaw === "individual" ||
    accountTypeRaw === "brokerage" ||
    accountTypeRaw === "join"
  ) {
    return accountTypeRaw;
  }
  return "individual";
}

const ACCEPT_INVITE_RPC_DEFINITIONS: AcceptInviteRpcDefinition[] = [
  {
    name: "accept_org_invite",
    payload: (token) => ({ _token: token })
  },
  {
    name: "accept_organization_invite",
    payload: (token) => ({ p_token: token })
  }
];

function toAcceptInviteError(
  errorLike: AcceptInviteRpcError | string,
  context: {
    message?: string;
    rpcName?: string;
    payload?: Record<string, unknown>;
    userId?: string;
    token?: string;
  }
): AcceptInviteError {
  const fromString = typeof errorLike === "string";
  const error = new Error(
    (fromString ? errorLike : errorLike.message) ?? context.message ?? "Falha ao aceitar convite."
  ) as AcceptInviteError;

  if (!fromString) {
    error.code = errorLike.code;
    error.details = errorLike.details;
    error.hint = errorLike.hint;
    error.status = errorLike.status;
  }

  if (context.message && !fromString) {
    error.message = context.message;
  }

  error.rpcName = context.rpcName;
  error.payload = context.payload;
  error.userId = context.userId;
  error.token = context.token;
  return error;
}

export async function acceptOrganizationInviteForAuthenticatedUser(
  supabase: SupabaseClient,
  inviteTokenRaw: string
): Promise<AcceptInviteResult> {
  const token = inviteTokenRaw.trim();
  const user = await requireUser(supabase);

  if (!token) {
    throw toAcceptInviteError("invite_invalid_or_expired", {
      userId: user.id,
      token
    });
  }

  let missingFunctionError: AcceptInviteError | null = null;

  for (const rpcDefinition of ACCEPT_INVITE_RPC_DEFINITIONS) {
    const payload = rpcDefinition.payload(token);
    const response = await supabase.rpc(rpcDefinition.name, payload).maybeSingle();

    if (response.error) {
      const acceptError = toAcceptInviteError(response.error as AcceptInviteRpcError, {
        rpcName: rpcDefinition.name,
        payload,
        userId: user.id,
        token
      });

      if (isMissingFunctionError(response.error.message)) {
        missingFunctionError = acceptError;
        continue;
      }

      throw acceptError;
    }

    if (!response.data) {
      throw toAcceptInviteError("invite_invalid_or_expired", {
        rpcName: rpcDefinition.name,
        payload,
        userId: user.id,
        token
      });
    }

    const accepted = response.data as AcceptInviteResultRow;
    try {
      await setActiveOrganization(supabase, accepted.organization_id);
    } catch (setActiveError) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[acceptOrganizationInviteForAuthenticatedUser] Failed to persist active organization:",
          setActiveError
        );
      }
    }

    return {
      organizationId: accepted.organization_id,
      organizationName: accepted.organization_name,
      role: accepted.role,
      rpcName: rpcDefinition.name,
      payload,
      userId: user.id
    };
  }

  if (missingFunctionError) {
    throw toAcceptInviteError("Invite accept RPC is not available.", {
      rpcName: missingFunctionError.rpcName,
      payload: missingFunctionError.payload,
      userId: missingFunctionError.userId,
      token
    });
  }

  throw toAcceptInviteError("Falha ao aceitar convite.", { userId: user.id, token });
}

function getUserFullNameFromMetadata(user: User): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullNameRaw =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.onboarding_full_name === "string"
        ? metadata.onboarding_full_name
        : "";
  return fullNameRaw.trim();
}

function getPersonalWorkspaceName(user: User): string {
  const fullName = getUserFullNameFromMetadata(user);
  if (fullName) {
    return `Workspace pessoal de ${fullName}`;
  }
  if (user.email) {
    return `Workspace pessoal (${user.email})`;
  }
  return "Workspace pessoal";
}

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Usuario nao autenticado.");
  }

  return user;
}

function normalizeSeats(kind: OrganizationKind, seatsRequested?: number | null) {
  if (kind === "individual") {
    return 1;
  }

  const parsed =
    typeof seatsRequested === "number" && Number.isFinite(seatsRequested)
      ? Math.floor(seatsRequested)
      : 5;

  return Math.max(1, parsed);
}

function defaultOrganizationName(
  kind: OrganizationKind,
  user: User,
  fullName?: string | null
) {
  const normalizedFullName = (fullName ?? "").trim();
  if (kind === "individual") {
    if (normalizedFullName) {
      return `${normalizedFullName} (Individual)`;
    }
    if (user.email) {
      return `${user.email} (Individual)`;
    }
    return "Conta Individual";
  }

  return normalizedFullName ? `${normalizedFullName} Imobiliaria` : "Nova Imobiliaria";
}

async function getExistingMembership(supabase: SupabaseClient, userId: string) {
  const queryFields =
    "organization_id, role, status, organizations:organization_id (id, name, kind, seats_total)";

  const initial = await supabase
    .from("organization_members")
    .select(queryFields)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let data = (initial.data as MembershipQueryRow | null) ?? null;
  let error = initial.error;

  if (error && isMissingColumnError(error.message)) {
    const fallback = await supabase
      .from("organization_members")
      .select(
        "organization_id, role, organizations:organization_id (id, name, kind, seats_total)"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    data = (fallback.data as MembershipQueryRow | null) ?? null;
    error = fallback.error;
  }

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function ensureOnboardingOrganization(
  supabase: SupabaseClient,
  input: BootstrapAccountInput
) {
  const user = await requireUser(supabase);
  const inviteToken =
    typeof input.inviteToken === "string" ? input.inviteToken.trim() : "";

  if (input.accountType === "join" && input.strictJoin && !inviteToken) {
    throw new Error("Convite invalido. Solicite um novo link para entrar na equipe.");
  }

  if (input.accountType === "join" && inviteToken) {
    try {
      const accepted = await acceptOrganizationInviteForAuthenticatedUser(
        supabase,
        inviteToken
      );
      try {
        await setActiveOrganization(supabase, accepted.organizationId);
      } catch {
        // Ignore persistence failures in onboarding flow.
      }
      return {
        mode: "invited" as const,
        organization: {
          id: accepted.organizationId,
          name: accepted.organizationName,
          kind: "brokerage" as OrganizationKind,
          seatsTotal: 0
        },
        role: accepted.role
      };
    } catch (joinError) {
      if (input.strictJoin) {
        throw joinError instanceof Error
          ? joinError
          : new Error("Nao foi possivel aceitar o convite.");
      }
    }
  }

  const existingMembership = await getExistingMembership(supabase, user.id);
  if (existingMembership?.organizations) {
    try {
      await setActiveOrganization(supabase, existingMembership.organizations.id);
    } catch {
      // Ignore persistence failures in onboarding flow.
    }
    return {
      mode: "existing" as const,
      organization: {
        id: existingMembership.organizations.id,
        name: existingMembership.organizations.name,
        kind: existingMembership.organizations.kind,
        seatsTotal: existingMembership.organizations.seats_total
      },
      role: existingMembership.role
    };
  }

  const kind: OrganizationKind =
    input.accountType === "brokerage" ? "brokerage" : "individual";
  const seatsTotal = normalizeSeats(kind, input.seatsRequested);
  const organizationName =
    (input.organizationName ?? "").trim() || defaultOrganizationName(kind, user, input.fullName);

  const { data: organization, error: insertOrganizationError } = await supabase
    .from("organizations")
    .insert({
      kind,
      name: organizationName,
      owner_user_id: user.id,
      seats_total: seatsTotal
    })
    .select("id, name, kind, seats_total")
    .single();

  if (insertOrganizationError) {
    throw new Error(insertOrganizationError.message);
  }

  const organizationRow = organization as {
    id: string;
    name: string;
    kind: OrganizationKind;
    seats_total: number;
  };

  let { error: insertMembershipError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: organizationRow.id,
      user_id: user.id,
      role: "owner",
      status: "active"
    });

  if (insertMembershipError && isMissingColumnError(insertMembershipError.message)) {
    const fallback = await supabase
      .from("organization_members")
      .insert({
        organization_id: organizationRow.id,
        user_id: user.id,
        role: "owner"
      });
    insertMembershipError = fallback.error;
  }

  if (insertMembershipError) {
    throw new Error(insertMembershipError.message);
  }

  try {
    await setActiveOrganization(supabase, organizationRow.id);
  } catch {
    // Ignore persistence failures in onboarding flow.
  }

  return {
    mode: "created" as const,
    organization: {
      id: organizationRow.id,
      name: organizationRow.name,
      kind: organizationRow.kind,
      seatsTotal: organizationRow.seats_total
    },
    role: "owner" as OrganizationRole
  };
}

export async function ensurePersonalOrganization(
  supabase: SupabaseClient
): Promise<string | null> {
  const user = await requireUser(supabase);
  const accountType = getAccountTypeFromUserMetadata(user);
  if (accountType === "brokerage" || accountType === "join") {
    return null;
  }

  const existingMembership = await getExistingMembership(supabase, user.id);
  if (existingMembership?.organizations?.id) {
    try {
      await setActiveOrganization(supabase, existingMembership.organizations.id);
    } catch {
      // Ignore persistence failures in ensure flow.
    }
    return existingMembership.organizations.id;
  }

  const ensureResult = await supabase.rpc("ensure_personal_org");
  if (ensureResult.error) {
    if (!isMissingFunctionError(ensureResult.error.message)) {
      throw new Error(ensureResult.error.message);
    }

    const fallback = await ensureOnboardingOrganization(supabase, {
      accountType: "individual",
      fullName: getUserFullNameFromMetadata(user),
      organizationName: getPersonalWorkspaceName(user)
    });
    return fallback.organization.id;
  }

  if (typeof ensureResult.data === "string" && ensureResult.data) {
    try {
      await setActiveOrganization(supabase, ensureResult.data);
    } catch {
      // Ignore persistence failures in ensure flow.
    }
    return ensureResult.data;
  }

  if (Array.isArray(ensureResult.data) && ensureResult.data.length > 0) {
    const first = ensureResult.data[0];
    if (typeof first === "string" && first) {
      try {
        await setActiveOrganization(supabase, first);
      } catch {
        // Ignore persistence failures in ensure flow.
      }
      return first;
    }
  }

  const refreshedMembership = await getExistingMembership(supabase, user.id);
  if (refreshedMembership?.organizations?.id) {
    try {
      await setActiveOrganization(supabase, refreshedMembership.organizations.id);
    } catch {
      // Ignore persistence failures in ensure flow.
    }
  }
  return refreshedMembership?.organizations?.id ?? null;
}

export async function getOrganizationContext(
  supabase: SupabaseClient
): Promise<OrganizationContext | null> {
  const user = await requireUser(supabase);
  const membership = await getExistingMembership(supabase, user.id);

  if (!membership?.organizations) {
    return null;
  }

  const organization = membership.organizations;

  let membersUsed = 0;
  let seatsTotal = organization.seats_total;
  let members: OrganizationMember[] = [];

  const membersQuery = await supabase
    .from("organization_members")
    .select("id, user_id, role, status, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true });

  let membersRows = membersQuery.data as unknown[] | null;
  let membersError = membersQuery.error;

  if (membersError && isMissingColumnError(membersError.message)) {
    const fallbackMembersQuery = await supabase
      .from("organization_members")
      .select("id, user_id, role, created_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: true });

    membersRows = fallbackMembersQuery.data as unknown[] | null;
    membersError = fallbackMembersQuery.error;
  }

  if (membersError) {
    throw new Error(membersError.message);
  }

  members = (membersRows ?? []).map((row): OrganizationMember => {
    const item = row as Record<string, unknown>;
    const rawStatus = item.status as OrganizationMemberStatus | undefined;
    return {
      id: String(item.id ?? ""),
      userId: String(item.user_id ?? ""),
      role: (item.role as OrganizationRole) ?? "member",
      status: rawStatus ?? "active",
      createdAt: String(item.created_at ?? "")
    };
  });

  const { count: membersCount, error: membersCountError } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization.id)
    .eq("status", "active");

  if (membersCountError && !isMissingColumnError(membersCountError.message)) {
    throw new Error(membersCountError.message);
  }

  if (membersCountError && isMissingColumnError(membersCountError.message)) {
    const fallback = await supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id);

    if (fallback.error) {
      throw new Error(fallback.error.message);
    }

    membersUsed = fallback.count ?? 0;
  } else {
    membersUsed = membersCount ?? 0;
  }

  const localActiveMembers = members.filter((member) => member.status === "active").length;
  if (localActiveMembers > 0) {
    membersUsed = localActiveMembers;
  }

  const { data: subscriptionData, error: subscriptionError } = await supabase
    .from("organization_subscriptions")
    .select("seats_total, seats_used")
    .eq("org_id", organization.id)
    .maybeSingle();

  if (subscriptionError && !isMissingRelationError(subscriptionError.message)) {
    throw new Error(subscriptionError.message);
  }

  if (!subscriptionError && subscriptionData) {
    const subscription = subscriptionData as OrganizationSubscriptionRow;
    if (typeof subscription.seats_total === "number") {
      seatsTotal = subscription.seats_total;
    }
    if (typeof subscription.seats_used === "number") {
      membersUsed = subscription.seats_used;
    }
  }

  const { data: inviteRows, error: invitesError } = await supabase
    .from("organization_invites")
    .select("id, email, role, status, invite_token, created_at, expires_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (invitesError) {
    throw new Error(invitesError.message);
  }

  const invites = ((inviteRows as unknown[]) ?? []).map(
    (row): OrganizationInvite => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        email: String(item.email ?? ""),
        role: (item.role as OrganizationRole) ?? "member",
        status:
          (item.status as "pending" | "accepted" | "revoked" | "expired") ?? "pending",
        inviteToken: String(item.invite_token ?? ""),
        createdAt: String(item.created_at ?? ""),
        expiresAt: typeof item.expires_at === "string" ? item.expires_at : null
      };
    }
  );

  const pendingInvites = invites.filter((item) => item.status === "pending").length;

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      kind: organization.kind,
      seatsTotal
    },
    role: membership.role,
    membersUsed,
    pendingInvites,
    members,
    invites
  };
}

export async function getCurrentOrganization(
  supabase: SupabaseClient
): Promise<CurrentOrganization | null> {
  const context = await getOrganizationContext(supabase);

  if (!context) {
    return null;
  }

  return {
    organizationId: context.organization.id,
    organizationName: context.organization.name,
    organizationKind: context.organization.kind,
    role: context.role,
    seatsTotal: context.organization.seatsTotal,
    membersUsed: context.membersUsed,
    pendingInvites: context.pendingInvites
  };
}

function normalizeOrganizationRole(value: unknown): OrganizationRole | null {
  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }
  return null;
}

function normalizeOrganizationKind(value: unknown): OrganizationKind | null {
  if (value === "individual" || value === "brokerage") {
    return value;
  }
  return null;
}

function normalizeBootstrapContextRow(
  row: BootstrapContextRpcRow | null | undefined
): BootstrapContext {
  return {
    activeOrganizationId:
      typeof row?.active_org_id === "string" ? row.active_org_id : null,
    organizationName: typeof row?.org_name === "string" ? row.org_name : null,
    organizationKind: normalizeOrganizationKind(row?.org_kind),
    myRole: normalizeOrganizationRole(row?.my_role),
    membershipsCount:
      typeof row?.memberships_count === "number" && Number.isFinite(row.memberships_count)
        ? Math.max(0, Math.trunc(row.memberships_count))
        : 0,
    needsOrgChoice: Boolean(row?.needs_org_choice),
    seatsTotal:
      typeof row?.seats_total === "number" && Number.isFinite(row.seats_total)
        ? Math.max(0, Math.trunc(row.seats_total))
        : 0,
    membersUsed:
      typeof row?.members_used === "number" && Number.isFinite(row.members_used)
        ? Math.max(0, Math.trunc(row.members_used))
        : 0,
    pendingInvites:
      typeof row?.pending_invites === "number" && Number.isFinite(row.pending_invites)
        ? Math.max(0, Math.trunc(row.pending_invites))
        : 0
  };
}

async function getBootstrapContextFallback(
  supabase: SupabaseClient
): Promise<BootstrapContext> {
  const user = await requireUser(supabase);
  const context = await getOrganizationContext(supabase);
  const membershipsResult = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message);
  }

  const uniqueMembershipIds = Array.from(
    new Set(
      ((membershipsResult.data as { organization_id?: string | null }[] | null) ?? [])
        .map((row) => row.organization_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  return {
    activeOrganizationId: context?.organization.id ?? null,
    organizationName: context?.organization.name ?? null,
    organizationKind: context?.organization.kind ?? null,
    myRole: context?.role ?? null,
    membershipsCount: uniqueMembershipIds.length,
    needsOrgChoice: !context && uniqueMembershipIds.length > 1,
    seatsTotal: context?.organization.seatsTotal ?? 0,
    membersUsed: context?.membersUsed ?? 0,
    pendingInvites: context?.pendingInvites ?? 0
  };
}

export async function getBootstrapContext(
  supabase: SupabaseClient
): Promise<BootstrapContext> {
  await requireUser(supabase);

  const rpcResponse = await supabase.rpc("get_bootstrap_context").maybeSingle();

  if (rpcResponse.error && isMissingFunctionError(rpcResponse.error.message)) {
    return getBootstrapContextFallback(supabase);
  }

  if (rpcResponse.error) {
    throw new Error(rpcResponse.error.message);
  }

  return normalizeBootstrapContextRow(
    (rpcResponse.data as BootstrapContextRpcRow | null) ?? null
  );
}

export async function setActiveOrganization(
  supabase: SupabaseClient,
  organizationIdRaw: string
): Promise<void> {
  const user = await requireUser(supabase);
  const organizationId = organizationIdRaw.trim();

  if (!organizationId) {
    throw new Error("organization_id_invalida");
  }

  const rpcResponse = await supabase.rpc("set_active_organization", {
    p_organization_id: organizationId
  });

  if (rpcResponse.error && !isMissingFunctionError(rpcResponse.error.message)) {
    throw new Error(rpcResponse.error.message);
  }

  if (!rpcResponse.error) {
    return;
  }

  const membershipCheck = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipCheck.error) {
    throw new Error(membershipCheck.error.message);
  }

  if (!membershipCheck.data) {
    throw new Error("Sem permissão para selecionar esta organização.");
  }

  const profileUpdate = await supabase.from("profiles").upsert(
    {
      id: user.id,
      active_organization_id: organizationId
    },
    { onConflict: "id" }
  );

  if (profileUpdate.error) {
    throw new Error(profileUpdate.error.message);
  }
}

export async function listMyOrganizations(
  supabase: SupabaseClient
): Promise<OrganizationChoiceItem[]> {
  const user = await requireUser(supabase);

  const primary = await supabase
    .from("organization_members")
    .select(
      "organization_id, role, status, created_at, organizations:organization_id (id, name, kind)"
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  let rows = primary.data as
    | Array<{
        organization_id?: string | null;
        role?: OrganizationRole | null;
        created_at?: string | null;
        organizations?: { id?: string; name?: string; kind?: OrganizationKind } | null;
      }>
    | null;
  let error = primary.error;

  if (error && isMissingColumnError(error.message)) {
    const fallback = await supabase
      .from("organization_members")
      .select(
        "organization_id, role, created_at, organizations:organization_id (id, name, kind)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    rows = fallback.data as typeof rows;
    error = fallback.error;
  }

  if (error) {
    throw new Error(error.message);
  }

  const dedupedByOrganization = new Map<string, OrganizationChoiceItem>();
  (rows ?? []).forEach((row) => {
    const organization = row.organizations;
    const organizationId =
      typeof organization?.id === "string" ? organization.id : row.organization_id;
    const organizationName =
      typeof organization?.name === "string" ? organization.name : "";
    const organizationKind = normalizeOrganizationKind(organization?.kind);
    const role = normalizeOrganizationRole(row.role);
    if (!organizationId || !organizationName || !organizationKind || !role) {
      return;
    }
    if (dedupedByOrganization.has(organizationId)) {
      return;
    }

    dedupedByOrganization.set(organizationId, {
      organizationId,
      organizationName,
      organizationKind,
      role,
      createdAt: typeof row.created_at === "string" ? row.created_at : ""
    });
  });

  return Array.from(dedupedByOrganization.values());
}

export async function getMyOrgRole(
  supabase: SupabaseClient,
  organizationIdRaw: string
): Promise<OrganizationRole | null> {
  const user = await requireUser(supabase);
  const organizationId = organizationIdRaw.trim();
  if (!organizationId) {
    return null;
  }

  const primaryMembership = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  let membershipRole = normalizeOrganizationRole(
    (primaryMembership.data as { role?: unknown } | null)?.role
  );

  if (primaryMembership.error && isMissingColumnError(primaryMembership.error.message)) {
    const fallbackMembership = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fallbackMembership.error) {
      throw new Error(fallbackMembership.error.message);
    }

    membershipRole = normalizeOrganizationRole(
      (fallbackMembership.data as { role?: unknown } | null)?.role
    );
  } else if (primaryMembership.error) {
    throw new Error(primaryMembership.error.message);
  }

  if (membershipRole) {
    return membershipRole;
  }

  const ownerLookup = await supabase
    .from("organizations")
    .select("owner_user_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (ownerLookup.error) {
    throw new Error(ownerLookup.error.message);
  }

  const ownerUserId = (ownerLookup.data as { owner_user_id?: string | null } | null)
    ?.owner_user_id;

  if (ownerUserId && ownerUserId === user.id) {
    return "owner";
  }

  return null;
}

function summarizeInviteRows(rows: InviteCreationRow[]): InviteCreationSummary {
  return rows.reduce<InviteCreationSummary>(
    (acc, row) => {
      if (row.status === "invited") acc.inserted += 1;
      else if (row.status === "resent") acc.resent += 1;
      else if (row.status === "already_member") acc.alreadyMember += 1;
      else if (row.status === "no_seat") acc.noSeat += 1;
      else if (row.status === "invalid") acc.invalid += 1;
      else acc.failed += 1;
      acc.results.push(row);
      return acc;
    },
    {
      inserted: 0,
      resent: 0,
      alreadyMember: 0,
      noSeat: 0,
      invalid: 0,
      failed: 0,
      results: []
    }
  );
}

export async function createOrganizationInvites(
  supabase: SupabaseClient,
  organizationId: string,
  emails: string[]
): Promise<InviteCreationSummary> {
  await requireUser(supabase);

  const normalized = Array.from(
    new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@"))
    )
  );

  if (normalized.length === 0) {
    return {
      inserted: 0,
      resent: 0,
      alreadyMember: 0,
      noSeat: 0,
      invalid: 0,
      failed: 0,
      results: []
    };
  }

  const rpcResponse = await supabase.rpc("create_organization_invites", {
    p_organization_id: organizationId,
    p_emails: normalized,
    p_role: "member",
    p_expires_in_days: 7
  });

  if (rpcResponse.error && isMissingFunctionError(rpcResponse.error.message)) {
    const rows = normalized.map((email) => ({
      organization_id: organizationId,
      email,
      role: "member"
    }));

    const fallback = await supabase
      .from("organization_invites")
      .insert(rows)
      .select("id, email, invite_token");

    if (fallback.error) {
      throw new Error(fallback.error.message);
    }

    const fallbackRows: InviteCreationRow[] =
      ((fallback.data as unknown[]) ?? []).map((row) => {
        const item = row as Record<string, unknown>;
        return {
          email: String(item.email ?? ""),
          status: "invited",
          inviteToken: typeof item.invite_token === "string" ? item.invite_token : null,
          message: "Convite enviado."
        };
      });

    return summarizeInviteRows(fallbackRows);
  }

  if (rpcResponse.error) {
    throw new Error(rpcResponse.error.message);
  }

  const rows: InviteCreationRow[] = ((rpcResponse.data as unknown[]) ?? []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      email: String(item.email ?? ""),
      status: (item.status as InviteCreationStatus) ?? "error",
      inviteToken:
        typeof item.invite_token === "string" || item.invite_token === null
          ? (item.invite_token as string | null)
          : null,
      message: String(item.message ?? "")
    };
  });

  return summarizeInviteRows(rows);
}

export async function revokeOrganizationInvite(
  supabase: SupabaseClient,
  inviteId: string
): Promise<boolean> {
  await requireUser(supabase);

  const response = await supabase.rpc("revoke_organization_invite", {
    p_invite_id: inviteId
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  if (typeof response.data === "boolean") {
    return response.data;
  }

  if (Array.isArray(response.data) && response.data.length > 0) {
    const [first] = response.data;
    if (typeof first === "boolean") {
      return first;
    }
  }

  return false;
}

export async function getInvitePreview(supabase: SupabaseClient, token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken) return null;

  const { data, error } = await supabase
    .rpc("get_organization_invite_preview", {
      p_token: normalizedToken
    })
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const row = data as InvitePreviewRow;

  return {
    inviteId: row.invite_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    inviteEmail: row.invite_email,
    inviteRole: row.invite_role,
    expiresAt: row.expires_at
  };
}

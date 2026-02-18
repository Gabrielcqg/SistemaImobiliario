import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type InviteStatus =
  | "invited"
  | "resent"
  | "already_member"
  | "no_seat"
  | "invalid"
  | "error"
  | "not_allowed";

type InviteRpcRow = {
  email: string;
  status: InviteStatus;
  invite_token: string | null;
  message: string;
};

type InviteSummary = {
  inserted: number;
  resent: number;
  alreadyMember: number;
  noSeat: number;
  invalid: number;
  failed: number;
};

type EmailDeliveryError = {
  email: string;
  status: number | null;
  message: string;
};

const VALID_STATUSES: InviteStatus[] = [
  "invited",
  "resent",
  "already_member",
  "no_seat",
  "invalid",
  "error",
  "not_allowed"
];

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter((email) => email.includes("@"))
    )
  );
}

function summarizeInviteRows(rows: InviteRpcRow[]): InviteSummary {
  return rows.reduce<InviteSummary>(
    (acc, row) => {
      if (row.status === "invited") acc.inserted += 1;
      else if (row.status === "resent") acc.resent += 1;
      else if (row.status === "already_member") acc.alreadyMember += 1;
      else if (row.status === "no_seat") acc.noSeat += 1;
      else if (row.status === "invalid") acc.invalid += 1;
      else acc.failed += 1;
      return acc;
    },
    {
      inserted: 0,
      resent: 0,
      alreadyMember: 0,
      noSeat: 0,
      invalid: 0,
      failed: 0
    }
  );
}

async function sendInviteEmailViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  organizationName: string;
  inviteLink: string;
}) {
  const { apiKey, from, to, organizationName, inviteLink } = args;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Convite para ${organizationName}`,
      html: `
        <p>Voce foi convidado para entrar na imobiliaria <strong>${organizationName}</strong>.</p>
        <p>
          <a href="${inviteLink}">Clique aqui para aceitar o convite</a>
        </p>
        <p>Se preferir, copie o link:</p>
        <p>${inviteLink}</p>
      `
    })
  });

  if (response.ok) {
    return { ok: true as const, status: response.status, message: "sent" };
  }

  let message = `HTTP ${response.status}`;
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const extractedMessage =
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.error === "string" && payload.error) ||
      "";
    if (extractedMessage) {
      message = extractedMessage;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) {
        message = text;
      }
    } catch {
      // no-op
    }
  }

  return { ok: false as const, status: response.status, message };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { organizationId: string } }
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 401,
          code: userError?.name ?? "unauthenticated",
          message: "Usuario nao autenticado."
        }
      },
      { status: 401 }
    );
  }

  const organizationId = params.organizationId;
  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const normalizedEmails = normalizeEmails(payload.emails);
  if (normalizedEmails.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 400,
          code: "invalid_payload",
          message: "Informe pelo menos um e-mail valido."
        }
      },
      { status: 400 }
    );
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "create_organization_invites",
    {
      p_organization_id: organizationId,
      p_emails: normalizedEmails,
      p_role: "member",
      p_expires_in_days: 7
    }
  );

  if (rpcError) {
    console.error("[invites][create] rpc error", {
      organizationId,
      userId: user.id,
      emailsRequested: normalizedEmails.length,
      code: rpcError.code,
      details: rpcError.details,
      hint: rpcError.hint,
      message: rpcError.message
    });

    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 400,
          code: rpcError.code ?? "rpc_error",
          details: rpcError.details,
          hint: rpcError.hint,
          message: rpcError.message
        }
      },
      { status: 400 }
    );
  }

  const rows: InviteRpcRow[] = ((rpcData as unknown[]) ?? []).map((row) => {
    const item = row as Record<string, unknown>;
    const statusCandidate = String(item.status ?? "error") as InviteStatus;
    const status = VALID_STATUSES.includes(statusCandidate)
      ? statusCandidate
      : "error";

    return {
      email: String(item.email ?? ""),
      status,
      invite_token:
        typeof item.invite_token === "string" || item.invite_token === null
          ? (item.invite_token as string | null)
          : null,
      message: String(item.message ?? "")
    };
  });

  const summary = summarizeInviteRows(rows);

  const appBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin;

  const inviteLinks = rows
    .filter((row) => row.invite_token)
    .map((row) => ({
      email: row.email,
      status: row.status,
      inviteToken: row.invite_token as string,
      link: `${appBaseUrl}/join?token=${row.invite_token}`
    }));

  const { data: orgData } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const organizationName =
    typeof orgData?.name === "string" && orgData.name.trim().length > 0
      ? orgData.name
      : "sua imobiliaria";

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.INVITE_FROM_EMAIL;
  const allowDevEmail = process.env.INVITE_EMAIL_ENABLE_IN_DEV === "1";
  const emailDeliveryEnabled =
    Boolean(resendApiKey && resendFrom) &&
    (process.env.NODE_ENV === "production" || allowDevEmail);

  let emailsAttempted = 0;
  let emailsSent = 0;
  const emailErrors: EmailDeliveryError[] = [];

  if (emailDeliveryEnabled) {
    for (const invite of inviteLinks) {
      if (invite.status !== "invited" && invite.status !== "resent") {
        continue;
      }

      emailsAttempted += 1;
      const emailResult = await sendInviteEmailViaResend({
        apiKey: resendApiKey as string,
        from: resendFrom as string,
        to: invite.email,
        organizationName,
        inviteLink: invite.link
      });

      if (emailResult.ok) {
        emailsSent += 1;
      } else {
        emailErrors.push({
          email: invite.email,
          status: emailResult.status,
          message: emailResult.message
        });
      }
    }
  }

  revalidatePath("/onboarding/imobiliaria/convidar");
  revalidatePath("/buscador");

  const telemetry = {
    endpoint: `/api/organizations/${organizationId}/invites`,
    requestedEmails: normalizedEmails.length,
    invitesCreated: summary.inserted,
    invitesReused: summary.resent,
    inviteRows: rows.length,
    emailsAttempted,
    emailsSent,
    emailErrors: emailErrors.length
  };

  console.info("[invites][create] response", {
    organizationId,
    userId: user.id,
    ...telemetry
  });

  return NextResponse.json({
    ok: true,
    summary,
    invites: inviteLinks,
    emailDelivery: {
      enabled: emailDeliveryEnabled,
      attempted: emailsAttempted,
      sent: emailsSent,
      errors: emailErrors
    },
    telemetry
  });
}

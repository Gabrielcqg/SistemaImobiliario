"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import {
  getMyOrgRole,
  getOrganizationContext,
  revokeOrganizationInvite,
  type OrganizationRole,
  type OrganizationContext
} from "@/lib/auth/organization";
import { dispatchOrganizationContextRefresh } from "@/lib/auth/organizationEvents";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type InviteApiResponse = {
  ok: boolean;
  summary: {
    inserted: number;
    resent: number;
    alreadyMember: number;
    noSeat: number;
    invalid: number;
    failed: number;
  };
  invites: Array<{
    email: string;
    status: string;
    inviteToken: string;
    link: string;
  }>;
  emailDelivery: {
    enabled: boolean;
    attempted: number;
    sent: number;
    errors: Array<{ email: string; status: number | null; message: string }>;
  };
  telemetry: {
    endpoint: string;
    requestedEmails: number;
    invitesCreated: number;
    invitesReused: number;
    inviteRows: number;
    emailsAttempted: number;
    emailsSent: number;
    emailErrors: number;
  };
  error?: {
    status?: number;
    code?: string;
    message?: string;
  };
};

function parseEmails(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/g)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    )
  );
}

function formatDate(value: string | null) {
  if (!value) return "sem validade";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

async function createInvitesServerSide(
  organizationId: string,
  emails: string[]
): Promise<InviteApiResponse> {
  const response = await fetch(`/api/organizations/${organizationId}/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ emails })
  });

  let payload: InviteApiResponse | null = null;
  try {
    payload = (await response.json()) as InviteApiResponse;
  } catch {
    payload = null;
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[onboarding/invites] endpoint response", {
      httpStatus: response.status,
      payload
    });
  }

  if (!response.ok || !payload?.ok) {
    const errorStatus = payload?.error?.status ?? response.status;
    const errorMessage =
      payload?.error?.message ??
      `Falha ao criar convites (status ${response.status}).`;
    throw new Error(`[${errorStatus}] ${errorMessage}`);
  }

  return payload;
}

export default function BrokerageInvitesOnboardingPage() {
  const searchParams = useSearchParams();
  const showWelcome = searchParams.get("welcome") === "1";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [context, setContext] = useState<OrganizationContext | null>(null);
  const [myOrgRole, setMyOrgRole] = useState<OrganizationRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [workingInviteId, setWorkingInviteId] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [latestInviteLinks, setLatestInviteLinks] = useState<
    Array<{ email: string; link: string; status: string }>
  >([]);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMyOrgRole(null);

    try {
      const nextContext = await getOrganizationContext(supabase);
      if (!nextContext) {
        setError("Nao encontramos uma organizacao ativa para esta conta.");
        setContext(null);
        setMyOrgRole(null);
        return;
      }

      if (nextContext.organization.kind !== "brokerage") {
        setError("Este onboarding e exclusivo para contas de imobiliaria.");
        setContext(nextContext);
        setMyOrgRole(null);
        return;
      }

      const role = await getMyOrgRole(supabase, nextContext.organization.id);
      setContext(nextContext);
      setMyOrgRole(role);
    } catch (contextError) {
      setError(
        contextError instanceof Error
          ? contextError.message
          : "Nao foi possivel carregar os dados da organizacao."
      );
      setContext(null);
      setMyOrgRole(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const pendingInvites = useMemo(
    () => context?.invites.filter((invite) => invite.status === "pending") ?? [],
    [context?.invites]
  );

  const members = context?.members ?? [];

  const seatsTotal = context?.organization.seatsTotal ?? 0;
  const seatsUsed = context?.membersUsed ?? 0;
  const seatsPending = context?.pendingInvites ?? 0;
  const seatsReserved = seatsUsed + seatsPending;
  const seatsAvailable = Math.max(0, seatsTotal - seatsReserved);
  const canManageInvites = myOrgRole === "owner";

  const buildInviteLink = (token: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/join?token=${token}`
      : `/join?token=${token}`;

  const resolveInviteLink = (tokenOrLink: string) => {
    if (tokenOrLink.startsWith("http://") || tokenOrLink.startsWith("https://")) {
      return tokenOrLink;
    }
    if (tokenOrLink.startsWith("/join?")) {
      return typeof window !== "undefined"
        ? `${window.location.origin}${tokenOrLink}`
        : tokenOrLink;
    }
    return buildInviteLink(tokenOrLink);
  };

  const handleSendInvites = async () => {
    if (!context || !canManageInvites) {
      return;
    }

    const emails = parseEmails(inviteInput);
    if (emails.length === 0) {
      setInviteError("Informe pelo menos um e-mail valido.");
      return;
    }

    if (emails.length > seatsAvailable) {
      setInviteError(
        `Voce tem ${seatsAvailable} vaga(s) disponivel(is). Remova alguns e-mails ou ajuste o plano.`
      );
      return;
    }

    setInvitesLoading(true);
    setInviteError(null);
    setInviteStatus(null);

    try {
      const result = await createInvitesServerSide(context.organization.id, emails);
      setInviteInput("");
      setLatestInviteLinks(
        result.invites.map((invite) => ({
          email: invite.email,
          link: invite.link,
          status: invite.status
        }))
      );

      const statusParts = [`Enviados: ${result.summary.inserted}`];
      if (result.summary.resent > 0) statusParts.push(`reenviados: ${result.summary.resent}`);
      if (result.summary.alreadyMember > 0)
        statusParts.push(`ja membros: ${result.summary.alreadyMember}`);
      if (result.summary.invalid > 0) statusParts.push(`invalidos: ${result.summary.invalid}`);
      if (result.summary.failed > 0) statusParts.push(`falhas: ${result.summary.failed}`);
      statusParts.push(`emails enviados: ${result.emailDelivery.sent}`);
      setInviteStatus(statusParts.join(" · "));

      if (result.summary.noSeat > 0) {
        setInviteError(
          "Alguns convites nao foram enviados por falta de assentos disponiveis."
        );
      }

      if (result.emailDelivery.errors.length > 0) {
        const firstError = result.emailDelivery.errors[0];
        const extraErrors =
          result.emailDelivery.errors.length > 1
            ? ` (+${result.emailDelivery.errors.length - 1} erro(s))`
            : "";
        setInviteError(
          `Convites criados, mas houve falha no envio de e-mail: [${firstError.status ?? "?"}] ${firstError.message}${extraErrors}`
        );
      }

      if (process.env.NODE_ENV !== "production") {
        console.info("[onboarding/invites] telemetry", result.telemetry);
      }

      await loadContext();
      dispatchOrganizationContextRefresh();
    } catch (sendError) {
      setInviteError(
        sendError instanceof Error
          ? sendError.message
          : "Nao foi possivel enviar convites."
      );
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleCopyInviteLink = async (inviteId: string, token: string) => {
    try {
      await navigator.clipboard.writeText(resolveInviteLink(token));
      setCopiedInviteId(inviteId);
      window.setTimeout(() => {
        setCopiedInviteId((previous) => (previous === inviteId ? null : previous));
      }, 2500);
    } catch {
      setInviteError("Nao foi possivel copiar o link. Copie manualmente.");
    }
  };

  const handleResendInvite = async (inviteId: string, email: string) => {
    if (!context || !canManageInvites) {
      return;
    }

    setWorkingInviteId(inviteId);
    setInviteError(null);
    setInviteStatus(null);

    try {
      const result = await createInvitesServerSide(context.organization.id, [email]);
      setLatestInviteLinks(
        result.invites.map((invite) => ({
          email: invite.email,
          link: invite.link,
          status: invite.status
        }))
      );

      if (result.summary.noSeat > 0) {
        setInviteError("Sem assentos disponiveis para reenviar este convite.");
      } else {
        setInviteStatus(
          `Convite processado: enviados ${result.summary.inserted}, reenviados ${result.summary.resent}, emails enviados ${result.emailDelivery.sent}.`
        );
      }

      if (result.emailDelivery.errors.length > 0) {
        const firstError = result.emailDelivery.errors[0];
        setInviteError(
          `Convite atualizado, mas e-mail falhou: [${firstError.status ?? "?"}] ${firstError.message}`
        );
      }

      await loadContext();
      dispatchOrganizationContextRefresh();
    } catch (resendError) {
      setInviteError(
        resendError instanceof Error
          ? resendError.message
          : "Nao foi possivel reenviar este convite."
      );
    } finally {
      setWorkingInviteId(null);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!context || !canManageInvites) {
      return;
    }

    setWorkingInviteId(inviteId);
    setInviteError(null);
    setInviteStatus(null);

    try {
      const revoked = await revokeOrganizationInvite(supabase, inviteId);
      setInviteStatus(revoked ? "Convite cancelado." : "Convite ja nao estava pendente.");
      await loadContext();
      dispatchOrganizationContextRefresh();
    } catch (cancelError) {
      setInviteError(
        cancelError instanceof Error
          ? cancelError.message
          : "Nao foi possivel cancelar este convite."
      );
    } finally {
      setWorkingInviteId(null);
    }
  };

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <div className="h-3 w-40 animate-pulse rounded bg-zinc-800/80" />
          <div className="h-9 w-72 animate-pulse rounded bg-zinc-800/80" />
          <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`onboarding-skeleton-stat-${index}`}
              className="rounded-xl border border-zinc-800 bg-black/30 p-4"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-800/80" />
              <div className="mt-3 h-8 w-12 animate-pulse rounded bg-zinc-800/80" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="h-4 w-full animate-pulse rounded bg-zinc-800/70" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-zinc-800/60" />
          <div className="mt-4 h-28 w-full animate-pulse rounded-lg bg-zinc-900/80" />
        </div>
      </section>
    );
  }

  if (!context || context.organization.kind !== "brokerage") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-xl font-semibold text-white">Onboarding indisponivel</h2>
        <p className="text-sm text-zinc-300">
          {error ?? "Nao foi possivel identificar uma conta de imobiliaria ativa."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/buscador" className="text-sm text-white underline underline-offset-4">
            Ir para dashboard
          </Link>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="text-sm text-zinc-300 underline underline-offset-4"
          >
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  if (myOrgRole !== "owner") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-4 rounded-2xl border border-red-500/35 bg-red-500/10 p-6">
        <h2 className="text-xl font-semibold text-white">403 | Sem permissao</h2>
        <p className="text-sm text-red-100">
          Apenas o criador da organizacao (owner) pode acessar o onboarding da equipe.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/buscador" className="text-sm text-white underline underline-offset-4">
            Voltar para o dashboard
          </Link>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="text-sm text-red-100 underline underline-offset-4"
          >
            Revalidar permissao
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">ONBOARDING EQUIPE</p>
        <h2 className="text-3xl font-semibold text-white">Convide seus corretores</h2>
        <p className="max-w-3xl text-sm text-zinc-300">
          Cada corretor tera uma conta propria (email/senha ou login por codigo) e ficara
          vinculado a organizacao <span className="font-medium text-white">{context.organization.name}</span>.
          Cada membro ativo ocupa 1 vaga.
        </p>
      </div>

      {showWelcome ? (
        <p className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Conta criada com sucesso. Agora finalize a configuracao da equipe.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Vagas contratadas</p>
          <p className="mt-2 text-2xl font-semibold text-white">{seatsTotal}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Membros ativos</p>
          <p className="mt-2 text-2xl font-semibold text-white">{seatsUsed}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Convites pendentes</p>
          <p className="mt-2 text-2xl font-semibold text-white">{seatsPending}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Vagas disponiveis</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-200">{seatsAvailable}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <p className="text-sm text-zinc-200">
          Voce contratou <span className="font-semibold text-white">{seatsTotal}</span> vagas.
          Hoje ha <span className="font-semibold text-white">{seatsReserved}</span> reservadas
          (ativos + pendentes).
        </p>

        <label htmlFor="brokerage-invite-input" className="text-sm text-zinc-300">
          Convide por e-mail (separe por virgula ou linha)
        </label>
        <textarea
          id="brokerage-invite-input"
          className="min-h-[120px] w-full rounded-lg border border-zinc-800 bg-black/50 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          placeholder="joao@imobiliaria.com, maria@imobiliaria.com"
          value={inviteInput}
          onChange={(event) => setInviteInput(event.target.value)}
          disabled={invitesLoading || !canManageInvites}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSendInvites}
            disabled={
              invitesLoading || !canManageInvites || seatsAvailable <= 0 || inviteInput.trim().length === 0
            }
            aria-disabled={
              invitesLoading || !canManageInvites || seatsAvailable <= 0 || inviteInput.trim().length === 0
            }
          >
            {invitesLoading ? "Enviando convites..." : "Enviar convites"}
          </Button>

          <Link
            href="/buscador"
            className="text-sm text-zinc-300 underline underline-offset-4 hover:text-white"
          >
            Pular por enquanto
          </Link>

          <Link
            href="/buscador"
            className="text-sm text-white underline underline-offset-4"
          >
            Ir para dashboard
          </Link>
        </div>

        {!canManageInvites ? (
          <p className="text-sm text-amber-200">
            Apenas o owner pode enviar ou cancelar convites.
          </p>
        ) : null}

        {inviteError ? (
          <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {inviteError}
          </p>
        ) : null}

        {inviteStatus ? (
          <p className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {inviteStatus}
          </p>
        ) : null}

        {latestInviteLinks.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-black/30 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Links gerados agora
            </p>
            <ul className="space-y-2">
              {latestInviteLinks.map((invite) => (
                <li
                  key={`${invite.email}-${invite.link}`}
                  className="rounded-lg border border-zinc-800 px-3 py-2"
                >
                  <p className="text-sm text-zinc-100">
                    {invite.email} · {invite.status}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-emerald-200 underline underline-offset-4"
                    onClick={() =>
                      void handleCopyInviteLink(`${invite.email}-${invite.link}`, invite.link)
                    }
                  >
                    Copiar link
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <h3 className="text-lg font-semibold text-white">Convites pendentes</h3>
          {pendingInvites.length === 0 ? (
            <p className="text-sm text-zinc-400">Nenhum convite pendente no momento.</p>
          ) : (
            <ul className="space-y-3">
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-3"
                >
                  <p className="text-sm font-medium text-zinc-100">{invite.email}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Expira em {formatDate(invite.expiresAt)} · role {invite.role}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      type="button"
                      className="text-emerald-200 underline underline-offset-4"
                      onClick={() => void handleCopyInviteLink(invite.id, invite.inviteToken)}
                    >
                      {copiedInviteId === invite.id ? "Link copiado" : "Copiar link"}
                    </button>
                    <button
                      type="button"
                      className="text-zinc-300 underline underline-offset-4"
                      disabled={workingInviteId === invite.id || !canManageInvites}
                      onClick={() => void handleResendInvite(invite.id, invite.email)}
                    >
                      {workingInviteId === invite.id ? "Processando..." : "Reenviar"}
                    </button>
                    <button
                      type="button"
                      className="text-red-200 underline underline-offset-4"
                      disabled={workingInviteId === invite.id || !canManageInvites}
                      onClick={() => void handleCancelInvite(invite.id)}
                    >
                      Cancelar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <h3 className="text-lg font-semibold text-white">Membros da imobiliaria</h3>
          {members.length === 0 ? (
            <p className="text-sm text-zinc-400">Nenhum membro carregado.</p>
          ) : (
            <ul className="space-y-3">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-3"
                >
                  <p className="text-sm font-medium text-zinc-100">
                    {member.role.toUpperCase()}
                    {member.status !== "active" ? ` · ${member.status.toUpperCase()}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    user_id: {member.userId.slice(0, 8)}...
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <h3 className="text-lg font-semibold text-white">Historico de convites</h3>
        {context.invites.length === 0 ? (
          <p className="text-sm text-zinc-400">Voce ainda nao enviou convites.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {context.invites.map((invite) => (
              <li key={invite.id} className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2">
                <p className="text-sm text-zinc-100">{invite.email}</p>
                <p className="text-xs text-zinc-500">
                  {invite.status} · criado em {formatDate(invite.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

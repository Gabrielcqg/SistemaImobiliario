"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import {
  getMyOrgRole,
  getOrganizationContext,
  increaseOrganizationSeats,
  revokeOrganizationInvite,
  type OrganizationRole,
  type OrganizationContext,
  type OrganizationInviteStatus
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

function statusLabel(status: OrganizationInviteStatus) {
  if (status === "pending") return "Pendente";
  if (status === "accepted") return "Aceito";
  if (status === "revoked") return "Cancelado";
  return "Expirado";
}

function statusStyle(status: OrganizationInviteStatus) {
  if (status === "pending") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  if (status === "accepted") return "border-sky-500/35 bg-sky-500/10 text-sky-200";
  if (status === "revoked") return "border-red-500/35 bg-red-500/10 text-red-200";
  return "border-amber-500/35 bg-amber-500/10 text-amber-200";
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
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatsInput, setSeatsInput] = useState("1");
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const [seatsStatus, setSeatsStatus] = useState<string | null>(null);
  const [latestInviteLinks, setLatestInviteLinks] = useState<
    Array<{ email: string; link: string; status: string; inviteToken: string }>
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

  useEffect(() => {
    if (!context) return;
    const pendingTokens = new Set(
      context.invites
        .filter((invite) => invite.status === "pending")
        .map((invite) => invite.inviteToken)
    );
    setLatestInviteLinks((previous) =>
      previous.filter((invite) => pendingTokens.has(invite.inviteToken))
    );
  }, [context]);

  const activeInvites = useMemo(
    () => context?.invites.filter((invite) => invite.status === "pending") ?? [],
    [context?.invites]
  );
  const inviteHistory = useMemo(
    () => context?.invites.filter((invite) => invite.status !== "pending") ?? [],
    [context?.invites]
  );

  const members = context?.members ?? [];

  const seatsTotal = context?.organization.seatsTotal ?? 0;
  const seatsUsed = context?.membersUsed ?? 0;
  const seatsPending = context?.pendingInvites ?? 0;
  const seatsReserved = seatsUsed + seatsPending;
  const seatsAvailable = Math.max(0, seatsTotal - seatsReserved);
  const canManageTeam = myOrgRole === "owner" || myOrgRole === "admin";

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
    if (!context || !canManageTeam) {
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
          status: invite.status,
          inviteToken: invite.inviteToken
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
    if (!context || !canManageTeam) {
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
          status: invite.status,
          inviteToken: invite.inviteToken
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

  const handleCancelInvite = async (inviteId: string, inviteToken: string) => {
    if (!context || !canManageTeam) {
      return;
    }

    setWorkingInviteId(inviteId);
    setInviteError(null);
    setInviteStatus(null);

    try {
      const revoked = await revokeOrganizationInvite(supabase, inviteId);
      setInviteStatus(revoked ? "Convite cancelado." : "Convite ja nao estava pendente.");
      if (revoked) {
        setLatestInviteLinks((previous) =>
          previous.filter((invite) => invite.inviteToken !== inviteToken)
        );
        setContext((previous) => {
          if (!previous) return previous;
          const nextInvites = previous.invites.map((invite) =>
            invite.id === inviteId
              ? { ...invite, status: "revoked" as const, expiresAt: new Date().toISOString() }
              : invite
          );
          const nextPending = nextInvites.filter((invite) => invite.status === "pending").length;
          return {
            ...previous,
            invites: nextInvites,
            pendingInvites: nextPending
          };
        });
      }
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

  const handleIncreaseSeats = async () => {
    if (!context || !canManageTeam) {
      return;
    }

    const requestedSeats = Number.parseInt(seatsInput, 10);
    if (!Number.isFinite(requestedSeats) || requestedSeats < 1) {
      setSeatsError("Informe um numero valido de vagas para adicionar.");
      return;
    }

    setSeatsLoading(true);
    setSeatsError(null);
    setSeatsStatus(null);

    try {
      const result = await increaseOrganizationSeats(
        supabase,
        context.organization.id,
        requestedSeats
      );
      setContext((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          organization: {
            ...previous.organization,
            seatsTotal: result.seatsTotal
          },
          membersUsed: result.seatsUsed,
          pendingInvites: result.pendingInvites
        };
      });
      setSeatsStatus(
        `Limite atualizado para ${result.seatsTotal} vagas. Disponiveis agora: ${result.seatsAvailable}.`
      );
      setSeatsInput("1");
      await loadContext();
      dispatchOrganizationContextRefresh();
    } catch (increaseError) {
      setSeatsError(
        increaseError instanceof Error
          ? increaseError.message
          : "Nao foi possivel aumentar as vagas agora."
      );
    } finally {
      setSeatsLoading(false);
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
            className="accent-outline accent-sheen accent-focus inline-flex rounded-full px-3 py-1 text-sm text-zinc-200 hover:text-white focus-visible:outline-none"
          >
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  if (myOrgRole !== "owner" && myOrgRole !== "admin") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-4 rounded-2xl border border-red-500/35 bg-red-500/10 p-6">
        <h2 className="text-xl font-semibold text-white">403 | Sem permissao</h2>
        <p className="text-sm text-red-100">
          Apenas owner/admin podem acessar o onboarding da equipe.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/buscador" className="text-sm text-white underline underline-offset-4">
            Voltar para o dashboard
          </Link>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="accent-outline accent-sheen accent-focus inline-flex rounded-full px-3 py-1 text-sm text-red-100 hover:text-white focus-visible:outline-none"
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
        <p className="accent-text text-xs uppercase tracking-[0.3em]">ONBOARDING EQUIPE</p>
        <h2 className="text-3xl font-semibold text-white">Convide seus corretores</h2>
        <p className="max-w-3xl text-sm text-zinc-300">
          Cada corretor tera uma conta propria (email/senha ou login por codigo) e ficara
          vinculado a organizacao <span className="font-medium text-white">{context.organization.name}</span>.
          Cada membro ativo ocupa 1 vaga.
        </p>
      </div>

      {showWelcome ? (
        <p className="rounded-xl accent-alert px-4 py-3 text-sm text-sky-100">
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
          <p className="accent-text mt-2 text-2xl font-semibold">{seatsAvailable}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <p className="text-sm text-zinc-200">
          Voce contratou <span className="font-semibold text-white">{seatsTotal}</span> vagas.
          Hoje ha <span className="font-semibold text-white">{seatsReserved}</span> reservadas
          (ativos + pendentes).
        </p>

        <div
          className={`rounded-xl border p-4 ${
            seatsAvailable <= 0
              ? "border-amber-400/45 bg-amber-500/10"
              : "border-zinc-800 bg-black/30"
          }`}
        >
          <p className="text-sm font-medium text-white">
            {seatsAvailable <= 0
              ? "Voce atingiu o limite de vagas da equipe."
              : "Precisa adicionar mais vagas?"}
          </p>
          <p className="mt-1 text-xs text-zinc-300">
            Vagas totais: {seatsTotal} · usadas: {seatsUsed} · pendentes: {seatsPending} ·
            disponiveis: {seatsAvailable}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label htmlFor="add-seats-input" className="text-xs text-zinc-300">
              Adicionar vagas
            </label>
            <input
              id="add-seats-input"
              type="number"
              min={1}
              inputMode="numeric"
              className="accent-focus w-24 rounded-lg border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-white focus:outline-none"
              value={seatsInput}
              onChange={(event) => setSeatsInput(event.target.value)}
              disabled={!canManageTeam || seatsLoading}
            />
            <Button onClick={handleIncreaseSeats} disabled={!canManageTeam || seatsLoading}>
              {seatsLoading ? "Atualizando..." : "Aumentar vagas"}
            </Button>
          </div>
          {!canManageTeam ? (
            <p className="mt-2 text-xs text-amber-200">
              Apenas owner/admin podem aumentar vagas.
            </p>
          ) : null}
          {seatsError ? (
            <p className="mt-2 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {seatsError}
            </p>
          ) : null}
          {seatsStatus ? (
            <p className="mt-2 rounded-lg accent-alert px-3 py-2 text-xs">{seatsStatus}</p>
          ) : null}
        </div>

        <label htmlFor="brokerage-invite-input" className="text-sm text-zinc-300">
          Convide por e-mail (separe por virgula ou linha)
        </label>
        <textarea
          id="brokerage-invite-input"
          className="accent-focus min-h-[120px] w-full rounded-lg border border-zinc-800 bg-black/50 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          placeholder="joao@imobiliaria.com, maria@imobiliaria.com"
          value={inviteInput}
          onChange={(event) => setInviteInput(event.target.value)}
          disabled={invitesLoading || !canManageTeam}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSendInvites}
            disabled={
              invitesLoading || !canManageTeam || seatsAvailable <= 0 || inviteInput.trim().length === 0
            }
            aria-disabled={
              invitesLoading || !canManageTeam || seatsAvailable <= 0 || inviteInput.trim().length === 0
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

        {!canManageTeam ? (
          <p className="text-sm text-amber-200">
            Apenas owner/admin podem enviar, reenviar ou cancelar convites.
          </p>
        ) : null}

        {seatsAvailable <= 0 ? (
          <p className="text-sm text-amber-200">
            Sem vagas disponiveis. Use o bloco acima para aumentar o limite da equipe.
          </p>
        ) : null}

        {inviteError ? (
          <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {inviteError}
          </p>
        ) : null}

        {inviteStatus ? (
          <p className="rounded-lg accent-alert px-3 py-2 text-sm">
            {inviteStatus}
          </p>
        ) : null}

        {latestInviteLinks.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-black/30 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Links ativos gerados agora
            </p>
            <ul className="space-y-2">
              {latestInviteLinks.map((invite) => (
                <li
                  key={`${invite.email}-${invite.inviteToken}`}
                  className="rounded-lg border border-zinc-800 px-3 py-2"
                >
                  <p className="text-sm text-zinc-100">
                    {invite.email} · {invite.status}
                  </p>
                  <button
                    type="button"
                    className="accent-link text-xs underline underline-offset-4"
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
          <h3 className="text-lg font-semibold text-white">Convites ativos</h3>
          {activeInvites.length === 0 ? (
            <p className="text-sm text-zinc-400">Nenhum convite pendente no momento.</p>
          ) : (
            <ul className="space-y-3">
              {activeInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-3"
                >
                  <p className="text-sm font-medium text-zinc-100">{invite.email}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    <span
                      className={`mr-2 inline-flex rounded-full border px-2 py-0.5 ${statusStyle(invite.status)}`}
                    >
                      {statusLabel(invite.status)}
                    </span>
                    Expira em {formatDate(invite.expiresAt)} · role {invite.role}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      type="button"
                      className="accent-outline accent-sheen accent-focus rounded-full px-2.5 py-1 text-zinc-100 hover:text-white focus-visible:outline-none"
                      onClick={() => void handleCopyInviteLink(invite.id, invite.inviteToken)}
                    >
                      {copiedInviteId === invite.id ? "Link copiado" : "Copiar link"}
                    </button>
                    <button
                      type="button"
                      className="accent-outline accent-sheen accent-focus rounded-full px-2.5 py-1 text-zinc-200 hover:text-white focus-visible:outline-none"
                      disabled={workingInviteId === invite.id || !canManageTeam}
                      onClick={() => void handleResendInvite(invite.id, invite.email)}
                    >
                      {workingInviteId === invite.id ? "Processando..." : "Reenviar"}
                    </button>
                    <button
                      type="button"
                      className="accent-outline accent-sheen accent-focus rounded-full px-2.5 py-1 text-red-200 hover:text-white focus-visible:outline-none"
                      disabled={workingInviteId === invite.id || !canManageTeam}
                      onClick={() => void handleCancelInvite(invite.id, invite.inviteToken)}
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
        {inviteHistory.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Nenhum convite cancelado, aceito ou expirado no historico.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {inviteHistory.map((invite) => (
              <li key={invite.id} className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2">
                <p className="text-sm text-zinc-100">{invite.email}</p>
                <p className="text-xs text-zinc-500">
                  <span
                    className={`mr-2 inline-flex rounded-full border px-2 py-0.5 ${statusStyle(invite.status)}`}
                  >
                    {statusLabel(invite.status)}
                  </span>
                  criado em {formatDate(invite.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

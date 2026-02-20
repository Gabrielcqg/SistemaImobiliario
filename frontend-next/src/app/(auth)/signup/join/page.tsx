"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPageCard from "@/components/auth/AuthPageCard";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  acceptOrganizationInviteForAuthenticatedUser,
  type AcceptInviteError,
  getInvitePreview
} from "@/lib/auth/organization";
import {
  mapAuthErrorMessage,
  validateEmail,
  validateFullName,
  validatePassword
} from "@/components/auth/authHelpers";

type JoinView = "loading" | "choose" | "form" | "sent" | "invalid";
type AuthState = "loading" | "signedOut" | "signedIn";
type InviteState = "ready" | "accepting" | "accepted" | "error";
type JoinAcceptTrigger = "signed_in_confirm" | "retry";

type TechnicalErrorDetails = {
  message: string;
  code?: string;
  status: number | null;
  details?: string | null;
  hint?: string | null;
  stack?: string;
};

type JoinTechnicalDetails = {
  token: string;
  authState: AuthState;
  sessionEmail: string | null;
  userId: string | null;
  trigger: JoinAcceptTrigger | null;
  rpcName: string | null;
  payload: Record<string, unknown> | null;
  status: number | null;
  response: unknown;
  error: TechnicalErrorDetails | null;
};

type SessionUserLike = {
  id?: string;
  email?: string | null;
};

type SessionLike = {
  user?: SessionUserLike;
} | null;

const ACCEPT_INVITE_TIMEOUT_MS = 10_000;
const PRIMARY_ACCEPT_RPC = "accept_org_invite";
const PRIMARY_ACCEPT_PAYLOAD_KEY = "_token";
const ACCOUNT_CREATED_CONFIRMATION_MESSAGE =
  "Conta criada. Agora confirme se deseja aceitar o convite nesta conta.";
const ACCEPTING_MESSAGE = "Aceitando convite...";
const ALREADY_MEMBER_MESSAGE = "Voce ja faz parte desta imobiliaria.";
const ACCEPTED_MESSAGE = "Convite aceito ✅";
const DASHBOARD_PATH = "/buscador";
const ACCEPTED_REDIRECT_DELAY_MS = 700;

function isNotAuthenticatedError(error: TechnicalErrorDetails) {
  return (
    error.code === "not_authenticated" ||
    error.message.toLowerCase().includes("not_authenticated") ||
    error.message.toLowerCase().includes("authentication required") ||
    error.message.toLowerCase().includes("autentic")
  );
}

function withInviteAcceptTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      const timeoutError = new Error(
        "Falha ao validar convite. Veja detalhes abaixo."
      ) as AcceptInviteError;
      timeoutError.code = "invite_accept_timeout";
      timeoutError.status = 408;
      timeoutError.details = `Invite accept RPC timed out after ${timeoutMs}ms.`;
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export default function SignupJoinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const token = (searchParams.get("token") ?? "").trim();
  const isDevelopment = process.env.NODE_ENV !== "production";

  const acceptInFlightRef = useRef(false);
  const hasAcceptedRef = useRef(false);
  const previousAuthStateRef = useRef<AuthState | null>(null);
  const membershipCheckKeyRef = useRef<string>("");
  const acceptedRedirectTimeoutRef = useRef<number | null>(null);

  const [view, setView] = useState<JoinView>("loading");
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteInfo, setInviteInfo] = useState<{
    organizationId: string;
    organizationName: string;
    inviteEmail: string;
    inviteRole: string;
  } | null>(null);

  const [signupLoading, setSignupLoading] = useState(false);
  const [inviteState, setInviteState] = useState<InviteState>("ready");
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  const [technicalDetails, setTechnicalDetails] = useState<JoinTechnicalDetails>({
    token,
    authState: "loading",
    sessionEmail: null,
    userId: null,
    trigger: null,
    rpcName: null,
    payload: null,
    status: null,
    response: null,
    error: null
  });

  const appendDebugEvent = useCallback(
    (message: string, extra?: Record<string, unknown>) => {
      if (!isDevelopment) {
        return;
      }

      const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
      const line = `${new Date().toISOString()} ${message}${suffix}`;
      setDebugEvents((previous) => [line, ...previous].slice(0, 20));
    },
    [isDevelopment]
  );

  const joinReturnPath = useMemo(() => {
    if (!token) {
      return "/join";
    }

    const query = new URLSearchParams();
    query.set("token", token);
    return `/join?${query.toString()}`;
  }, [token]);

  const loginHref = useMemo(
    () => `/login?redirectedFrom=${encodeURIComponent(joinReturnPath)}`,
    [joinReturnPath]
  );

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined" || !token) {
      return undefined;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", joinReturnPath);
    return callbackUrl.toString();
  }, [joinReturnPath, token]);

  useEffect(() => {
    setTechnicalDetails((previous) => ({
      ...previous,
      token
    }));

    if (isDevelopment) {
      console.info("[join] token recebido", { token });
      appendDebugEvent("Token recebido na /join", { token });
    }
  }, [appendDebugEvent, isDevelopment, token]);

  useEffect(() => {
    if (acceptedRedirectTimeoutRef.current !== null) {
      window.clearTimeout(acceptedRedirectTimeoutRef.current);
      acceptedRedirectTimeoutRef.current = null;
    }
    setAuthState(token ? "loading" : "signedOut");
    setSessionEmail(null);
    setSessionUserId(null);
    setInviteState("ready");
    setAlreadyMember(false);
    setSuccess(null);
    setError(null);
    membershipCheckKeyRef.current = "";
    hasAcceptedRef.current = false;
  }, [token]);

  useEffect(() => {
    setTechnicalDetails((previous) => ({
      ...previous,
      authState,
      sessionEmail,
      userId: sessionUserId
    }));

    if (!isDevelopment) {
      return;
    }

    if (previousAuthStateRef.current !== authState) {
      console.info("[join] authState transition", {
        from: previousAuthStateRef.current,
        to: authState,
        sessionEmail,
        token
      });
      appendDebugEvent("Auth state transition", {
        from: previousAuthStateRef.current,
        to: authState,
        sessionEmail
      });
      previousAuthStateRef.current = authState;
    }
  }, [appendDebugEvent, authState, isDevelopment, sessionEmail, sessionUserId, token]);

  useEffect(() => {
    let active = true;

    const applySession = (session: SessionLike) => {
      if (!active) {
        return;
      }

      if (!session?.user?.id) {
        setAuthState("signedOut");
        setSessionUserId(null);
        setSessionEmail(null);
        return;
      }

      setAuthState("signedIn");
      setSessionUserId(session.user.id);
      setSessionEmail(typeof session.user.email === "string" ? session.user.email : null);
    };

    if (!token) {
      applySession(null);
      return () => {
        active = false;
      };
    }

    setAuthState("loading");

    const loadSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (sessionError) {
        applySession(null);
        if (isDevelopment) {
          console.error("[join] getSession error", {
            message: sessionError.message,
            status: sessionError.status,
            name: sessionError.name
          });
          appendDebugEvent("getSession error", {
            message: sessionError.message,
            status: sessionError.status
          });
        }
        return;
      }

      applySession(data.session as SessionLike);

      if (isDevelopment) {
        console.info("[join] session resolved", {
          signedIn: Boolean(data.session?.user),
          email: data.session?.user?.email ?? null,
          token
        });
      }
    };

    void loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session as SessionLike);
      if (isDevelopment) {
        console.info("[join] auth event", {
          event,
          email: session?.user?.email ?? null
        });
        appendDebugEvent("Auth event", {
          event,
          email: session?.user?.email ?? null
        });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [appendDebugEvent, isDevelopment, supabase, token]);

  const refreshAuthState = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;

    if (!user?.id) {
      setAuthState("signedOut");
      setSessionUserId(null);
      setSessionEmail(null);
      return null;
    }

    setAuthState("signedIn");
    setSessionUserId(user.id);
    setSessionEmail(user.email ?? null);
    return user;
  }, [supabase]);

  const attemptInviteAccept = useCallback(
    async (trigger: JoinAcceptTrigger) => {
      if (!token || acceptInFlightRef.current || hasAcceptedRef.current) {
        return hasAcceptedRef.current;
      }

      acceptInFlightRef.current = true;
      setInviteState("accepting");
      setError(null);
      setSuccess(ACCEPTING_MESSAGE);

      const requestedPayload = { [PRIMARY_ACCEPT_PAYLOAD_KEY]: token };

      if (authState !== "signedIn") {
        setAuthState("loading");
        const refreshedUser = await refreshAuthState();
        if (!refreshedUser?.id) {
          setInviteState("error");
          setError("Sua sessao nao esta pronta. Entre novamente e tente de novo.");
          setSuccess(null);
          acceptInFlightRef.current = false;
          return false;
        }
      }

      setTechnicalDetails((previous) => ({
        ...previous,
        token,
        trigger,
        rpcName: PRIMARY_ACCEPT_RPC,
        payload: requestedPayload,
        status: null,
        response: null,
        error: null
      }));

      if (isDevelopment) {
        console.info("[join] accept invite request", {
          trigger,
          token,
          rpcName: PRIMARY_ACCEPT_RPC,
          payload: requestedPayload,
          authState,
          sessionEmail
        });
      }

      try {
        const accepted = await withInviteAcceptTimeout(
          acceptOrganizationInviteForAuthenticatedUser(supabase, token),
          ACCEPT_INVITE_TIMEOUT_MS
        );

        const responsePayload = {
          organizationId: accepted.organizationId,
          organizationName: accepted.organizationName,
          role: accepted.role
        };

        setTechnicalDetails((previous) => ({
          ...previous,
          userId: accepted.userId,
          rpcName: accepted.rpcName,
          payload: accepted.payload,
          status: 200,
          response: responsePayload,
          error: null
        }));

        if (isDevelopment) {
          console.info("[join] accept invite response", {
            trigger,
            rpcName: accepted.rpcName,
            payload: accepted.payload,
            status: 200,
            data: responsePayload
          });
        }

        hasAcceptedRef.current = true;
        setInviteState("accepted");
        setError(null);
        setSuccess(ACCEPTED_MESSAGE);
        return true;
      } catch (acceptError) {
        const parsedError = acceptError as AcceptInviteError;
        const technicalError: TechnicalErrorDetails = {
          message:
            parsedError instanceof Error
              ? parsedError.message
              : "Nao foi possivel aceitar o convite.",
          code: parsedError.code,
          status: typeof parsedError.status === "number" ? parsedError.status : null,
          details: parsedError.details ?? null,
          hint: parsedError.hint ?? null,
          stack: parsedError.stack
        };

        setTechnicalDetails((previous) => ({
          ...previous,
          userId: parsedError.userId ?? previous.userId,
          rpcName: parsedError.rpcName ?? previous.rpcName,
          payload:
            (parsedError.payload as Record<string, unknown> | undefined) ?? previous.payload,
          status: technicalError.status,
          response: null,
          error: technicalError
        }));

        if (isDevelopment) {
          console.error("[join] accept invite error", {
            trigger,
            token,
            userId: parsedError.userId,
            rpcName: parsedError.rpcName ?? PRIMARY_ACCEPT_RPC,
            payload: parsedError.payload ?? requestedPayload,
            message: technicalError.message,
            code: technicalError.code,
            status: technicalError.status,
            details: technicalError.details,
            hint: technicalError.hint,
            stack: technicalError.stack
          });
        }

        if (isNotAuthenticatedError(technicalError)) {
          setAuthState("loading");
          await refreshAuthState();
          setInviteState("error");
          setError("Sua sessao expirou. Entre novamente e tente de novo.");
          setSuccess(null);
          return false;
        }

        setInviteState("error");
        if (technicalError.code === "invite_accept_timeout") {
          setError("Falha ao validar convite. Veja detalhes abaixo.");
        } else {
          setError(technicalError.message || "Nao foi possivel aceitar o convite.");
        }
        setSuccess(null);
        return false;
      } finally {
        acceptInFlightRef.current = false;
      }
    },
    [authState, isDevelopment, refreshAuthState, sessionEmail, supabase, token]
  );

  useEffect(() => {
    let active = true;

    const loadInvite = async () => {
      if (!token) {
        setError("Token de convite ausente.");
        setTechnicalDetails((previous) => ({
          ...previous,
          error: {
            message: "Token de convite ausente.",
            code: "invite_invalid_or_expired",
            status: 400,
            details: "Missing token query parameter in /join."
          }
        }));
        setView("invalid");
        return;
      }

      try {
        const preview = await getInvitePreview(supabase, token);

        if (!active) {
          return;
        }

        if (!preview) {
          const previewError: TechnicalErrorDetails = {
            message: "Convite invalido ou expirado.",
            code: "invite_invalid_or_expired",
            status: 404,
            details: "Invite preview RPC returned no rows for this token."
          };

          setError(previewError.message);
          setTechnicalDetails((previous) => ({
            ...previous,
            error: previewError
          }));
          setView("invalid");
          return;
        }

        setInviteInfo({
          organizationId: preview.organizationId,
          organizationName: preview.organizationName,
          inviteEmail: preview.inviteEmail,
          inviteRole: preview.inviteRole
        });
        membershipCheckKeyRef.current = "";
        setEmail(preview.inviteEmail ?? "");
        setError(null);
        setView("choose");
      } catch (previewError) {
        if (!active) {
          return;
        }

        const parsedError =
          previewError instanceof Error
            ? previewError
            : new Error("Nao foi possivel validar o convite.");

        setError(parsedError.message);
        setTechnicalDetails((previous) => ({
          ...previous,
          error: {
            message: parsedError.message,
            code: "invite_preview_error",
            status: null,
            stack: parsedError.stack
          }
        }));
        setView("invalid");
      }
    };

    void loadInvite();

    return () => {
      active = false;
    };
  }, [supabase, token]);

  useEffect(() => {
    return () => {
      if (acceptedRedirectTimeoutRef.current !== null) {
        window.clearTimeout(acceptedRedirectTimeoutRef.current);
        acceptedRedirectTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      authState !== "signedIn" ||
      !sessionUserId ||
      !inviteInfo?.organizationId ||
      view !== "choose" ||
      acceptInFlightRef.current
    ) {
      return;
    }

    const checkKey = `${sessionUserId}:${inviteInfo.organizationId}`;
    if (membershipCheckKeyRef.current === checkKey) {
      return;
    }
    membershipCheckKeyRef.current = checkKey;

    let active = true;

    const checkExistingMembership = async () => {
      let membershipCount = 0;

      const primary = await supabase
        .from("organization_members")
        .select("id", { head: true, count: "exact" })
        .eq("organization_id", inviteInfo.organizationId)
        .eq("user_id", sessionUserId)
        .eq("status", "active");

      if (primary.error && /column .* does not exist|PGRST204/i.test(primary.error.message)) {
        const fallback = await supabase
          .from("organization_members")
          .select("id", { head: true, count: "exact" })
          .eq("organization_id", inviteInfo.organizationId)
          .eq("user_id", sessionUserId);

        if (!active) {
          return;
        }

        if (fallback.error) {
          if (isDevelopment) {
            appendDebugEvent("Erro ao checar membership fallback", {
              message: fallback.error.message
            });
          }
          return;
        }

        membershipCount = fallback.count ?? 0;
      } else if (primary.error) {
        if (isDevelopment) {
          appendDebugEvent("Erro ao checar membership", {
            message: primary.error.message
          });
        }
        return;
      } else {
        membershipCount = primary.count ?? 0;
      }

      if (!active) {
        return;
      }

      if (membershipCount > 0) {
        hasAcceptedRef.current = true;
        setAlreadyMember(true);
        if (inviteState !== "accepting") {
          setInviteState("accepted");
          setError(null);
          setSuccess(ALREADY_MEMBER_MESSAGE);
        }
      } else {
        setAlreadyMember(false);
      }
    };

    void checkExistingMembership();

    return () => {
      active = false;
    };
  }, [
    appendDebugEvent,
    authState,
    inviteInfo?.organizationId,
    inviteState,
    isDevelopment,
    sessionUserId,
    supabase,
    view
  ]);

  useEffect(() => {
    if (inviteState !== "accepted") {
      return;
    }

    if (acceptedRedirectTimeoutRef.current !== null) {
      return;
    }

    acceptedRedirectTimeoutRef.current = window.setTimeout(() => {
      router.replace(DASHBOARD_PATH);
      router.refresh();
      acceptedRedirectTimeoutRef.current = null;
    }, ACCEPTED_REDIRECT_DELAY_MS);
  }, [inviteState, router]);

  const handleGoToLogin = () => {
    router.push(loginHref);
  };

  const handleAcceptSignedIn = async () => {
    await attemptInviteAccept("signed_in_confirm");
  };

  const handleRetryAccept = async () => {
    await attemptInviteAccept("retry");
  };

  const handleGoToDashboard = () => {
    if (acceptedRedirectTimeoutRef.current !== null) {
      window.clearTimeout(acceptedRedirectTimeoutRef.current);
      acceptedRedirectTimeoutRef.current = null;
    }
    router.replace(DASHBOARD_PATH);
    router.refresh();
  };

  const handleSwitchAccount = async () => {
    if (inviteState !== "ready" && inviteState !== "error") {
      return;
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // no-op
    } finally {
      if (acceptedRedirectTimeoutRef.current !== null) {
        window.clearTimeout(acceptedRedirectTimeoutRef.current);
        acceptedRedirectTimeoutRef.current = null;
      }
      hasAcceptedRef.current = false;
      membershipCheckKeyRef.current = "";
      setAlreadyMember(false);
      setAuthState("signedOut");
      setSessionEmail(null);
      setSessionUserId(null);
      setInviteState("ready");
      setSuccess(null);
      setError(null);
      setView("choose");
      if (isDevelopment) {
        appendDebugEvent("Conta local removida em /join");
      }
    }
  };

  const handleCreateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;

    const nameError = validateFullName(name);
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    if (nameError || emailError || passwordError) {
      setError(nameError || emailError || passwordError);
      return;
    }

    if (
      inviteInfo?.inviteEmail &&
      email.trim().toLowerCase() !== inviteInfo.inviteEmail.toLowerCase()
    ) {
      setError("Use o mesmo e-mail que recebeu o convite.");
      return;
    }

    setSignupLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            full_name: name.trim(),
            onboarding_full_name: name.trim(),
            onboarding_account_type: "join",
            onboarding_invite_token: token
          }
        }
      });

      if (signUpError) {
        setError(mapAuthErrorMessage(signUpError.message));
        return;
      }

      if (data.session?.user?.id) {
        setAuthState("signedIn");
        setSessionUserId(data.session.user.id);
        setSessionEmail(data.session.user.email ?? null);
        setInviteState("ready");
        setAlreadyMember(false);
        setView("choose");
        setSuccess(ACCOUNT_CREATED_CONFIRMATION_MESSAGE);
        return;
      }

      setView("sent");
    } catch (signupError) {
      setError(
        signupError instanceof Error
          ? signupError.message
          : "Nao foi possivel concluir seu cadastro."
      );
    } finally {
      setSignupLoading(false);
    }
  };

  const isBusy = signupLoading || inviteState === "accepting";

  if (view === "loading") {
    return (
      <AuthPageCard
        badge="CONVITE"
        title="Validando convite"
        subtitle="Aguarde um instante..."
      >
        <p className="text-sm text-zinc-400">Carregando informacoes do convite.</p>
      </AuthPageCard>
    );
  }

  if (view === "invalid") {
    return (
      <AuthPageCard
        badge="CONVITE"
        title="Convite invalido"
        subtitle="Este link pode ter expirado ou ja foi utilizado."
        backHref="/signup/choose"
        backLabel="Voltar para cadastro"
      >
        {error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {isDevelopment ? (
          <details className="mt-3 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
            <summary className="cursor-pointer font-medium text-zinc-100">
              Detalhes tecnicos
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-300">
              {JSON.stringify(technicalDetails, null, 2)}
            </pre>
          </details>
        ) : null}
      </AuthPageCard>
    );
  }

  if (view === "sent") {
    return (
      <AuthPageCard
        badge="CONVITE"
        title="Confirme seu e-mail"
        subtitle="Depois de confirmar, volte para aceitar o convite nesta conta."
        backHref={loginHref}
        backLabel="Voltar para login"
      >
        <p className="rounded-lg accent-alert px-3 py-2 text-sm text-sky-100">
          Verifique Spam e Lixo eletronico caso o e-mail nao apareca na caixa principal.
          Depois de confirmar, voce volta para esta pagina e escolhe quando aceitar o convite.
        </p>
      </AuthPageCard>
    );
  }

  if (view === "choose") {
    return (
      <AuthPageCard
        badge="CONVITE"
        title="Voce foi convidado"
        subtitle={
          inviteInfo
            ? `Voce foi convidado para entrar na imobiliaria ${inviteInfo.organizationName}.`
            : "Voce foi convidado para entrar em uma imobiliaria."
        }
        backHref="/signup/choose"
        backLabel="Voltar"
      >
        <div className="space-y-4">
          {authState === "loading" ? (
            <p className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200">
              Verificando sessao...
            </p>
          ) : null}

          {authState === "signedOut" ? (
            <>
              <p className="text-sm text-zinc-300">
                Para continuar, crie sua conta ou entre com uma conta existente.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setInviteState("ready");
                    setView("form");
                  }}
                  disabled={isBusy}
                >
                  Criar conta
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleGoToLogin}
                  disabled={isBusy}
                >
                  Entrar
                </Button>
              </div>
            </>
          ) : null}

          {authState === "signedIn" ? (
            <>
              {inviteState === "ready" ? (
                <>
                  <p className="text-sm text-zinc-300">
                    Voce esta logado como{" "}
                    <span className="font-semibold text-zinc-100">
                      {sessionEmail ?? "(sem e-mail)"}
                    </span>
                    . Aceitar convite nessa conta?
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={() => void handleAcceptSignedIn()}
                      disabled={isBusy}
                    >
                      Aceitar convite
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleSwitchAccount()}
                      disabled={isBusy}
                    >
                      Trocar conta
                    </Button>
                  </div>
                </>
              ) : null}

              {inviteState === "accepting" ? (
                <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Aceitando convite...</p>
                      <p className="text-xs text-zinc-400">
                        Aguarde. Nao feche esta tela.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {inviteState === "accepted" ? (
                <div className="space-y-3 rounded-lg accent-card-highlight px-4 py-4">
                  <p className="text-sm font-semibold text-sky-100">
                    {alreadyMember ? ALREADY_MEMBER_MESSAGE : ACCEPTED_MESSAGE}
                  </p>
                  <p className="accent-text text-xs">
                    Redirecionando para o dashboard...
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleGoToDashboard}
                    disabled={isBusy}
                  >
                    Ir para o dashboard
                  </Button>
                </div>
              ) : null}

              {inviteState === "error" ? (
                <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-4">
                  <p className="text-sm text-red-200">
                    {error ?? "Nao foi possivel aceitar o convite."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={() => void handleRetryAccept()}
                      disabled={isBusy}
                    >
                      Tentar novamente
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleSwitchAccount()}
                      disabled={isBusy}
                    >
                      Trocar conta
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {error && !(authState === "signedIn" && inviteState === "error") ? (
            <p
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          ) : null}

          {success &&
          !(authState === "signedIn" &&
            (inviteState === "accepting" || inviteState === "accepted")) ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg accent-alert px-3 py-2 text-sm"
            >
              {success}
            </p>
          ) : null}

          {isDevelopment ? (
            <details className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
              <summary className="cursor-pointer font-medium text-zinc-100">
                Detalhes tecnicos
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-300">
                {JSON.stringify(technicalDetails, null, 2)}
              </pre>
              {debugEvents.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
                  {debugEvents.map((event) => (
                    <li key={event}>{event}</li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}
        </div>
      </AuthPageCard>
    );
  }

  const technicalDetailsBlock =
    isDevelopment ? (
      <details className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
        <summary className="cursor-pointer font-medium text-zinc-100">
          Detalhes tecnicos
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-300">
          {JSON.stringify(technicalDetails, null, 2)}
        </pre>
      </details>
    ) : null;

  return (
    <AuthPageCard
      badge="CONVITE"
      title="Criar conta por convite"
      subtitle={
        inviteInfo
          ? `Voce esta entrando na imobiliaria ${inviteInfo.organizationName}.`
          : "Complete seu cadastro para entrar na equipe."
      }
      backHref="/signup/choose"
      backLabel="Voltar para cadastro"
      footer={
        <div className="space-y-1">
          <p className="text-sm text-zinc-400">
            Ja possui conta?{" "}
            <button
              type="button"
              onClick={handleGoToLogin}
              className="rim-core rim-secondary inline-flex rounded-full px-2.5 py-1 text-white"
              disabled={isBusy}
            >
              Entrar
            </button>
          </p>
          <button
            type="button"
            onClick={() => setView("choose")}
            className="rim-core rim-secondary inline-flex rounded-full px-2.5 py-1 text-xs text-zinc-300"
            disabled={isBusy}
          >
            Voltar para convite
          </button>
        </div>
      }
    >
      <form onSubmit={handleCreateAccount} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="join-name" className="text-sm text-zinc-300">
            Nome completo
          </label>
          <Input
            id="join-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome completo"
            disabled={isBusy}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="join-email" className="text-sm text-zinc-300">
            Email
          </label>
          <Input
            id="join-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="seu.email@empresa.com"
            disabled={isBusy}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="join-password" className="text-sm text-zinc-300">
            Senha
          </label>
          <Input
            id="join-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Crie uma senha"
            disabled={isBusy}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-lg accent-alert px-3 py-2 text-sm"
          >
            {success}
          </p>
        ) : null}

        {technicalDetailsBlock}

        <Button className="w-full" disabled={isBusy} aria-disabled={isBusy}>
          {signupLoading ? "Concluindo..." : "Criar conta"}
        </Button>
      </form>
    </AuthPageCard>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPageCard from "@/components/auth/AuthPageCard";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { registerCurrentDeviceSession } from "@/lib/auth/deviceSession";
import { getBootstrapContext } from "@/lib/auth/organization";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dispatchNavigationStart } from "@/lib/navigation/progress";
import {
  focusFirstInvalidField,
  mapAuthErrorMessage,
  validateEmail,
  validatePassword
} from "@/components/auth/authHelpers";

type LoginMethod = "password" | "magic";
type LoginField = "email" | "password";
type LoginFieldErrors = Partial<Record<LoginField, string>>;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom");
  const hasConfirmedEmail = searchParams.get("confirmed") === "1";
  const hasConfirmationError = searchParams.get("confirmationError") === "1";
  const sessionLimitReached = searchParams.get("sessionLimit") === "1";
  const sessionReplaced = searchParams.get("sessionReplaced") === "1";

  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const confirmedRef = useRef<HTMLParagraphElement>(null);
  const slowFeedbackTimerRef = useRef<number | null>(null);

  const [method, setMethod] = useState<LoginMethod>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSlowFeedback, setShowSlowFeedback] = useState(false);

  const magicRedirectTo = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", redirectedFrom ?? "/buscador");
    return callbackUrl.toString();
  }, [redirectedFrom]);

  useEffect(() => {
    router.prefetch(redirectedFrom ?? "/buscador");
  }, [router, redirectedFrom]);

  useEffect(() => {
    if (!error) {
      return;
    }
    errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!hasConfirmedEmail) {
      return;
    }
    confirmedRef.current?.focus();
  }, [hasConfirmedEmail]);

  useEffect(() => {
    return () => {
      if (slowFeedbackTimerRef.current !== null) {
        window.clearTimeout(slowFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: LoginFieldErrors = {
      email: validateEmail(email) ?? undefined,
      password:
        method === "password" ? validatePassword(password) ?? undefined : undefined
    };

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      setFieldErrors(nextErrors);
      setError(null);
      setSuccess(null);
      focusFirstInvalidField(formRef.current, nextErrors, ["email", "password"]);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    setError(null);
    setSuccess(null);
    setShowSlowFeedback(false);

    if (slowFeedbackTimerRef.current !== null) {
      window.clearTimeout(slowFeedbackTimerRef.current);
    }
    slowFeedbackTimerRef.current = window.setTimeout(() => {
      setShowSlowFeedback(true);
    }, 800);

    try {
      const supabase = createSupabaseBrowserClient();

      if (method === "magic") {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: magicRedirectTo
          }
        });

        if (otpError) {
          setError(mapAuthErrorMessage(otpError, "login"));
          return;
        }

        setSuccess("Enviamos um link de acesso para seu e-mail.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        setError(mapAuthErrorMessage(signInError, "login"));
        return;
      }

      const deviceSession = await registerCurrentDeviceSession(supabase);
      if (deviceSession?.status === "limit_exceeded") {
        await supabase.auth.signOut({ scope: "local" });
        setError(
          "Limite de dispositivos atingido para esta conta. Tente novamente em um dispositivo autorizado."
        );
        return;
      }
      if (deviceSession?.shouldSignOutOthers) {
        await supabase.auth.signOut({ scope: "others" });
      }

      let destinationPath = redirectedFrom ?? "/buscador";
      if (!redirectedFrom) {
        try {
          const organizationContext = await getBootstrapContext(supabase);
          const shouldOpenBrokerageOnboarding =
            organizationContext.organizationKind === "brokerage" &&
            (organizationContext.myRole === "owner" ||
              organizationContext.myRole === "admin") &&
            organizationContext.membersUsed <= 1 &&
            organizationContext.pendingInvites === 0;

          if (shouldOpenBrokerageOnboarding) {
            destinationPath = "/onboarding/imobiliaria/convidar?welcome=1";
          }
        } catch {
          // Ignore organization context lookup failures during login redirect.
        }
      }

      setSuccess("Login realizado. Redirecionando...");
      dispatchNavigationStart();
      router.replace(destinationPath);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Falha ao autenticar."
      );
    } finally {
      if (slowFeedbackTimerRef.current !== null) {
        window.clearTimeout(slowFeedbackTimerRef.current);
      }
      setShowSlowFeedback(false);
      setLoading(false);
    }
  };

  return (
    <AuthPageCard
      badge="LOGIN"
      title="Entrar"
      subtitle="Acesse sua conta em menos de um minuto."
      footer={
        <div className="space-y-2 text-sm">
          <p className="text-zinc-400">
            Nao tem conta?{" "}
            <Link
              href="/signup/choose"
              className="text-white underline underline-offset-4"
            >
              Criar conta
            </Link>
          </p>
          <p>
            <Link
              href="/forgot-password"
              className="text-zinc-300 underline underline-offset-4 hover:text-white"
            >
              Esqueci meu acesso
            </Link>
          </p>
        </div>
      }
    >
      {hasConfirmedEmail ? (
        <p
          ref={confirmedRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
        >
          E-mail confirmado! Agora voce ja pode fazer login.
        </p>
      ) : null}

      {hasConfirmationError ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          Nao foi possivel validar seu link automaticamente. Faca login para continuar.
        </p>
      ) : null}

      {sessionLimitReached ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          Limite de dispositivos atingido para esta conta. Contate o administrador para liberar mais acesso.
        </p>
      ) : null}

      {sessionReplaced ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          Sua conta foi acessada em outro dispositivo. Por seguranca, voce foi desconectado.
        </p>
      ) : null}

      <div
        role="group"
        aria-label="Metodo de acesso"
        className="grid grid-cols-2 rounded-xl border border-zinc-800 bg-black/30 p-1"
      >
        <button
          type="button"
          aria-pressed={method === "password"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
            method === "password"
              ? "bg-white text-black"
              : "text-zinc-300 hover:bg-white/5 hover:text-white"
          }`}
          onClick={() => setMethod("password")}
          disabled={loading}
        >
          Senha
        </button>
        <button
          type="button"
          aria-pressed={method === "magic"}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
            method === "magic"
              ? "bg-white text-black"
              : "text-zinc-300 hover:bg-white/5 hover:text-white"
          }`}
          onClick={() => setMethod("magic")}
          disabled={loading}
        >
          Link por e-mail
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-sm text-zinc-300">
            Email
          </label>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            disabled={loading}
            value={email}
            placeholder="voce@empresa.com"
            onChange={(event) => {
              setEmail(event.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p id="login-email-error" className="text-xs text-red-300">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        {method === "password" ? (
          <div className="space-y-1.5">
            <label htmlFor="login-password" className="text-sm text-zinc-300">
              Senha
            </label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={loading}
              value={password}
              placeholder="Sua senha"
              onChange={(event) => {
                setPassword(event.target.value);
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "login-password-error" : undefined
              }
            />
            {fieldErrors.password ? (
              <p id="login-password-error" className="text-xs text-red-300">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}

        {loading && showSlowFeedback ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-zinc-200"
          >
            Carregando sua conta...
          </p>
        ) : null}

        {success ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            {success}
          </p>
        ) : null}

        <Button className="w-full" disabled={loading} aria-disabled={loading}>
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black"
              />
              {method === "password" ? "Entrando..." : "Enviando link..."}
            </span>
          ) : method === "password" ? (
            "Entrar"
          ) : (
            "Enviar link de acesso"
          )}
        </Button>
      </form>
    </AuthPageCard>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthPageCard from "@/components/auth/AuthPageCard";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureOnboardingOrganization } from "@/lib/auth/organization";
import {
  focusFirstInvalidField,
  logAuthErrorDiagnostics,
  mapAuthErrorMessage,
  validateEmail,
  validateFullName,
  validatePassword
} from "@/components/auth/authHelpers";

type IndividualField = "name" | "email" | "password";
type IndividualFieldErrors = Partial<Record<IndividualField, string>>;

type FormView = "form" | "sent";
const RESEND_COOLDOWN_SECONDS = 60;

export default function SignupIndividualPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const sentTitleRef = useRef<HTMLHeadingElement>(null);
  const submitLockRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const [view, setView] = useState<FormView>("form");
  const [focusEmailOnReturn, setFocusEmailOnReturn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<IndividualFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/login");
    callbackUrl.searchParams.set("confirmed", "1");
    return callbackUrl.toString();
  }, []);

  useEffect(() => {
    if (view !== "sent") {
      return;
    }

    sentTitleRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (!focusEmailOnReturn || view !== "form") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const emailField = formRef.current?.querySelector<HTMLInputElement>(
        'input[name="email"]'
      );
      emailField?.focus();
      emailField?.select();
    });

    setFocusEmailOnReturn(false);
    return () => window.cancelAnimationFrame(frame);
  }, [focusEmailOnReturn, view]);

  useEffect(() => {
    if (cooldownRemaining <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCooldownRemaining((previous) => Math.max(previous - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [cooldownRemaining]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || submitLockRef.current) {
      return;
    }

    const nextErrors: IndividualFieldErrors = {
      name: validateFullName(name) ?? undefined,
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined
    };

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setError(null);
      focusFirstInvalidField(formRef.current, nextErrors, [
        "name",
        "email",
        "password"
      ]);
      return;
    }

    setFieldErrors({});
    submitLockRef.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setResendError(null);
    setResendStatus(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;

      if (process.env.NODE_ENV === "development") {
        console.info("[signup/individual] signup request", {
          requestId,
          endpoint: "/auth/v1/signup",
          email: trimmedEmail
        });
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            full_name: trimmedName,
            onboarding_full_name: trimmedName,
            onboarding_account_type: "individual",
            onboarding_organization_name: `${trimmedName} (Individual)`
          }
        }
      });

      if (signUpError) {
        logAuthErrorDiagnostics("signup-individual/signUp", signUpError, {
          requestId,
          endpoint: "/auth/v1/signup",
          email: trimmedEmail
        });
        setError(mapAuthErrorMessage(signUpError, "signup"));
        return;
      }

      if (data.session) {
        await ensureOnboardingOrganization(supabase, {
          accountType: "individual",
          fullName: trimmedName,
          organizationName: `${trimmedName} (Individual)`
        });

        setSuccess("Conta criada. Redirecionando...");
        router.replace("/buscador");
        router.refresh();
        return;
      }

      setView("sent");
      setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
    } catch (submitError) {
      logAuthErrorDiagnostics("signup-individual/unexpected", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nao foi possivel criar sua conta."
      );
    } finally {
      submitLockRef.current = false;
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (resendLoading || cooldownRemaining > 0) {
      return;
    }

    const emailError = validateEmail(email);
    if (emailError) {
      setResendError(emailError);
      return;
    }

    setResendLoading(true);
    setResendError(null);
    setResendStatus(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const trimmedEmail = email.trim();
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;

      if (process.env.NODE_ENV === "development") {
        console.info("[signup/individual] resend request", {
          requestId,
          endpoint: "/auth/v1/resend",
          email: trimmedEmail
        });
      }

      const { error: resendRequestError } = await supabase.auth.resend({
        type: "signup",
        email: trimmedEmail,
        options: {
          emailRedirectTo: redirectTo
        }
      });

      if (resendRequestError) {
        logAuthErrorDiagnostics("signup-individual/resend", resendRequestError, {
          requestId,
          endpoint: "/auth/v1/resend",
          email: trimmedEmail
        });
        setResendError(mapAuthErrorMessage(resendRequestError, "resend"));
        return;
      }

      setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
      setResendStatus("E-mail reenviado!");
    } catch (resendErrorCaught) {
      logAuthErrorDiagnostics("signup-individual/resend-unexpected", resendErrorCaught);
      setResendError(
        resendErrorCaught instanceof Error
          ? resendErrorCaught.message
          : "Nao foi possivel reenviar o e-mail de confirmacao."
      );
    } finally {
      setResendLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setView("form");
    setResendError(null);
    setResendStatus(null);
    setError(null);
    setSuccess(null);
    setCooldownRemaining(0);
    setFocusEmailOnReturn(true);
  };

  if (view === "sent") {
    const resendDisabled = resendLoading || cooldownRemaining > 0;

    return (
      <AuthPageCard
        badge="CADASTRO INDIVIDUAL"
        title="Confirme seu e-mail"
        subtitle="Enviamos um link para ativar sua conta."
        backHref="/login"
        backLabel="Voltar para login"
        footer={
          <p className="text-sm text-zinc-400">
            Nao recebeu?{" "}
            <Link href="/login" className="text-white underline underline-offset-4">
              Tentar login
            </Link>
          </p>
        }
      >
        <div className="space-y-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4">
          <h2
            ref={sentTitleRef}
            tabIndex={-1}
            className="text-base font-semibold text-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
          >
            Confirme seu e-mail para ativar sua conta
          </h2>
          <p className="text-sm text-zinc-100">
            Enviamos um e-mail para <span className="font-medium">{email.trim()}</span> com o link de confirmacao.
          </p>
          <p className="text-sm text-zinc-100">
            Se nao encontrar o e-mail, verifique Spam e Lixo eletronico.
          </p>
          <p className="text-xs text-zinc-300">
            Procure por HomeRadar no assunto ou remetente.
          </p>
        </div>

        <Button
          type="button"
          className="w-full"
          onClick={handleResendConfirmation}
          disabled={resendDisabled}
          aria-disabled={resendDisabled}
        >
          {resendLoading
            ? "Reenviando..."
            : cooldownRemaining > 0
              ? `Aguarde ${cooldownRemaining}s para reenviar`
              : "Reenviar e-mail de confirmacao"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={handleChangeEmail}
          disabled={resendLoading}
          aria-disabled={resendLoading}
        >
          Trocar e-mail
        </Button>

        {resendStatus ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            {resendStatus}
          </p>
        ) : null}

        {resendError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {resendError}
          </p>
        ) : null}
      </AuthPageCard>
    );
  }

  return (
    <AuthPageCard
      badge="CADASTRO INDIVIDUAL"
      title="Criar conta individual"
      subtitle="Para uso pessoal, com acesso exclusivo para 1 corretor."
      backHref="/signup/choose"
      backLabel="Trocar tipo de conta"
      footer={
        <p className="text-sm text-zinc-400">
          Ja tem conta?{" "}
          <Link href="/login" className="text-white underline underline-offset-4">
            Entrar
          </Link>
        </p>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="individual-name" className="text-sm text-zinc-300">
            Nome completo
          </label>
          <Input
            id="individual-name"
            name="name"
            autoComplete="name"
            autoFocus
            value={name}
            disabled={loading}
            onChange={(event) => {
              setName(event.target.value);
              if (fieldErrors.name) {
                setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            placeholder="Seu nome completo"
          />
          {fieldErrors.name ? (
            <p className="text-xs text-red-300">{fieldErrors.name}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="individual-email" className="text-sm text-zinc-300">
            Email
          </label>
          <Input
            id="individual-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            disabled={loading}
            onChange={(event) => {
              setEmail(event.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="voce@empresa.com"
          />
          {fieldErrors.email ? (
            <p className="text-xs text-red-300">{fieldErrors.email}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="individual-password" className="text-sm text-zinc-300">
            Senha
          </label>
          <Input
            id="individual-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={loading}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            placeholder="Crie uma senha"
          />
          {fieldErrors.password ? (
            <p className="text-xs text-red-300">{fieldErrors.password}</p>
          ) : null}
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
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            {success}
          </p>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
          aria-disabled={loading}
        >
          {loading ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
    </AuthPageCard>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  focusFirstInvalidField,
  mapAuthErrorMessage,
  validateEmail,
  validateFullName,
  validatePassword
} from "@/components/auth/authHelpers";

interface SignupFormProps {
  onSwitchMode: () => void;
}

type SignupView = "form" | "sent";
type SignupField = "name" | "email" | "password";
type SignupFieldErrors = Partial<Record<SignupField, string>>;

const RESEND_COOLDOWN_SECONDS = 45;
const APP_NAME = "Projeto Imobiliaria";

export default function SignupForm({ onSwitchMode }: SignupFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom");

  const formRef = useRef<HTMLFormElement>(null);
  const sentTitleRef = useRef<HTMLHeadingElement>(null);

  const [view, setView] = useState<SignupView>("form");
  const [focusEmailOnReturn, setFocusEmailOnReturn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    const nextErrors: SignupFieldErrors = {
      name: validateFullName(name),
      email: validateEmail(email),
      password: validatePassword(password)
    };

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
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
    setLoading(true);
    setError(null);
    setResendError(null);
    setResendStatus(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            full_name: name.trim()
          }
        }
      });

      if (signUpError) {
        setError(mapAuthErrorMessage(signUpError.message));
        return;
      }

      if (data.session) {
        router.replace(redirectedFrom ?? "/buscador");
        router.refresh();
        return;
      }

      setView("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar conta");
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (resendLoading || cooldownRemaining > 0) {
      return;
    }

    const emailValidationMessage = validateEmail(email);
    if (emailValidationMessage) {
      setResendError(emailValidationMessage);
      return;
    }

    setResendLoading(true);
    setResendError(null);
    setResendStatus(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resendRequestError } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo
        }
      });

      if (resendRequestError) {
        setResendError(mapAuthErrorMessage(resendRequestError.message));
        return;
      }

      setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
      setResendStatus("E-mail reenviado!");
    } catch (err) {
      setResendError(
        err instanceof Error ? err.message : "Nao foi possivel reenviar o e-mail."
      );
    } finally {
      setResendLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setView("form");
    setResendError(null);
    setResendStatus(null);
    setCooldownRemaining(0);
    setFocusEmailOnReturn(true);
  };

  if (view === "sent") {
    const resendDisabled = resendLoading || cooldownRemaining > 0;

    return (
      <section className="mt-2 space-y-4" aria-label="Cadastro enviado">
        <div className="space-y-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4">
          <h2
            ref={sentTitleRef}
            tabIndex={-1}
            className="text-xl font-semibold text-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
          >
            Confirme seu e-mail para ativar sua conta
          </h2>
          <p className="text-sm text-zinc-200">
            Enviamos um e-mail com o link de confirmacao.
          </p>
          <p className="rounded-lg border border-amber-400/45 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100">
            Se nao encontrar, verifique Spam e Lixo eletronico.
          </p>
          <p className="text-xs text-zinc-300">
            Procure por {APP_NAME} no assunto ou remetente.
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
      </section>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-2 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="signup-name" className="text-sm text-zinc-300">
          Nome completo
        </label>
        <Input
          id="signup-name"
          name="name"
          placeholder="Seu nome completo"
          type="text"
          autoComplete="name"
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (fieldErrors.name) {
              setFieldErrors((previous) => ({ ...previous, name: undefined }));
            }
          }}
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "signup-name-error" : undefined}
        />
        {fieldErrors.name ? (
          <p id="signup-name-error" className="text-xs text-red-300">
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="text-sm text-zinc-300">
          Email
        </label>
        <Input
          id="signup-email"
          name="email"
          placeholder="voce@empresa.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldErrors.email) {
              setFieldErrors((previous) => ({ ...previous, email: undefined }));
            }
          }}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
        />
        {fieldErrors.email ? (
          <p id="signup-email-error" className="text-xs text-red-300">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-password" className="text-sm text-zinc-300">
          Senha
        </label>
        <Input
          id="signup-password"
          name="password"
          placeholder="Crie uma senha"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldErrors.password) {
              setFieldErrors((previous) => ({
                ...previous,
                password: undefined
              }));
            }
          }}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password ? "signup-password-error" : undefined
          }
        />
        {fieldErrors.password ? (
          <p id="signup-password-error" className="text-xs text-red-300">
            {fieldErrors.password}
          </p>
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

      <Button className="w-full" disabled={loading}>
        {loading ? "Criando conta..." : "Criar conta"}
      </Button>

      <button
        type="button"
        className="w-full rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        onClick={onSwitchMode}
        disabled={loading}
      >
        Ja tenho conta
      </button>
    </form>
  );
}

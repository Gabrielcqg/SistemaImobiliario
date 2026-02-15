"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dispatchNavigationStart } from "@/lib/navigation/progress";
import {
  focusFirstInvalidField,
  mapAuthErrorMessage,
  validateEmail,
  validatePassword
} from "@/components/auth/authHelpers";

interface LoginFormProps {
  onSwitchMode: () => void;
}

type LoginField = "email" | "password";
type LoginFieldErrors = Partial<Record<LoginField, string>>;

export default function LoginForm({ onSwitchMode }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom");

  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const slowFeedbackTimerRef = useRef<number | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSlowFeedback, setShowSlowFeedback] = useState(false);

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
      password: validatePassword(password) ?? undefined
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

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        setError(mapAuthErrorMessage(signInError.message));
        return;
      }

      setSuccess("Login realizado. Redirecionando...");
      dispatchNavigationStart();
      router.replace(redirectedFrom ?? "/buscador");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar");
    } finally {
      if (slowFeedbackTimerRef.current !== null) {
        window.clearTimeout(slowFeedbackTimerRef.current);
      }
      setLoading(false);
      setShowSlowFeedback(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-2 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-sm text-zinc-300">
          Email
        </label>
        <Input
          id="login-email"
          name="email"
          placeholder="voce@empresa.com"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          disabled={loading}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldErrors.email) {
              setFieldErrors((previous) => ({ ...previous, email: undefined }));
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

      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-sm text-zinc-300">
          Senha
        </label>
        <Input
          id="login-password"
          name="password"
          placeholder="Sua senha"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={loading}
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
            fieldErrors.password ? "login-password-error" : undefined
          }
        />
        {fieldErrors.password ? (
          <p id="login-password-error" className="text-xs text-red-300">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

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
            Entrando...
          </span>
        ) : (
          "Entrar"
        )}
      </Button>

      <button
        type="button"
        className="w-full rounded-lg px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        onClick={onSwitchMode}
        disabled={loading}
        aria-disabled={loading}
      >
        Quero me cadastrar
      </button>
    </form>
  );
}

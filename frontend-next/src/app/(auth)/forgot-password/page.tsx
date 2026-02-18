"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AuthPageCard from "@/components/auth/AuthPageCard";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapAuthErrorMessage, validateEmail } from "@/components/auth/authHelpers";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/login");
    return callbackUrl.toString();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      setSuccess(null);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo
        }
      );

      if (resetError) {
        setError(mapAuthErrorMessage(resetError.message));
        return;
      }

      setSuccess("Enviamos um link de recuperacao para o seu e-mail.");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nao foi possivel enviar o e-mail de recuperacao."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPageCard
      badge="RECUPERAR ACESSO"
      title="Esqueci meu acesso"
      subtitle="Informe seu e-mail para receber um link de recuperacao."
      backHref="/login"
      backLabel="Voltar para login"
      footer={
        <p className="text-sm text-zinc-400">
          Lembrou sua senha?{" "}
          <Link href="/login" className="text-white underline underline-offset-4">
            Entrar
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="forgot-email" className="text-sm text-zinc-300">
            Email
          </label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com"
            disabled={loading}
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
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            {success}
          </p>
        ) : null}

        <Button className="w-full" disabled={loading} aria-disabled={loading}>
          {loading ? "Enviando..." : "Enviar link de recuperacao"}
        </Button>
      </form>
    </AuthPageCard>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return `${window.location.origin}/login`;
  }, []);

  const friendlyError = (message: string) => {
    if (message.toLowerCase().includes("invalid login")) {
      return "Email ou senha inválidos.";
    }
    if (message.toLowerCase().includes("already registered")) {
      return "Este email já está cadastrado.";
    }
    if (message.toLowerCase().includes("password")) {
      return "Senha fraca. Use pelo menos 6 caracteres.";
    }
    return message;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (signInError) {
          setError(friendlyError(signInError.message));
          return;
        }

        router.replace(redirectedFrom ?? "/buscador");
        router.refresh();
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo
          }
        });

        if (signUpError) {
          setError(friendlyError(signUpError.message));
          return;
        }

        if (data.session) {
          router.replace(redirectedFrom ?? "/buscador");
          router.refresh();
        } else {
          setInfo("Verifique seu email para confirmar o cadastro.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <Input
        placeholder="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <Input
        placeholder="Senha"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {info ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200">
          {info}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={loading}>
        {loading
          ? mode === "login"
            ? "Entrando..."
            : "Cadastrando..."
          : mode === "login"
            ? "Entrar"
            : "Cadastrar"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() =>
          setMode((prev) => (prev === "login" ? "signup" : "login"))
        }
        disabled={loading}
      >
        {mode === "login"
          ? "Ainda não tem conta? Cadastrar"
          : "Já tem conta? Entrar"}
      </Button>
    </form>
  );
}

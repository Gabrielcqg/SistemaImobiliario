"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Card from "@/components/ui/Card";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";

type AuthMode = "login" | "signup";

const contentByMode: Record<AuthMode, { badge: string; title: string; subtitle: string }> = {
  login: {
    badge: "LOGIN",
    title: "Entrar",
    subtitle: "Acesse seu painel para gerenciar clientes e oportunidades."
  },
  signup: {
    badge: "CADASTRO",
    title: "Criar conta",
    subtitle: "Configure seu acesso em segundos e comece a usar a plataforma."
  }
};

export default function AuthCard() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("login");
  const shouldReduceMotion = useReducedMotion();
  const confirmationAlertRef = useRef<HTMLDivElement>(null);
  const isLogin = mode === "login";
  const activeContent = contentByMode[mode];
  const hasConfirmedEmail = searchParams.get("confirmed") === "1";

  useEffect(() => {
    if (!hasConfirmedEmail || !isLogin) {
      return;
    }

    confirmationAlertRef.current?.focus();
  }, [hasConfirmedEmail, isLogin]);

  return (
    <Card
      className={`w-full max-w-md p-8 transition-colors duration-300 ${
        isLogin ? "border-zinc-800 bg-white/5" : "accent-card-highlight"
      }`}
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <div
            className={`h-1 w-16 rounded-full bg-gradient-to-r transition-all duration-300 ${
              isLogin ? "from-white to-zinc-500" : "from-amber-400 via-indigo-400 to-sky-400"
            }`}
          />
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">
            {activeContent.badge}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            {activeContent.title}
          </h1>
          <p className="text-sm text-zinc-400">{activeContent.subtitle}</p>
        </div>

        {isLogin && hasConfirmedEmail ? (
          <div
            ref={confirmationAlertRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="rounded-lg accent-alert accent-focus px-3 py-2 text-sm text-sky-100 focus:outline-none"
          >
            E-mail confirmado! Agora voce ja pode fazer login.
          </div>
        ) : null}

        <div
          role="group"
          aria-label="Modo de autenticacao"
          className="grid grid-cols-2 rounded-xl border border-zinc-800 bg-black/30 p-1"
        >
          <button
            type="button"
            aria-pressed={isLogin}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              isLogin
                ? "bg-white text-black"
                : "text-zinc-300 hover:bg-white/5 hover:text-white"
            }`}
            onClick={() => setMode("login")}
          >
            Entrar
          </button>
          <button
            type="button"
            aria-pressed={!isLogin}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
              !isLogin
                ? "bg-white text-black"
                : "text-zinc-300 hover:bg-white/5 hover:text-white"
            }`}
            onClick={() => setMode("signup")}
          >
            Criar conta
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            aria-live="polite"
            initial={
              shouldReduceMotion
                ? false
                : { opacity: 0, x: isLogin ? -12 : 12, y: 4 }
            }
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {isLogin ? (
              <LoginForm onSwitchMode={() => setMode("signup")} />
            ) : (
              <SignupForm onSwitchMode={() => setMode("login")} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Card>
  );
}

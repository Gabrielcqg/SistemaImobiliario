import Link from "next/link";
import AuthPageCard from "@/components/auth/AuthPageCard";

export default function SignupChoosePage() {
  return (
    <AuthPageCard
      badge="CADASTRO"
      title="Escolha seu tipo de conta"
      subtitle="Configure sua conta do jeito certo para o seu trabalho."
      backHref="/login"
      backLabel="Voltar para login"
      footer={
        <p className="text-sm text-zinc-400">
          Ja recebeu um convite?{" "}
          <Link
            href="/signup/join"
            className="text-white underline underline-offset-4"
          >
            Entrar por convite
          </Link>
        </p>
      }
    >
      <div className="grid gap-3">
        <Link
          href="/signup/individual"
          className="rounded-xl border border-zinc-700 bg-black/30 p-4 transition hover:border-zinc-500 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <p className="text-sm font-semibold text-white">Conta individual</p>
          <p className="mt-1 text-xs text-zinc-400">
            Ideal para 1 corretor com acesso pessoal.
          </p>
        </Link>

        <Link
          href="/signup/brokerage"
          className="rounded-xl accent-card-highlight accent-focus p-4 transition hover:border-white/35 hover:bg-white/[0.07] focus:outline-none"
        >
          <p className="text-sm font-semibold text-sky-100">Imobiliaria</p>
          <p className="accent-text mt-1 text-xs">
            Gestao de equipe com contas separadas para cada corretor.
          </p>
        </Link>
      </div>
    </AuthPageCard>
  );
}

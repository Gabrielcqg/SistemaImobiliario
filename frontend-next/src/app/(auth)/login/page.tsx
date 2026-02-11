import { Suspense } from "react";
import Card from "@/components/ui/Card";
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md p-8">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-400">
            Acesso
          </p>
          <h1 className="text-3xl font-semibold">Bem-vindo de volta</h1>
          <p className="text-sm text-zinc-400">
            Faça login para acessar seu dashboard.
          </p>
        </div>

        <Suspense fallback={<div>Carregando formulário...</div>}>
          <LoginForm />
        </Suspense>

        <div className="mt-6 text-xs text-zinc-500">
          Placeholder. Autenticação via Supabase entra na próxima etapa.
        </div>
      </Card>
    </div>
  );
}

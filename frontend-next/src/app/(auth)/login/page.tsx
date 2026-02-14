import { Suspense } from "react";
import Card from "@/components/ui/Card";
import AuthCard from "@/components/auth/AuthCard";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <Suspense
        fallback={
          <Card className="w-full max-w-md p-8">
            <p className="text-sm text-zinc-400">Carregando formulario...</p>
          </Card>
        }
      >
        <AuthCard />
      </Suspense>
    </div>
  );
}

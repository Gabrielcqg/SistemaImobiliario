"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthPageCard from "@/components/auth/AuthPageCard";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import {
  ensureOnboardingOrganization,
  getBootstrapContext
} from "@/lib/auth/organization";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  focusFirstInvalidField,
  mapAuthErrorMessage,
  validateEmail,
  validateFullName,
  validatePassword
} from "@/components/auth/authHelpers";

type BrokerageView = "form" | "sent";
type BrokerageField = "brokerage" | "ownerName" | "email" | "password";
type BrokerageFieldErrors = Partial<Record<BrokerageField, string>>;

export default function SignupBrokeragePage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [view, setView] = useState<BrokerageView>("form");
  const [brokerageName, setBrokerageName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [seatsInput, setSeatsInput] = useState("5");
  const [fieldErrors, setFieldErrors] = useState<BrokerageFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    let active = true;

    const bootstrap = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!active || !session) {
        return;
      }

      try {
        const nextContext = await getBootstrapContext(supabase);
        if (
          active &&
          nextContext.organizationKind === "brokerage" &&
          nextContext.activeOrganizationId
        ) {
          router.replace("/onboarding/imobiliaria/convidar");
        }
      } catch {
        // Ignore preload errors on signup screen.
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router, supabase]);

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: BrokerageFieldErrors = {
      brokerage:
        brokerageName.trim().length < 2
          ? "Informe o nome da imobiliaria."
          : undefined,
      ownerName: validateFullName(ownerName) ?? undefined,
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined
    };

    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      setError(null);
      focusFirstInvalidField(formRef.current, nextErrors, [
        "brokerage",
        "ownerName",
        "email",
        "password"
      ]);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    setError(null);
    setSuccess(null);

    const seatsRequested = Math.max(1, Number.parseInt(seatsInput, 10) || 5);

    try {
      const trimmedOwnerName = ownerName.trim();
      const trimmedBrokerageName = brokerageName.trim();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            full_name: trimmedOwnerName,
            onboarding_full_name: trimmedOwnerName,
            onboarding_account_type: "brokerage",
            onboarding_organization_name: trimmedBrokerageName,
            onboarding_seats_requested: seatsRequested
          }
        }
      });

      if (signUpError) {
        setError(mapAuthErrorMessage(signUpError.message));
        return;
      }

      if (data.session) {
        await ensureOnboardingOrganization(supabase, {
          accountType: "brokerage",
          organizationName: trimmedBrokerageName,
          fullName: trimmedOwnerName,
          seatsRequested
        });

        setSuccess("Conta criada. Redirecionando para onboarding da equipe...");
        router.replace("/onboarding/imobiliaria/convidar?welcome=1");
        router.refresh();
        return;
      }

      setView("sent");
    } catch (signupError) {
      setError(
        signupError instanceof Error
          ? signupError.message
          : "Nao foi possivel criar a conta da imobiliaria."
      );
    } finally {
      setLoading(false);
    }
  };

  if (view === "sent") {
    return (
      <AuthPageCard
        badge="CADASTRO IMOBILIARIA"
        title="Confirme seu e-mail"
        subtitle="Assim que confirmar, voce entra e pode convidar sua equipe."
        backHref="/login?redirectedFrom=%2Fonboarding%2Fimobiliaria%2Fconvidar"
        backLabel="Voltar para login"
      >
        <div className="space-y-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4">
          <p className="text-sm text-zinc-100">
            Verifique Spam e Lixo eletronico se o e-mail nao aparecer na caixa de entrada.
          </p>
          <p className="text-xs text-zinc-300">
            Cada corretor da sua imobiliaria tera uma conta propria.
          </p>
        </div>
      </AuthPageCard>
    );
  }

  return (
    <AuthPageCard
      badge="CADASTRO IMOBILIARIA"
      title="Criar conta da imobiliaria"
      subtitle="Defina o responsavel e habilite sua equipe com contas separadas."
      backHref="/signup/choose"
      backLabel="Trocar tipo de conta"
      footer={
        <p className="text-sm text-zinc-400">
          Ja recebeu convite?{" "}
          <Link href="/signup/join" className="text-white underline underline-offset-4">
            Entrar por convite
          </Link>
        </p>
      }
    >
      <form ref={formRef} onSubmit={handleSignup} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="brokerage-name" className="text-sm text-zinc-300">
            Nome da imobiliaria
          </label>
          <Input
            id="brokerage-name"
            name="brokerage"
            autoFocus
            disabled={loading}
            value={brokerageName}
            onChange={(event) => {
              setBrokerageName(event.target.value);
              if (fieldErrors.brokerage) {
                setFieldErrors((prev) => ({ ...prev, brokerage: undefined }));
              }
            }}
            placeholder="Imobiliaria Exemplo"
          />
          {fieldErrors.brokerage ? (
            <p className="text-xs text-red-300">{fieldErrors.brokerage}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="brokerage-owner-name" className="text-sm text-zinc-300">
            Nome do responsavel
          </label>
          <Input
            id="brokerage-owner-name"
            name="ownerName"
            autoComplete="name"
            disabled={loading}
            value={ownerName}
            onChange={(event) => {
              setOwnerName(event.target.value);
              if (fieldErrors.ownerName) {
                setFieldErrors((prev) => ({ ...prev, ownerName: undefined }));
              }
            }}
            placeholder="Seu nome completo"
          />
          {fieldErrors.ownerName ? (
            <p className="text-xs text-red-300">{fieldErrors.ownerName}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="brokerage-email" className="text-sm text-zinc-300">
            Email do responsavel
          </label>
          <Input
            id="brokerage-email"
            name="email"
            type="email"
            autoComplete="email"
            disabled={loading}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="responsavel@imobiliaria.com"
          />
          {fieldErrors.email ? (
            <p className="text-xs text-red-300">{fieldErrors.email}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="brokerage-password" className="text-sm text-zinc-300">
            Senha
          </label>
          <Input
            id="brokerage-password"
            name="password"
            type="password"
            autoComplete="new-password"
            disabled={loading}
            value={password}
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

        <div className="space-y-1.5">
          <label htmlFor="brokerage-seats" className="text-sm text-zinc-300">
            Assentos iniciais (opcional)
          </label>
          <Input
            id="brokerage-seats"
            type="number"
            min={1}
            disabled={loading}
            value={seatsInput}
            onChange={(event) => setSeatsInput(event.target.value)}
            placeholder="5"
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
          {loading ? "Criando conta..." : "Criar conta da imobiliaria"}
        </Button>
      </form>
    </AuthPageCard>
  );
}

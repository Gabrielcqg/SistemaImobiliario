"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import {
  listMyOrganizations,
  setActiveOrganization,
  type OrganizationChoiceItem
} from "@/lib/auth/organization";
import { dispatchOrganizationContextRefresh } from "@/lib/auth/organizationEvents";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SelectOrganizationPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [savingOrganizationId, setSavingOrganizationId] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationChoiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyOrganizations(supabase);
      setOrganizations(rows);

      if (rows.length === 1) {
        setSavingOrganizationId(rows[0].organizationId);
        await setActiveOrganization(supabase, rows[0].organizationId);
        dispatchOrganizationContextRefresh();
        router.replace("/buscador");
        router.refresh();
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar suas organizacoes."
      );
    } finally {
      setLoading(false);
      setSavingOrganizationId(null);
    }
  }, [router, supabase]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  const handleSelect = async (organizationId: string) => {
    setSavingOrganizationId(organizationId);
    setError(null);

    try {
      await setActiveOrganization(supabase, organizationId);
      dispatchOrganizationContextRefresh();
      router.replace("/buscador");
      router.refresh();
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Nao foi possivel ativar a organizacao selecionada."
      );
    } finally {
      setSavingOrganizationId(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Organizacao</p>
        <h2 className="text-2xl font-semibold">Escolher organizacao ativa</h2>
        <p className="text-sm text-zinc-400">
          Selecione em qual imobiliaria voce quer trabalhar agora.
        </p>
      </Card>

      {error ? (
        <Card className="border-red-500/40 bg-red-500/10 text-sm text-red-200">
          {error}
        </Card>
      ) : null}

      <Card className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-lg bg-zinc-800/70" />
            <div className="h-10 animate-pulse rounded-lg bg-zinc-800/60" />
            <div className="h-10 animate-pulse rounded-lg bg-zinc-800/50" />
          </div>
        ) : organizations.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Nenhuma organizacao encontrada para esta conta.
          </p>
        ) : (
          organizations.map((organization) => {
            const saving = savingOrganizationId === organization.organizationId;
            return (
              <button
                key={organization.organizationId}
                type="button"
                onClick={() => void handleSelect(organization.organizationId)}
                disabled={Boolean(savingOrganizationId)}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-800 px-4 py-3 text-left transition hover:border-zinc-600 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    {organization.organizationName}
                  </p>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {organization.organizationKind} - {organization.role}
                  </p>
                </div>
                <span className="text-xs text-zinc-400">
                  {saving ? "Ativando..." : "Selecionar"}
                </span>
              </button>
            );
          })
        )}
      </Card>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            router.replace("/buscador");
            router.refresh();
          }}
        >
          Voltar
        </Button>
      </div>
    </div>
  );
}

"use client";

import AssistantChatPanel from "@/components/ai/AssistantChatPanel";
import Card from "@/components/ui/Card";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";

export default function IAPage() {
  const { organizationId, loading, needsOrganizationChoice, error } =
    useOrganizationContext();

  if (!organizationId && !loading && !needsOrganizationChoice) {
    return (
      <Card className="border-red-500/40 bg-red-950/40 text-sm text-red-200">
        {error ?? "Nenhuma organização ativa encontrada para carregar a IA."}
      </Card>
    );
  }

  return (
    <div className="relative min-w-0">
      <div className="mx-auto max-w-6xl space-y-4">
        <Card
          role="status"
          aria-live="polite"
          className="rounded-xl accent-alert px-4 py-3 text-sm text-sky-100"
        >
          <p className="font-semibold uppercase tracking-[0.12em]">
            IA em desenvolvimento e manutenção
          </p>
          <p className="mt-1 text-zinc-100/90">
            Esta área está em evolução contínua. Algumas funcionalidades podem
            ficar indisponíveis ou instáveis no momento.
          </p>
        </Card>
        <AssistantChatPanel />
      </div>
    </div>
  );
}

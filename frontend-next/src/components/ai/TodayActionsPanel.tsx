"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { LeadWithMessages, MessageTone, PipelineStatus } from "@/lib/ai/types";

type TodayActionsPanelProps = {
  dueTodayLeads: LeadWithMessages[];
  overdueLeads: LeadWithMessages[];
  tone: MessageTone;
  onToneChange: (tone: MessageTone) => void;
};

const TONE_OPTIONS: { value: MessageTone; label: string }[] = [
  { value: "curto", label: "Curto" },
  { value: "profissional", label: "Profissional" },
  { value: "amigavel", label: "Amigável" }
];

const statusLabel = (status: PipelineStatus) => {
  if (status === "novo_match") return "Novo Match";
  if (status === "contato_feito") return "Contato feito";
  if (status === "em_conversa") return "Em conversa";
  if (status === "aguardando_retorno") return "Aguardando retorno";
  if (status === "visita_agendada") return "Visita agendada";
  if (status === "proposta") return "Proposta";
  return "Fechado";
};

const renderLeadLine = (
  lead: LeadWithMessages,
  tone: MessageTone,
  copiedLeadId: string | null,
  onCopy: (lead: LeadWithMessages) => Promise<void>
) => {
  return (
    <li key={lead.id} className="rounded-xl border border-zinc-800 bg-black/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{lead.name}</p>
          <p className="text-xs text-zinc-400">{statusLabel(lead.status_pipeline)}</p>
          <p className="mt-1 text-xs text-zinc-500">{lead.last_action_label}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => {
              void onCopy(lead);
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {copiedLeadId === lead.id ? "Copiado" : "Copiar mensagem"}
          </Button>

          <Link
            href={`/crm?clientId=${lead.id}`}
            className="inline-flex h-8 items-center rounded-md border border-zinc-700 px-2 text-xs text-zinc-100 transition hover:border-zinc-500"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Abrir no CRM
          </Link>
        </div>
      </div>

      <p className="mt-2 text-xs text-zinc-400">{lead.suggested_messages[tone]}</p>
    </li>
  );
};

export default function TodayActionsPanel({
  dueTodayLeads,
  overdueLeads,
  tone,
  onToneChange
}: TodayActionsPanelProps) {
  const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null);

  const handleCopy = async (lead: LeadWithMessages) => {
    const text = lead.suggested_messages[tone];

    try {
      await navigator.clipboard.writeText(text);
      setCopiedLeadId(lead.id);
      window.setTimeout(() => {
        setCopiedLeadId((current) => (current === lead.id ? null : current));
      }, 1500);
    } catch {
      setCopiedLeadId(null);
    }
  };

  return (
    <Card className="space-y-4 border-zinc-800/90 bg-zinc-950/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hoje</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Retornos e mensagens do dia</h3>
          <p className="text-xs text-zinc-400">
            {dueTodayLeads.length} retorno(s) para hoje • {overdueLeads.length} atrasado(s)
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Tom:</span>
          <div className="flex rounded-md border border-zinc-700 bg-zinc-900/70 p-0.5">
            {TONE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onToneChange(option.value)}
                className={`rounded px-2 py-1 text-xs transition ${
                  tone === option.value
                    ? "bg-white text-black"
                    : "text-zinc-300 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {dueTodayLeads.length === 0 && overdueLeads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-black/35 p-4 text-sm text-zinc-400">
          Nenhum retorno para hoje. Quando houver follow-ups, a IA lista aqui com mensagens prontas.
        </div>
      ) : null}

      {overdueLeads.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-300">Atrasados</p>
          <ul className="space-y-2">
            {overdueLeads.map((lead) => renderLeadLine(lead, tone, copiedLeadId, handleCopy))}
          </ul>
        </div>
      ) : null}

      {dueTodayLeads.length > 0 ? (
        <div className="space-y-2">
          <p className="accent-text text-xs font-semibold uppercase tracking-[0.16em]">Retornos de hoje</p>
          <ul className="space-y-2">
            {dueTodayLeads.map((lead) => renderLeadLine(lead, tone, copiedLeadId, handleCopy))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

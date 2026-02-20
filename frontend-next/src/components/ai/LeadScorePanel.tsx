import Link from "next/link";
import Card from "@/components/ui/Card";
import type { LeadScoreRow } from "@/lib/ai/types";

type LeadScorePanelProps = {
  leads: LeadScoreRow[];
};

const statusLabel = (status: LeadScoreRow["status_pipeline"]) => {
  if (status === "novo_match") return "Novo Match";
  if (status === "contato_feito") return "Contato feito";
  if (status === "em_conversa") return "Em conversa";
  if (status === "aguardando_retorno") return "Aguardando retorno";
  if (status === "visita_agendada") return "Visita agendada";
  if (status === "proposta") return "Proposta";
  return "Fechado";
};

const scoreTone = (score: number) => {
  if (score >= 75) return "accent-badge";
  if (score >= 45) return "border-amber-400/45 bg-amber-400/15 text-amber-100";
  return "border-zinc-700 bg-zinc-800/60 text-zinc-200";
};

export default function LeadScorePanel({ leads }: LeadScorePanelProps) {
  return (
    <Card className="space-y-4 border-zinc-800/90 bg-zinc-950/70 p-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Score de Leads</p>
        <h3 className="mt-1 text-lg font-semibold text-white">Ranking de prioridade</h3>
        <p className="text-xs text-zinc-400">Top leads do usuário com explicação determinística.</p>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-black/35 p-4 text-sm text-zinc-400">
          Sem leads suficientes para calcular score no momento.
        </div>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => (
            <li key={lead.lead_id} className="rounded-xl border border-zinc-800 bg-black/35 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{lead.client_name}</p>
                  <p className="text-xs text-zinc-400">{statusLabel(lead.status_pipeline)}</p>
                </div>

                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${scoreTone(
                    lead.score_total
                  )}`}
                >
                  {lead.score_total}/100
                </span>
              </div>

              <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                {lead.bullets.slice(0, 5).map((bullet) => (
                  <li key={`${lead.lead_id}-${bullet}`}>• {bullet}</li>
                ))}
              </ul>

              <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                <span>{lead.opportunities_count} oportunidade(s) compatível(is)</span>
                <Link
                  href={`/crm?clientId=${lead.lead_id}`}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-200 transition hover:border-zinc-500"
                >
                  Ver detalhes
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

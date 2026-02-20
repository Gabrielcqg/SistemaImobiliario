import { NextRequest, NextResponse } from "next/server";
import { buildAiContextForUser } from "@/lib/ai/context";
import type {
  AIAssistantAction,
  AIAssistantBlock,
  AIAssistantCaptureItem,
  AIAssistantLeadItem,
  AIAssistantResponse,
  PipelineStatus,
  MessageTone
} from "@/lib/ai/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AssistantRequestBody = {
  message?: string;
  tone?: MessageTone;
};

const toTone = (value: unknown): MessageTone => {
  if (value === "curto" || value === "profissional" || value === "amigavel") {
    return value;
  }
  return "profissional";
};

const normalizeMessage = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const includesAny = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
};

const statusLabel = (status: PipelineStatus) => {
  if (status === "novo_match") return "Novo Match";
  if (status === "contato_feito") return "Contato feito";
  if (status === "em_conversa") return "Em conversa";
  if (status === "aguardando_retorno") return "Aguardando retorno";
  if (status === "visita_agendada") return "Visita agendada";
  if (status === "proposta") return "Proposta";
  return "Fechado";
};

const asLeadCard = (args: {
  lead: Awaited<ReturnType<typeof buildAiContextForUser>>["dueTodayLeads"][number];
  tone: MessageTone;
  highlight?: string;
  includeBullets?: string[];
  includeScore?: number;
  dateLabel?: string;
  dateValue?: string | null;
}): AIAssistantLeadItem => {
  const { lead, tone, highlight, includeBullets, includeScore, dateLabel, dateValue } = args;
  return {
    id: lead.id,
    name: lead.name,
    status_pipeline: lead.status_pipeline,
    highlight: highlight ?? null,
    date_label: dateLabel ?? "Próxima ação",
    date_value: formatDateTime(dateValue ?? lead.next_action_at ?? lead.chase_due_at),
    score_total: includeScore,
    bullets: includeBullets?.slice(0, 4),
    suggested_message: lead.suggested_messages[tone],
    actions: [
      {
        type: "copy_message",
        label: "Copiar",
        payload: { text: lead.suggested_messages[tone] }
      },
      {
        type: "open_lead",
        label: "Abrir no CRM",
        payload: { lead_id: lead.id }
      },
      {
        type: "open_lead",
        label: "Marcar contatado",
        payload: { lead_id: lead.id }
      },
      {
        type: "schedule_followup",
        label: "Agendar retorno",
        payload: {
          lead_id: lead.id,
          due_at: lead.next_action_at ?? lead.chase_due_at ?? null
        }
      }
    ]
  };
};

const asScoreCard = (
  lead: Awaited<ReturnType<typeof buildAiContextForUser>>["leadCandidatesForScoring"][number]
): AIAssistantLeadItem => ({
  id: lead.lead_id,
  name: lead.client_name,
  status_pipeline: lead.status_pipeline,
  highlight: `${lead.score_total}/100`,
  date_label: "Retorno",
  date_value: formatDateTime(lead.next_action_at ?? lead.chase_due_at),
  score_total: lead.score_total,
  bullets: lead.bullets.slice(0, 4),
  actions: [
    {
      type: "open_lead",
      label: "Abrir no CRM",
      payload: { lead_id: lead.lead_id }
    },
    {
      type: "open_lead",
      label: "Marcar contatado",
      payload: { lead_id: lead.lead_id }
    },
    {
      type: "schedule_followup",
      label: "Agendar retorno",
      payload: {
        lead_id: lead.lead_id,
        due_at: lead.next_action_at ?? lead.chase_due_at ?? null
      }
    }
  ]
});

const asCaptureCard = (
  item: Awaited<ReturnType<typeof buildAiContextForUser>>["captureCandidates"][number]
): AIAssistantCaptureItem => ({
  id: item.id,
  title: item.title ?? "Imóvel sem título",
  neighborhood: item.neighborhood,
  price: item.price,
  reason: item.reason,
  category: item.category,
  actions: [
    {
      type: "open_capture",
      label: "Abrir no Buscador",
      payload: { category: item.category }
    }
  ]
});

const buildAssistantResponse = (args: {
  message: string;
  tone: MessageTone;
  context: Awaited<ReturnType<typeof buildAiContextForUser>>;
}): AIAssistantResponse => {
  const { message, tone, context } = args;
  const normalized = message.toLowerCase();

  const dueTodayCount = context.dueTodayLeads.length;
  const overdueCount = context.overdueLeads.length;
  const captureCount = context.captureCandidates.length;
  const topScoreLead = context.leadCandidatesForScoring[0] ?? null;
  const firstDueLead = context.dueTodayLeads[0] ?? null;

  const actions: AIAssistantAction[] = [];
  const blocks: AIAssistantBlock[] = [];

  if (includesAny(normalized, ["retorno", "hoje", "prioridade", "atrasado"])) {
    const answer =
      overdueCount > 0
        ? `Hoje você tem ${dueTodayCount} retorno(s) para o dia e ${overdueCount} atraso(s). Priorize primeiro os atrasados e depois os retornos de hoje.`
        : `Hoje você tem ${dueTodayCount} retorno(s) planejado(s). Recomendo começar pelos que estão em Aguardando retorno.`;

    actions.push({
      type: "open_crm_filter",
      label: "Abrir retornos de hoje",
      payload: { due: "today" }
    });

    if (overdueCount > 0) {
      actions.push({
        type: "open_crm_filter",
        label: "Abrir atrasados",
        payload: { due: "overdue" }
      });
    }

    if (overdueCount > 0) {
      blocks.push({
        type: "lead_list",
        title: "Atrasados",
        items: context.overdueLeads.slice(0, 6).map((lead) =>
          asLeadCard({
            lead,
            tone,
            highlight: "Atrasado",
            dateLabel: "Vencimento",
            dateValue: lead.next_action_at ?? lead.chase_due_at
          })
        )
      });
    }

    if (dueTodayCount > 0) {
      blocks.push({
        type: "lead_list",
        title: "Retornos de hoje",
        items: context.dueTodayLeads.slice(0, 8).map((lead) =>
          asLeadCard({
            lead,
            tone,
            highlight: "Hoje",
            dateLabel: "Retorno",
            dateValue: lead.next_action_at ?? lead.chase_due_at
          })
        )
      });
    }

    if (firstDueLead) {
      actions.push({
        type: "open_lead",
        label: `Abrir ${firstDueLead.name}`,
        payload: { lead_id: firstDueLead.id }
      });
      actions.push({
        type: "copy_message",
        label: "Copiar mensagem sugerida",
        payload: { text: firstDueLead.suggested_messages[tone] }
      });
    }

    return { answer, blocks, actions };
  }

  if (includesAny(normalized, ["mensagem", "whatsapp", "texto", "copiar"])) {
    if (!firstDueLead) {
      return {
        answer:
          "Não encontrei leads com retorno para hoje. Posso preparar mensagens quando houver próximos follow-ups.",
        blocks: [],
        actions: [
          {
            type: "open_crm_filter",
            label: "Abrir CRM",
            payload: { due: "today" }
          }
        ]
      };
    }

    blocks.push({
      type: "message_suggestions",
      title: "Mensagens para hoje",
      items: context.dueTodayLeads.slice(0, 6).map((lead) =>
        asLeadCard({
          lead,
          tone,
          highlight: statusLabel(lead.status_pipeline),
          dateLabel: "Retorno",
          dateValue: lead.next_action_at ?? lead.chase_due_at
        })
      )
    });

    return {
      answer: `Preparei uma mensagem em tom ${tone} para ${firstDueLead.name}.`,
      blocks,
      actions: [
        {
          type: "copy_message",
          label: "Copiar mensagem",
          payload: {
            text: firstDueLead.suggested_messages[tone]
          }
        },
        {
          type: "open_lead",
          label: `Abrir ${firstDueLead.name} no CRM`,
          payload: { lead_id: firstDueLead.id }
        }
      ]
    };
  }

  if (includesAny(normalized, ["score", "quente", "lead", "ranking"])) {
    if (!topScoreLead) {
      return {
        answer: "Ainda não há leads suficientes para montar o ranking de score.",
        blocks: [],
        actions: []
      };
    }

    blocks.push({
      type: "score_list",
      title: "Ranking de prioridades",
      items: context.leadCandidatesForScoring.slice(0, 8).map(asScoreCard)
    });

    return {
      answer: `Lead mais prioritário agora: ${topScoreLead.client_name} (score ${topScoreLead.score_total}/100). Motivo principal: ${topScoreLead.bullets[0]}`,
      blocks,
      actions: [
        {
          type: "open_lead",
          label: `Ver ${topScoreLead.client_name}`,
          payload: { lead_id: topScoreLead.lead_id }
        }
      ]
    };
  }

  if (includesAny(normalized, ["capta", "captacao", "imovel", "oportunidade"])) {
    const category = context.captureCandidates[0]?.category ?? "below_market";

    if (captureCount > 0) {
      blocks.push({
        type: "capture_cards",
        title: includesAny(normalized, ["oportunidade do dia"])
          ? "Oportunidade do dia"
          : "Potenciais captações",
        items: context.captureCandidates
          .slice(0, includesAny(normalized, ["oportunidade do dia"]) ? 1 : 6)
          .map(asCaptureCard)
      });
    }

    return {
      answer:
        captureCount > 0
          ? `Identifiquei ${captureCount} potencial(is) de captação com sinais de oportunidade e recência.`
          : "Não encontrei potenciais de captação suficientes no momento.",
      blocks,
      actions:
        captureCount > 0
          ? [
              {
                type: "open_capture",
                label: "Ver potenciais captações",
                payload: { category }
              }
            ]
          : []
    };
  }

  const summary = `Resumo rápido: ${dueTodayCount} retorno(s) hoje, ${overdueCount} atraso(s), ${context.leadCandidatesForScoring.length} lead(s) no ranking e ${captureCount} potencial(is) de captação.`;

  const defaultActions: AIAssistantAction[] = [
    {
      type: "open_crm_filter",
      label: "Abrir retornos de hoje",
      payload: { due: "today" }
    }
  ];

  if (topScoreLead) {
    defaultActions.push({
      type: "open_lead",
      label: `Abrir lead top score: ${topScoreLead.client_name}`,
      payload: { lead_id: topScoreLead.lead_id }
    });
  }

  if (context.dueTodayLeads.length > 0) {
    blocks.push({
      type: "lead_list",
      title: "Próximas ações",
      items: context.dueTodayLeads.slice(0, 4).map((lead) =>
        asLeadCard({
          lead,
          tone,
          highlight: "Hoje",
          dateLabel: "Retorno",
          dateValue: lead.next_action_at ?? lead.chase_due_at
        })
      )
    });
  }

  if (context.leadCandidatesForScoring.length > 0) {
    blocks.push({
      type: "score_list",
      title: "Leads prioritários",
      items: context.leadCandidatesForScoring.slice(0, 4).map(asScoreCard)
    });
  }

  return {
    answer: summary,
    blocks,
    actions: defaultActions
  };
};

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 401,
          code: userError?.name ?? "unauthenticated",
          message: "Usuário não autenticado."
        }
      },
      { status: 401 }
    );
  }

  let body: AssistantRequestBody = {};
  try {
    body = (await request.json()) as AssistantRequestBody;
  } catch {
    body = {};
  }

  const message = normalizeMessage(body.message);
  const tone = toTone(body.tone);

  if (!message) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 400,
          code: "invalid_message",
          message: "Mensagem vazia."
        }
      },
      { status: 400 }
    );
  }

  try {
    const context = await buildAiContextForUser({ supabase, user });
    const response = buildAssistantResponse({
      message,
      tone,
      context
    });

    if (process.env.NODE_ENV !== "production") {
      console.info("[IA][assistant] response", {
        userId: user.id,
        message,
        actions: response.actions.map((action) => action.type),
        blocks: response.blocks.map((block) => block.type)
      });
    }

    return NextResponse.json({ ok: true, data: response });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Falha ao responder no assistente.";

    console.error("[IA][assistant] error", {
      userId: user.id,
      message: messageText
    });

    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 500,
          code: "assistant_failed",
          message: messageText
        }
      },
      { status: 500 }
    );
  }
}

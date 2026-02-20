import type { BaseLead, LeadScoreRow, PipelineStatus } from "@/lib/ai/types";

export const LEAD_SCORING_WEIGHTS = {
  recencyMax: 15,
  agingMax: 15,
  duePriorityMax: 25,
  hotConversation: 10,
  opportunitiesMax: 15,
  recentReplyMax: 10
} as const;

type ScoreContribution = {
  points: number;
  text: string;
};

type ScoreArgs = {
  lead: BaseLead;
  opportunitiesCount: number;
  now: Date;
  timezone: string;
};

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDayFormatter = (timezone: string) => {
  if (!dayFormatterCache.has(timezone)) {
    dayFormatterCache.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
    );
  }
  return dayFormatterCache.get(timezone) as Intl.DateTimeFormat;
};

const toDateKey = (value: string | null, timezone: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return getDayFormatter(timezone).format(parsed);
};

const diffDaysFromIso = (value: string | null, now: Date) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const diff = now.getTime() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
};

const normalizeStatus = (value: PipelineStatus) => {
  if (value === "fechado") return "fechado";
  if (value === "em_conversa") return "em_conversa";
  if (value === "contato_feito") return "contato_feito";
  if (value === "aguardando_retorno") return "aguardando_retorno";
  return value;
};

const stageLabel = (status: PipelineStatus) => {
  switch (status) {
    case "novo_match":
      return "Novo Match";
    case "contato_feito":
      return "Contato feito";
    case "em_conversa":
      return "Em conversa";
    case "aguardando_retorno":
      return "Aguardando retorno";
    case "visita_agendada":
      return "Visita agendada";
    case "proposta":
      return "Proposta";
    case "fechado":
      return "Fechado";
    default:
      return "Pipeline";
  }
};

const ensureBulletCount = (bullets: string[], status: PipelineStatus) => {
  const next = [...bullets];
  if (next.length < 3) {
    next.push(`Etapa atual: ${stageLabel(status)}.`);
  }
  if (next.length < 3) {
    next.push("Priorização baseada em recência, follow-up e contexto do funil.");
  }
  return next.slice(0, 5);
};

export function scoreLead({ lead, opportunitiesCount, now, timezone }: ScoreArgs) {
  const contributions: ScoreContribution[] = [];

  if (lead.closed_outcome === "lost") {
    return {
      scoreTotal: 0,
      bullets: [
        "Lead marcado como perdido.",
        "Pontuação zerada para evitar priorização indevida.",
        "Se houver retomada, reative o lead no CRM para novo score."
      ]
    };
  }

  const status = normalizeStatus(lead.status_pipeline);
  const todayKey = getDayFormatter(timezone).format(now);
  const nextActionKey = toDateKey(lead.next_action_at, timezone);
  const chaseDueKey = toDateKey(lead.chase_due_at, timezone);

  const createdAnchor = lead.added_at ?? lead.created_at;
  const recencyDays = diffDaysFromIso(createdAnchor, now);
  if (recencyDays !== null) {
    if (recencyDays <= 1) {
      contributions.push({ points: 15, text: "Lead recente (criado há até 1 dia)." });
    } else if (recencyDays <= 3) {
      contributions.push({ points: 12, text: "Lead recente (criado há até 3 dias)." });
    } else if (recencyDays <= 7) {
      contributions.push({ points: 8, text: "Lead criado na última semana." });
    } else if (recencyDays <= 14) {
      contributions.push({ points: 4, text: "Lead criado há menos de 15 dias." });
    }
  }

  const contactAnchor = lead.last_contact_at ?? lead.last_status_change_at ?? createdAnchor;
  const agingDays = diffDaysFromIso(contactAnchor, now);
  if (agingDays !== null) {
    if (agingDays >= 7) {
      contributions.push({ points: 15, text: `Sem contato há ${agingDays} dias.` });
    } else if (agingDays >= 4) {
      contributions.push({ points: 10, text: `Sem contato há ${agingDays} dias.` });
    } else if (agingDays >= 2) {
      contributions.push({ points: 6, text: `Sem contato há ${agingDays} dias.` });
    }
  }

  const inFollowupStages = status === "contato_feito" || status === "aguardando_retorno";
  const isDueToday = nextActionKey === todayKey;
  const isOverdue =
    typeof nextActionKey === "string" && nextActionKey < todayKey;
  const isChaseDueToday =
    inFollowupStages && !lead.next_action_at && chaseDueKey === todayKey;
  const isChaseOverdue =
    inFollowupStages && !lead.next_action_at && typeof chaseDueKey === "string" && chaseDueKey < todayKey;

  if (isOverdue || isChaseOverdue) {
    contributions.push({ points: 25, text: "Retorno atrasado: ação pendente acima do prazo." });
  } else if (isDueToday || isChaseDueToday) {
    contributions.push({ points: 20, text: "Retorno planejado para hoje." });
  }

  if (status === "em_conversa") {
    contributions.push({ points: 10, text: "Lead em conversa ativa (etapa quente)." });
  }

  if (opportunitiesCount > 0) {
    const points = Math.min(LEAD_SCORING_WEIGHTS.opportunitiesMax, opportunitiesCount * 5);
    contributions.push({
      points,
      text: `Existem ${opportunitiesCount} oportunidade(s) compatível(is) para este lead.`
    });
  }

  const replyDays = diffDaysFromIso(lead.last_reply_at, now);
  if (replyDays !== null) {
    if (replyDays <= 1) {
      contributions.push({ points: 10, text: "Cliente respondeu nas últimas 24h." });
    } else if (replyDays <= 3) {
      contributions.push({ points: 6, text: "Cliente respondeu recentemente." });
    }
  }

  if (status === "fechado" && lead.closed_outcome === "won") {
    contributions.push({ points: -30, text: "Lead já fechado (ganho), menor prioridade operacional." });
  }

  const scoreTotal = Math.max(
    0,
    Math.min(
      100,
      contributions.reduce((acc, item) => acc + item.points, 0)
    )
  );

  const rankedBullets = contributions
    .slice()
    .sort((a, b) => b.points - a.points)
    .map((item) => item.text);

  return {
    scoreTotal,
    bullets: ensureBulletCount(rankedBullets, lead.status_pipeline)
  };
}

export function rankLeadsByScore(args: {
  leads: BaseLead[];
  opportunitiesByLeadId: Record<string, number>;
  now: Date;
  timezone: string;
  limit?: number;
}): LeadScoreRow[] {
  const { leads, opportunitiesByLeadId, now, timezone, limit = 10 } = args;

  const scored = leads.map((lead) => {
    const opportunitiesCount = opportunitiesByLeadId[lead.id] ?? 0;
    const scoredLead = scoreLead({ lead, opportunitiesCount, now, timezone });

    return {
      lead_id: lead.id,
      client_name: lead.name,
      score_total: scoredLead.scoreTotal,
      bullets: scoredLead.bullets,
      opportunities_count: opportunitiesCount,
      status_pipeline: lead.status_pipeline,
      next_action_at: lead.next_action_at,
      chase_due_at: lead.chase_due_at,
      last_contact_at: lead.last_contact_at,
      last_reply_at: lead.last_reply_at
    };
  });

  scored.sort((a, b) => {
    if (a.score_total !== b.score_total) return b.score_total - a.score_total;
    const aDue = a.next_action_at ?? a.chase_due_at ?? "";
    const bDue = b.next_action_at ?? b.chase_due_at ?? "";
    return aDue.localeCompare(bDue);
  });

  return scored.slice(0, limit);
}

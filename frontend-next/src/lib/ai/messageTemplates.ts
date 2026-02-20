import type {
  BaseLead,
  LeadFilter,
  MessageTone,
  PipelineStatus,
  StatusMessageTemplates
} from "@/lib/ai/types";

export const MESSAGE_TEMPLATES: StatusMessageTemplates = {
  novo_match: {
    curto:
      "Oi, {first_name}! Vi seu interesse em {region_focus}. Posso te enviar 2 opções dentro de {price_focus}?",
    profissional:
      "Olá, {first_name}. Tudo bem? Separei algumas oportunidades em {region_focus}, dentro da faixa {price_focus}. Posso compartilhar agora?",
    amigavel:
      "Oi, {first_name}! Tudo certo? Separei imóveis bem legais em {region_focus}, na faixa {price_focus}. Quer que eu te mande?"
  },
  contato_feito: {
    curto:
      "Oi, {first_name}! Passando para confirmar se conseguiu ver minha última mensagem. Quer que eu avance com novas opções em {region_focus}?",
    profissional:
      "Olá, {first_name}. Retomando nosso contato: posso seguir com novas opções em {region_focus}, mantendo foco em {price_focus}?",
    amigavel:
      "Oi, {first_name}! Voltei aqui para te ajudar no próximo passo. Quer que eu separe mais opções em {region_focus}?"
  },
  em_conversa: {
    curto:
      "Perfeito, {first_name}. Com base no que você comentou, vou priorizar opções em {region_focus} na faixa {price_focus}.",
    profissional:
      "Ótimo, {first_name}. Com base no seu retorno, vou direcionar as próximas sugestões para {region_focus} dentro de {price_focus}.",
    amigavel:
      "Boa, {first_name}! Entendi seu perfil. Vou focar nas melhores opções em {region_focus}, por volta de {price_focus}."
  },
  aguardando_retorno: {
    curto:
      "Oi, {first_name}! Conseguiu avaliar os imóveis que te enviei? Posso ajustar a seleção e te mandar novas opções hoje.",
    profissional:
      "Olá, {first_name}. Gostaria de acompanhar seu retorno sobre os imóveis enviados. Se desejar, atualizo a seleção com foco em {region_focus}.",
    amigavel:
      "Oi, {first_name}! Passando para saber o que achou dos imóveis. Se quiser, já te mando uma nova seleção em {region_focus}."
  }
};

const toFirstName = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return "cliente";
  return normalized.split(/\s+/)[0] ?? "cliente";
};

const toPriceFocus = (filter: LeadFilter | null) => {
  if (!filter) return "faixa combinada";
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  });

  const hasMin = typeof filter.min_price === "number";
  const hasMax = typeof filter.max_price === "number";

  if (hasMin && hasMax) {
    return `${formatter.format(filter.min_price as number)} a ${formatter.format(filter.max_price as number)}`;
  }

  if (hasMin) {
    return `acima de ${formatter.format(filter.min_price as number)}`;
  }

  if (hasMax) {
    return `até ${formatter.format(filter.max_price as number)}`;
  }

  return "faixa combinada";
};

const toRegionFocus = (filter: LeadFilter | null) => {
  if (!filter || filter.neighborhoods.length === 0) return "sua região de interesse";
  return filter.neighborhoods.slice(0, 2).join(" e ");
};

const normalizeStatusForTemplates = (
  status: PipelineStatus
): keyof StatusMessageTemplates => {
  if (
    status === "visita_agendada" ||
    status === "proposta" ||
    status === "fechado"
  ) {
    return "em_conversa";
  }

  return status;
};

export function buildMessageForLead(args: {
  lead: BaseLead;
  tone: MessageTone;
  filter: LeadFilter | null;
}) {
  const { lead, tone, filter } = args;
  const statusKey = normalizeStatusForTemplates(lead.status_pipeline);
  const template = MESSAGE_TEMPLATES[statusKey][tone];

  const firstName = toFirstName(lead.name);
  const regionFocus = toRegionFocus(filter);
  const priceFocus = toPriceFocus(filter);

  return template
    .replaceAll("{first_name}", firstName)
    .replaceAll("{region_focus}", regionFocus)
    .replaceAll("{price_focus}", priceFocus);
}

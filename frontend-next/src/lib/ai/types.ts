export type PipelineStatus =
  | "novo_match"
  | "contato_feito"
  | "em_conversa"
  | "aguardando_retorno"
  | "visita_agendada"
  | "proposta"
  | "fechado";

export type MessageTone = "curto" | "profissional" | "amigavel";

export type DueType = "next_action_today" | "chase_due_today";

export type AIAssistantAction =
  | {
      type: "open_crm_filter";
      label: string;
      payload: {
        due?: "today" | "overdue";
        status?: PipelineStatus;
      };
    }
  | {
      type: "open_lead";
      label: string;
      payload: {
        lead_id: string;
      };
    }
  | {
      type: "copy_message";
      label: string;
      payload: {
        text: string;
      };
    }
  | {
      type: "open_capture";
      label: string;
      payload: {
        category: "below_market" | "price_drop" | "recent";
      };
    }
  | {
      type: "schedule_followup";
      label: string;
      payload: {
        lead_id: string;
        due_at?: string | null;
      };
    };

export type LeadContactInfo = {
  email?: string;
  phone?: string;
};

export type BaseLead = {
  id: string;
  name: string;
  status_pipeline: PipelineStatus;
  closed_outcome: "won" | "lost" | null;
  lost_reason: string | null;
  contact_info: LeadContactInfo | null;
  added_at: string | null;
  created_at: string | null;
  next_action_at: string | null;
  chase_due_at: string | null;
  next_followup_at: string | null;
  last_contact_at: string | null;
  last_reply_at: string | null;
  last_status_change_at: string | null;
  descricao_contexto: string | null;
};

export type LeadFilter = {
  client_id: string;
  active: boolean;
  min_price: number | null;
  max_price: number | null;
  neighborhoods: string[];
  min_bedrooms: number | null;
  min_bathrooms: number | null;
  min_parking: number | null;
  min_area_m2: number | null;
  max_area_m2: number | null;
  property_types: string[];
};

export type LeadWithMessages = BaseLead & {
  due_type: DueType;
  last_action_label: string;
  suggested_messages: Record<MessageTone, string>;
};

export type LeadScoreRow = {
  lead_id: string;
  client_name: string;
  score_total: number;
  bullets: string[];
  opportunities_count: number;
  status_pipeline: PipelineStatus;
  next_action_at: string | null;
  chase_due_at: string | null;
  last_contact_at: string | null;
  last_reply_at: string | null;
};

export type CaptureCandidate = {
  id: string;
  title: string | null;
  price: number | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  area_m2: number | null;
  property_type: "apartment" | "house" | "other" | "land" | null;
  portal: string | null;
  first_seen_at: string | null;
  published_at: string | null;
  main_image_url: string | null;
  url: string | null;
  category: "below_market" | "price_drop" | "recent";
  reason: string;
};

export type StatusMessageTemplates = Record<
  Exclude<PipelineStatus, "visita_agendada" | "proposta" | "fechado">,
  Record<MessageTone, string>
>;

export type AIContextPayload = {
  dueTodayLeads: LeadWithMessages[];
  overdueLeads: LeadWithMessages[];
  waitingReturnLeads: BaseLead[];
  leadCandidatesForScoring: LeadScoreRow[];
  captureCandidates: CaptureCandidate[];
  templates: StatusMessageTemplates;
  metadata: {
    generatedAt: string;
    organizationId: string | null;
    userId: string;
  };
};

export type AIAssistantResponse = {
  answer: string;
  blocks: AIAssistantBlock[];
  actions: AIAssistantAction[];
};

export type AIAssistantLeadItem = {
  id: string;
  name: string;
  status_pipeline: PipelineStatus;
  highlight?: string | null;
  date_label?: string | null;
  date_value?: string | null;
  score_total?: number;
  bullets?: string[];
  suggested_message?: string;
  actions: AIAssistantAction[];
};

export type AIAssistantCaptureItem = {
  id: string;
  title: string;
  neighborhood?: string | null;
  price?: number | null;
  reason: string;
  category: "below_market" | "price_drop" | "recent";
  actions: AIAssistantAction[];
};

export type AIAssistantBlock =
  | {
      type: "lead_list";
      title: string;
      items: AIAssistantLeadItem[];
    }
  | {
      type: "score_list";
      title: string;
      items: AIAssistantLeadItem[];
    }
  | {
      type: "message_suggestions";
      title: string;
      items: AIAssistantLeadItem[];
    }
  | {
      type: "capture_cards";
      title: string;
      items: AIAssistantCaptureItem[];
    };

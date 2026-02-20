"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Ellipsis,
  Globe,
  Lightbulb,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Sparkles
} from "lucide-react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import type {
  AIAssistantAction,
  AIAssistantBlock,
  AIAssistantCaptureItem,
  AIAssistantLeadItem,
  AIAssistantResponse,
  MessageTone
} from "@/lib/ai/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: AIAssistantBlock[];
  actions?: AIAssistantAction[];
  quickPrompts?: string[];
};

type AssistantApiResponse =
  | {
      ok: true;
      data: AIAssistantResponse;
    }
  | {
      ok: false;
      error?: {
        message?: string;
      };
    };

const TONE_OPTIONS: Array<{ value: MessageTone; label: string }> = [
  { value: "curto", label: "Curto" },
  { value: "profissional", label: "Profissional" },
  { value: "amigavel", label: "Amigável" }
];

const QUICK_PROMPTS = [
  "Me mostre meus retornos de hoje",
  "Gere mensagens para eu responder hoje",
  "Rank de prioridades dos meus leads",
  "Oportunidade do dia",
  "Potenciais captações"
];

const createWelcomeMessage = (): ChatMessage => ({
  id: `welcome-${Date.now()}`,
  role: "assistant",
  text: "Estou pronta para organizar seu dia. Escolha um comando rápido ou escreva o que precisa agora.",
  quickPrompts: QUICK_PROMPTS
});

const statusLabel = (value: AIAssistantLeadItem["status_pipeline"]) => {
  if (value === "novo_match") return "Novo Match";
  if (value === "contato_feito") return "Contato feito";
  if (value === "em_conversa") return "Em conversa";
  if (value === "aguardando_retorno") return "Aguardando retorno";
  if (value === "visita_agendada") return "Visita agendada";
  if (value === "proposta") return "Proposta";
  return "Fechado";
};

const formatPrice = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Preço sob consulta";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
};

const CONTROL_BUTTON_BASE =
  "inline-flex items-center justify-center rounded-2xl ia-control-surface accent-focus accent-sheen text-zinc-200";

export default function AssistantChatPanel() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [tone, setTone] = useState<MessageTone>("profissional");
  const [deepResearch, setDeepResearch] = useState(true);
  const [thinkMode, setThinkMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      const target = event.target as Node | null;
      if (target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  const canSend = inputValue.trim().length > 0 && !sending;

  const startNewConversation = () => {
    setMessages([createWelcomeMessage()]);
    setInputValue("");
    setCopiedToken(null);
    setMenuOpen(false);
  };

  const handleAction = async (action: AIAssistantAction) => {
    if (action.type === "copy_message") {
      try {
        await navigator.clipboard.writeText(action.payload.text);
        const token = `${action.type}:${action.payload.text.slice(0, 22)}`;
        setCopiedToken(token);
        window.setTimeout(() => {
          setCopiedToken((current) => (current === token ? null : current));
        }, 1500);
      } catch {
        // Ignore clipboard failures.
      }
      return;
    }

    if (action.type === "open_lead") {
      router.push(`/crm?clientId=${action.payload.lead_id}`);
      return;
    }

    if (action.type === "open_crm_filter") {
      const query = action.payload.due ? `?due=${action.payload.due}` : "";
      router.push(`/crm${query}`);
      return;
    }

    if (action.type === "open_capture") {
      router.push(`/buscador?source=ia&capture=${action.payload.category}`);
      return;
    }

    if (action.type === "schedule_followup") {
      const query = action.payload.due_at
        ? `?clientId=${action.payload.lead_id}&dueAt=${encodeURIComponent(action.payload.due_at)}`
        : `?clientId=${action.payload.lead_id}`;
      router.push(`/crm${query}`);
    }
  };

  const sendMessage = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: message
      }
    ]);
    setSending(true);
    setInputValue("");

    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          tone,
          mode: {
            deepResearch,
            thinkMode
          }
        })
      });

      const payload = (await response.json()) as AssistantApiResponse;

      if (!response.ok || !payload.ok) {
        const apiMessage =
          ("error" in payload ? payload.error?.message : undefined) ??
          "Falha ao consultar assistente.";
        throw new Error(apiMessage);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: payload.data.answer,
          blocks: payload.data.blocks,
          actions: payload.data.actions
        }
      ]);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Falha ao consultar assistente.";
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: `Erro: ${messageText}`
        }
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(inputValue);
  };

  const actionKey = (action: AIAssistantAction, index: number) => {
    if (action.type === "copy_message") {
      return `${action.type}:${index}:${action.payload.text.slice(0, 22)}`;
    }
    if (action.type === "open_lead") {
      return `${action.type}:${index}:${action.payload.lead_id}`;
    }
    if (action.type === "schedule_followup") {
      return `${action.type}:${index}:${action.payload.lead_id}`;
    }
    if (action.type === "open_capture") {
      return `${action.type}:${index}:${action.payload.category}`;
    }
    return `${action.type}:${index}:${action.payload.due ?? "all"}`;
  };

  const renderActionButton = (
    action: AIAssistantAction,
    index: number,
    compact = false
  ) => {
    const key = actionKey(action, index);
    const isCopied =
      action.type === "copy_message" &&
      copiedToken === `${action.type}:${action.payload.text.slice(0, 22)}`;

    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          void handleAction(action);
        }}
        className={`rounded-md border border-indigo-300/20 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-indigo-300/45 ${
          compact ? "bg-zinc-900/70" : "bg-zinc-900/40"
        }`}
      >
        {isCopied ? "Copiado" : action.label}
      </button>
    );
  };

  const renderLeadItem = (item: AIAssistantLeadItem) => (
    <article
      key={item.id}
      className="space-y-2 rounded-xl border border-indigo-300/20 bg-zinc-950/75 p-3 shadow-[0_0_0_1px_rgba(99,102,241,0.1)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{item.name}</p>
          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            {statusLabel(item.status_pipeline)}
          </p>
        </div>
        {typeof item.score_total === "number" ? (
          <span className="rounded-full border border-cyan-400/45 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-200">
            {item.score_total}/100
          </span>
        ) : null}
      </div>

      {item.highlight ? <p className="text-xs font-medium text-indigo-200">{item.highlight}</p> : null}

      {item.date_label || item.date_value ? (
        <p className="text-xs text-zinc-400">
          {item.date_label ?? "Data"}: {item.date_value ?? "—"}
        </p>
      ) : null}

      {Array.isArray(item.bullets) && item.bullets.length > 0 ? (
        <ul className="space-y-1 text-xs text-zinc-300">
          {item.bullets.slice(0, 4).map((bullet) => (
            <li key={`${item.id}-${bullet}`}>• {bullet}</li>
          ))}
        </ul>
      ) : null}

      {item.suggested_message ? (
        <p className="rounded-lg border border-indigo-300/15 bg-indigo-500/5 px-2.5 py-2 text-xs leading-relaxed text-zinc-200">
          {item.suggested_message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {item.actions.map((action, index) => renderActionButton(action, index, true))}
      </div>
    </article>
  );

  const renderCaptureItem = (item: AIAssistantCaptureItem) => (
    <article
      key={item.id}
      className="space-y-2 rounded-xl border border-indigo-300/20 bg-zinc-950/75 p-3 shadow-[0_0_0_1px_rgba(59,130,246,0.09)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-white">{item.title}</p>
        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300">
          {item.category === "below_market"
            ? "Barato na região"
            : item.category === "price_drop"
              ? "Queda de preço"
              : "Recente"}
        </span>
      </div>
      <p className="text-xs text-zinc-400">
        {item.neighborhood ?? "Região não informada"} • {formatPrice(item.price)}
      </p>
      <p className="text-xs text-zinc-300">{item.reason}</p>
      <div className="flex flex-wrap gap-2">
        {item.actions.map((action, index) => renderActionButton(action, index, true))}
      </div>
    </article>
  );

  const renderBlock = (block: AIAssistantBlock, index: number) => (
    <section
      key={`${block.type}-${index}-${block.title}`}
      className="mt-3 space-y-2 rounded-xl border border-indigo-300/15 bg-black/20 p-3"
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{block.title}</p>

      <div className="space-y-2">
        {block.type === "capture_cards"
          ? block.items.map(renderCaptureItem)
          : block.items.map(renderLeadItem)}
      </div>
    </section>
  );

  return (
    <Card className="relative overflow-hidden border-indigo-300/20 bg-zinc-950/80 p-0 shadow-[0_0_0_1px_rgba(99,102,241,0.2),0_22px_70px_-36px_rgba(99,102,241,0.8)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_45%_at_15%_0%,rgba(99,102,241,0.22),transparent_65%),radial-gradient(60%_40%_at_88%_5%,rgba(56,189,248,0.16),transparent_70%)]" />

      <div className="relative flex h-[64vh] min-h-[500px] flex-col md:h-[62vh] md:min-h-[520px]">
        <header className="border-b border-indigo-300/15 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-300" />
            <h2 className="text-lg font-semibold text-white">Assistente IA</h2>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 px-4 pb-2 pt-3">
          <div
            ref={scrollRef}
            className="h-full space-y-4 overflow-y-auto rounded-2xl border border-indigo-300/15 bg-black/35 p-3"
          >
            {messages.map((message) => (
              <div key={message.id} className="space-y-2">
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "assistant"
                      ? "border border-indigo-300/25 bg-gradient-to-br from-indigo-500/10 to-sky-500/10 text-zinc-100 shadow-[0_0_0_1px_rgba(99,102,241,0.14)]"
                      : "ml-auto border border-zinc-200/80 bg-white text-black"
                  }`}
                >
                  {message.text}
                </div>

                {message.role === "assistant" && message.quickPrompts?.length ? (
                  <div className="ml-1 flex flex-wrap gap-2">
                    {message.quickPrompts.map((prompt) => (
                      <button
                        key={`${message.id}-prompt-${prompt}`}
                        type="button"
                        className="accent-outline accent-sheen accent-focus rounded-full px-3 py-1 text-xs text-zinc-200 transition hover:text-white focus-visible:outline-none"
                        onClick={() => {
                          void sendMessage(prompt);
                        }}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.role === "assistant" && message.blocks?.length
                  ? message.blocks.map((block, index) => renderBlock(block, index))
                  : null}

                {message.role === "assistant" && message.actions && message.actions.length > 0 ? (
                  <div className="ml-1 mt-1 flex flex-wrap gap-2">
                    {message.actions.map((action, index) => renderActionButton(action, index))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <footer className="px-5 pb-5 pt-3">
          <div className="group/composer relative">
            <div className="pointer-events-none absolute -inset-[3px] rounded-[32px] bg-[conic-gradient(from_210deg_at_30%_60%,rgba(245,158,11,0.4),rgba(15,23,42,0.05),rgba(56,189,248,0.42),rgba(245,158,11,0.34))] opacity-60 blur-[16px] transition-opacity duration-200 group-focus-within/composer:opacity-95" />

<div className="ia-composer-surface relative px-3 py-2">
  <form className="space-y-2" onSubmit={handleSubmit}>
    <input
      value={inputValue}
      onChange={(event) => setInputValue(event.target.value)}
      placeholder="Ask anything"
      disabled={sending}
      className="w-full bg-transparent px-1 text-base font-normal tracking-[-0.01em] text-zinc-100 placeholder:text-zinc-300/45 focus:outline-none disabled:opacity-50 md:text-lg"
    />

    <div className="flex items-center gap-1.5">
      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className={`${CONTROL_BUTTON_BASE} h-9 w-9`}
            aria-label="Menu do chat"
          >
            <Ellipsis className="h-4 w-4" />
          </button>

          {menuOpen ? (
            <div className="absolute bottom-11 right-0 z-20 w-44 rounded-xl border border-white/10 bg-zinc-900/95 p-2 shadow-[0_18px_34px_-18px_rgba(0,0,0,0.95)] backdrop-blur">
              <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Tom
              </p>

                <div className="space-y-1">
                  {TONE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setTone(option.value);
                        setMenuOpen(false);
                      }}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition accent-focus focus-visible:outline-none ${
                        tone === option.value
                          ? "accent-fill text-zinc-50"
                          : "accent-outline text-zinc-200 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="my-2 h-px bg-zinc-700/70" />

                <button
                  type="button"
                  onClick={startNewConversation}
                  className="inline-flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-200 transition accent-outline accent-focus focus-visible:outline-none hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Nova conversa
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!canSend}
            className={`${CONTROL_BUTTON_BASE} h-9 w-9 ia-control-surface-strong text-zinc-100 disabled:cursor-not-allowed disabled:opacity-45`}
            aria-label="Enviar mensagem"
          >
            {sending ? <MessageSquare className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </form>
  </div>

          </div>
        </footer>
      </div>
    </Card>
  );
}

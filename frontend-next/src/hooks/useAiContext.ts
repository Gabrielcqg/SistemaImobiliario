"use client";

import { useCallback, useEffect, useState } from "react";
import type { AIContextPayload } from "@/lib/ai/types";

type UseAiContextResult = {
  data: AIContextPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

type ContextResponse =
  | {
      ok: true;
      data: AIContextPayload;
    }
  | {
      ok: false;
      error?: {
        message?: string;
      };
    };

export function useAiContext(enabled: boolean): UseAiContextResult {
  const [data, setData] = useState<AIContextPayload | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/context", {
        method: "GET",
        cache: "no-store"
      });

      const payload = (await response.json()) as ContextResponse;

      if (!response.ok || !payload.ok) {
        const message =
          ("error" in payload ? payload.error?.message : undefined) ??
          "Falha ao carregar contexto da IA.";
        throw new Error(message);
      }

      setData(payload.data);
    } catch (contextError) {
      setData(null);
      setError(
        contextError instanceof Error
          ? contextError.message
          : "Falha ao carregar contexto da IA."
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
    error,
    refresh
  };
}

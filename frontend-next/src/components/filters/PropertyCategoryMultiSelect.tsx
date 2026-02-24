"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeText } from "@/lib/format/text";
import {
  UNIFIED_PROPERTY_OPTIONS,
  getUnifiedPropertyCategoryLabel,
  normalizeUnifiedPropertyCategories,
  type UnifiedPropertyCategory
} from "@/lib/listings/unifiedPropertyFilter";

type PropertyCategoryMultiSelectProps = {
  value?: UnifiedPropertyCategory[] | null;
  onChange: (next: UnifiedPropertyCategory[]) => void;
  placeholder?: string;
  disabled?: boolean;
  maxVisibleChips?: number;
  className?: string;
};

export default function PropertyCategoryMultiSelect({
  value,
  onChange,
  placeholder = "Selecione categorias",
  disabled = false,
  maxVisibleChips = 2,
  className = ""
}: PropertyCategoryMultiSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedValues = useMemo(
    () => normalizeUnifiedPropertyCategories(value ?? []),
    [value]
  );

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const query = normalizeText(search);
    if (!query) return UNIFIED_PROPERTY_OPTIONS;

    return UNIFIED_PROPERTY_OPTIONS.filter((option) =>
      normalizeText(option.label).includes(query)
    );
  }, [search]);

  const selectedLabels = useMemo(
    () => selectedValues.map((item) => getUnifiedPropertyCategoryLabel(item)),
    [selectedValues]
  );

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const toggleValue = (nextValue: UnifiedPropertyCategory) => {
    const next = selectedSet.has(nextValue)
      ? selectedValues.filter((item) => item !== nextValue)
      : [...selectedValues, nextValue];

    onChange(normalizeUnifiedPropertyCategories(next));
  };

  const renderClosedValue = () => {
    if (selectedLabels.length === 0) {
      return <span className="text-sm text-zinc-500">{placeholder}</span>;
    }

    if (selectedLabels.length > maxVisibleChips) {
      return (
        <span className="text-sm text-zinc-100">
          {selectedLabels.length} selecionados
        </span>
      );
    }

    return (
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {selectedLabels.map((label) => (
          <span
            key={label}
            className="inline-flex max-w-full items-center rounded-full border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-1 text-[11px] font-medium text-zinc-200"
          >
            <span className="truncate">{label}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full rounded-xl border px-3 py-2.5 text-left transition accent-focus focus-visible:outline-none ${disabled
          ? "cursor-not-allowed border-zinc-800 bg-black/20 text-zinc-500 opacity-70"
          : open
            ? "border-zinc-600 bg-black/35"
            : "border-zinc-800 bg-black/25 hover:border-zinc-700 hover:bg-black/30"
          }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">{renderClosedValue()}</div>
          <span className="shrink-0 text-xs text-zinc-400" aria-hidden="true">
            {open ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Selecionar tipos de imóvel"
          className="absolute left-0 right-0 z-40 mt-2 rounded-2xl border border-zinc-800/90 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur"
        >
          <div className="space-y-2">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar categoria"
              className="w-full rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none accent-focus accent-control"
            />

            <div className="max-h-60 overflow-y-auto pr-1">
              {filteredOptions.length === 0 ? (
                <div className="rounded-lg border border-zinc-800/80 bg-black/20 px-3 py-2 text-sm text-zinc-500">
                  Nenhuma categoria encontrada.
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredOptions.map((option) => {
                    const selected = selectedSet.has(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleValue(option.value)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition accent-focus focus-visible:outline-none ${selected
                          ? "bg-white/10 text-zinc-100"
                          : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                          }`}
                      >
                        <span
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${selected
                            ? "border-zinc-300 bg-zinc-100 text-zinc-950"
                            : "border-zinc-600 bg-transparent text-transparent"
                            }`}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
              <div className="text-xs text-zinc-500">
                {selectedValues.length === 0
                  ? "Nenhuma categoria selecionada"
                  : `${selectedValues.length} selecionado${selectedValues.length > 1 ? "s" : ""}`}
              </div>
              <div className="flex items-center gap-2">
                {selectedValues.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/5 hover:text-zinc-100 accent-focus focus-visible:outline-none"
                  >
                    Limpar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-700/80 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-white/5 accent-focus focus-visible:outline-none"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

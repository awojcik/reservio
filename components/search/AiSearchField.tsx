"use client";

import { ArrowRight, Sparkle, X } from "lucide-react";
import { useState } from "react";

import { interpretQuery } from "@/lib/nlq";
import type { SearchQuery } from "@/lib/types";

type AiSearchFieldProps = {
  onPatch: (patch: Partial<SearchQuery>) => void;
};

/**
 * Product-direction placeholder: no model yet, just a keyword interpreter
 * (see lib/nlq.ts). The UI already shows what was understood, so wiring an
 * LLM later changes the parser, not this component.
 */
export function AiSearchField({ onPatch }: AiSearchFieldProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [matched, setMatched] = useState<string[] | null>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;

    const { patch, matched: understood } = interpretQuery(trimmed);
    setMatched(understood);
    if (Object.keys(patch).length) onPatch(patch);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-2 py-1 text-[14px] font-semibold text-muted transition-colors hover:text-brand"
      >
        <Sparkle
          size={14}
          strokeWidth={2.4}
          className="text-accent transition-transform group-hover:scale-110"
        />
        Opisz czego szukasz
      </button>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center gap-2 rounded-[12px] border border-line bg-surface py-1 pr-1 pl-3.5">
        <Sparkle size={15} strokeWidth={2.4} className="shrink-0 text-accent" />

        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") setOpen(false);
          }}
          aria-label="Opisz czego szukasz"
          placeholder="Rodzina 2+2, blisko plaży, parking i basen, do 3000 zł…"
          className="h-12 w-full bg-transparent text-[14px] font-semibold outline-none placeholder:font-medium placeholder:text-muted/70"
        />

        <button
          type="button"
          onClick={submit}
          aria-label="Zastosuj opis"
          className="flex size-11 shrink-0 items-center justify-center rounded-[9px] bg-brand text-surface transition-colors hover:bg-[#0d2e26]"
        >
          <ArrowRight size={16} strokeWidth={2.6} />
        </button>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMatched(null);
          }}
          aria-label="Zamknij opis wyszukiwania"
          className="flex size-11 shrink-0 items-center justify-center rounded-[9px] text-muted transition-colors hover:text-ink"
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>

      {matched ? (
        <p role="status" className="mt-2 text-[13px] text-muted">
          {matched.length ? (
            <>
              Zrozumiano:{" "}
              <span className="font-bold text-ink">{matched.join(" · ")}</span>. Pełne
              wyszukiwanie językiem naturalnym pojawi się w kolejnym etapie.
            </>
          ) : (
            <>
              Na razie rozpoznajemy tylko proste hasła: basen, parking, plaża, sauna,
              „2+2”, „do 3000 zł”.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

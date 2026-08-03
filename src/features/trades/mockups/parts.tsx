"use client";

import { useEffect, useId, useRef, useState } from "react";

import { TRADE_RANGE_PRESETS } from "../filters";
import type { TradeFilters, TradeRangePreset } from "../filters";

/**
 * The pieces the four layout mockups are built out of.
 *
 * They wear the app's own material — `.lab-chip` for anything pressable,
 * `.lab-trough` for a field something is seated in, `.lab-readout` for a number
 * being read — so what the mockups are comparing is the *arrangement* and not
 * four different-looking products. Anything a variant would ship as-is lives
 * here rather than being retyped per variant.
 */

/** The raised pill every trigger in the app wears, lit when it is narrowing. */
export function Trigger({
  label,
  count,
  lit = false,
  caret = true,
  onClick,
  expanded,
}: {
  label: string;
  /** How many selections are behind it; omitted where there is nothing to count. */
  count?: number;
  lit?: boolean;
  caret?: boolean;
  onClick?: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "true"}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold ${
        lit ? "lab-chip-on" : "lab-chip text-foreground/85"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[5px] px-1.5 py-0.5 text-[11px] font-bold leading-none ${
            lit ? "bg-[#04141a]/25 text-[#04141a]" : "bg-[#052029] text-active"
          }`}
        >
          {count}
        </span>
      )}
      {caret && (
        <span aria-hidden="true" className="text-[8px] leading-none opacity-60">
          ▾
        </span>
      )}
    </button>
  );
}

/**
 * A floating panel under a trigger — the shape option A is buying.
 *
 * It carries the three behaviours every floating control in this app keeps: one
 * open at a time (the caller's state does that), a press outside dismisses it,
 * and Escape closes it. `align` exists because a trigger near the right edge
 * would otherwise open a 288px panel off the page.
 */
export function Popover({
  open,
  onClose,
  align = "left",
  width = "w-72",
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  width?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={`absolute top-full z-40 mt-2 ${width} ${
        align === "right" ? "right-0" : "left-0"
      } rounded-2xl border border-active/20 bg-gradient-to-b from-[#12212e] to-[#0b1621] p-3 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95)]`}
      style={{ animation: "dialog-rise 0.14s cubic-bezier(0.2,0.9,0.3,1)" }}
    >
      {children}
    </div>
  );
}

/** The uppercase caption over a group of controls. */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-bold uppercase tracking-[0.16em] text-foreground/40">
      {children}
    </span>
  );
}

/** A secondary press — `.lab-chip` at half the thickness, for a segment key. */
export function Key({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        selected ? "lab-chip-on lab-chip-sm" : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

/** The window controls — presets and the two open-ended date bounds. */
export function WindowControls({
  filters,
  onChange,
  compact = false,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /** Abbreviates the preset labels, for the rail where the column is 232px. */
  compact?: boolean;
}) {
  const setPreset = (preset: TradeRangePreset) =>
    onChange({ ...filters, range: { ...filters.range, preset } });

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {TRADE_RANGE_PRESETS.map((preset) => (
          <Key
            key={preset.value}
            selected={filters.range.preset === preset.value}
            onClick={() => setPreset(preset.value)}
          >
            {compact ? SHORT_PRESET[preset.value] : preset.label}
          </Key>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <DateInput
          label="From"
          value={filters.range.from}
          onChange={(from) =>
            onChange({ ...filters, range: { ...filters.range, preset: "custom", from } })
          }
        />
        <span className="text-foreground/30">–</span>
        <DateInput
          label="To"
          value={filters.range.to}
          onChange={(to) =>
            onChange({ ...filters, range: { ...filters.range, preset: "custom", to } })
          }
        />
      </div>
    </div>
  );
}

const SHORT_PRESET: Record<string, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  all: "All",
};

/** All / any, over the whole selection. */
export function MatchControls({
  filters,
  onChange,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
}) {
  return (
    <div className="flex gap-1.5">
      <Key
        selected={filters.match === "all"}
        onClick={() => onChange({ ...filters, match: "all" })}
      >
        All selected
      </Key>
      <Key
        selected={filters.match === "any"}
        onClick={() => onChange({ ...filters, match: "any" })}
      >
        Any selected
      </Key>
    </div>
  );
}

/** A native date input — the platform's calendar, keyboard entry included. */
function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <input
      type="date"
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      className="min-w-0 flex-1 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-active/45"
    />
  );
}

/**
 * The board's size, as a readout rather than a sentence.
 *
 * It holds the slot the deleted page heading used to, which is the trade the
 * whole exercise makes: what a title said about the page is worth less than what
 * this says about the list under it.
 */
export function CountReadout({
  total,
  scopeTotal,
  stacked = false,
}: {
  total: number;
  scopeTotal: number;
  stacked?: boolean;
}) {
  return (
    <p
      className={`flex shrink-0 gap-x-2 text-sm text-foreground/55 ${
        stacked ? "flex-col" : "items-baseline"
      }`}
    >
      <b className="font-display text-lg font-semibold tabular-nums text-foreground">
        {total.toLocaleString()}
      </b>
      <span className="text-xs">
        {total === scopeTotal
          ? "trades"
          : `of ${scopeTotal.toLocaleString()} trades`}
      </span>
    </p>
  );
}

/** A selected filter, restated where it can be removed in one press. */
export function Token({
  kind,
  label,
  onRemove,
}: {
  kind: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-active/30 bg-active/10 py-1 pl-2 pr-1 text-xs font-semibold text-foreground">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-active">
        {kind}
      </span>
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="px-0.5 text-sm leading-none text-foreground/45 transition-colors hover:text-foreground"
      >
        ×
      </button>
    </span>
  );
}

/** A search field styled as the app's recessed readout. */
export function SearchField({
  value,
  onChange,
  placeholder,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onFocus?: () => void;
}) {
  const id = useId();
  return (
    <input
      id={id}
      type="search"
      value={value}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-foreground/30"
    />
  );
}

/** State for a set of popovers where only one may be open. */
export function useOneOpen<T extends string>() {
  const [open, setOpen] = useState<T | null>(null);
  return {
    open,
    close: () => setOpen(null),
    toggle: (key: T) => setOpen((was) => (was === key ? null : key)),
  };
}

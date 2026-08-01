"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_RANGE_PRESETS,
  activeTradeFilterCount,
  pickLabel,
  tradeMatches,
  tradeOptions,
  tradeRangeBounds,
} from "../filters";
import type { TradeFilters, TradeRangePreset } from "../filters";
import type { PlayerSummary, Trade, TradeManager } from "../types";
import { OptionPicker } from "./option-picker";

/**
 * The trade filters, behind a modal — a second trigger beside the league
 * filters' own, not a second tab of one dialog.
 *
 * The two stay apart for the reason the manager tool keeps its header filters
 * and its ADP drawer apart: one narrows *which leagues* are being read, the
 * other *which trades within them*, and a single dialog over both would suggest
 * one selection where there are two. What that costs — a modal hides its own
 * state — is bought back the same way: the trigger wears the count of active
 * filters, and the page names the window in words beside the trade count.
 *
 * Edited as a draft and committed on Apply, because every option carries how many
 * trades it would leave and those counts can't be read while the list behind the
 * dialog moves.
 */
export function TradeFiltersModal({
  filters,
  onChange,
  trades,
  players,
  managers,
  today,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /**
   * The trades the *league* filters leave — what the options and their counts
   * are taken over. Narrowed by the league filters but not by these ones: a menu
   * counted over its own selection collapses to that selection the moment you
   * make it, and can't be widened without being cleared first.
   */
  trades: readonly Trade[];
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  /** `YYYY-MM-DD`, so the relative presets resolve without a clock in here. */
  today: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(filters);
  const active = activeTradeFilterCount(filters);

  // Seeded on open rather than synced with an effect: while the dialog is up it
  // holds focus and the page behind it is inert, so the only moment the two can
  // disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    ref.current?.showModal();
    // The panel takes the focus rather than the first control in it — see
    // `LeagueFiltersModal`, where `showModal`'s autofocus put a focus ring on a
    // chip nobody had pressed.
    panelRef.current?.focus();
  }, [filters]);

  const apply = useCallback(() => {
    onChange(draft);
    ref.current?.close();
  }, [draft, onChange]);

  const bounds = useMemo(
    () => tradeRangeBounds(draft.range, today),
    [draft.range, today],
  );

  // The options are counted over the window the draft describes — narrowing the
  // dates should narrow the menu — but never over the selection itself.
  const windowed = useMemo(
    () =>
      trades.filter((trade) =>
        tradeMatches(trade, DEFAULT_TRADE_FILTERS, bounds),
      ),
    [trades, bounds],
  );

  const managerOptions = useMemo(
    () =>
      tradeOptions(windowed, "managers", (id) => ({
        label: managers[id]?.display_name || id,
      })),
    [windowed, managers],
  );
  const playerOptions = useMemo(
    () =>
      tradeOptions(windowed, "players", (id) => ({
        label: players[id]?.name ?? id,
        note: [players[id]?.position, players[id]?.team]
          .filter(Boolean)
          .join(" · "),
      })),
    [windowed, players],
  );
  const pickOptions = useMemo(
    () => tradeOptions(windowed, "picks", (token) => ({ label: pickLabel(token) })),
    [windowed],
  );

  const matching = useMemo(
    () => windowed.filter((trade) => tradeMatches(trade, draft, bounds)).length,
    [windowed, draft, bounds],
  );

  const setRange = (preset: TradeRangePreset) =>
    setDraft({ ...draft, range: { ...draft.range, preset } });

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        // Same raised pill as its neighbour — see `LeagueFiltersModal`.
        className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold ${
          active > 0 ? "lab-chip-on" : "lab-chip text-foreground/85"
        }`}
      >
        Trades
        {active > 0 && (
          <span className="rounded-[5px] bg-[#052029] px-1.5 py-0.5 text-[11px] font-bold leading-none text-active">
            {active}
          </span>
        )}
      </button>

      <dialog
        ref={ref}
        aria-labelledby="trade-filters-title"
        // The backdrop is the dialog's own pseudo-element, so a click landing on
        // the dialog box itself is a click outside the panel.
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close();
        }}
        className="m-auto w-[min(760px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.72)] backdrop:backdrop-blur-sm"
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className="overflow-hidden outline-none rounded-2xl border border-active/20 bg-gradient-to-b from-[#12212e] to-[#0b1621] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)]"
          style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          <div className="flex items-center gap-3 border-b border-foreground/10 px-5 py-4">
            <h2
              id="trade-filters-title"
              className="text-base font-semibold tracking-tight"
            >
              Filter trades
            </h2>
            <kbd className="ml-auto rounded-[5px] border border-foreground/10 px-1.5 py-1 font-mono text-[10px] text-foreground/40">
              Esc
            </kbd>
          </div>

          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Group label="Completed">
                <div className="flex flex-wrap gap-2">
                  {TRADE_RANGE_PRESETS.map((preset) => (
                    <Chip
                      key={preset.value}
                      selected={draft.range.preset === preset.value}
                      onClick={() => setRange(preset.value)}
                    >
                      {preset.label}
                    </Chip>
                  ))}
                </div>
              </Group>

              <Group label="Between">
                <div className="flex items-center gap-2">
                  <DateInput
                    label="From"
                    value={draft.range.from}
                    onChange={(from) =>
                      setDraft({
                        ...draft,
                        // Typing a date *is* the custom window — there is no mode
                        // to enter first, the same rule the ADP scrubber follows.
                        range: { ...draft.range, preset: "custom", from },
                      })
                    }
                  />
                  <span className="text-foreground/30">–</span>
                  <DateInput
                    label="To"
                    value={draft.range.to}
                    onChange={(to) =>
                      setDraft({
                        ...draft,
                        range: { ...draft.range, preset: "custom", to },
                      })
                    }
                  />
                </div>
              </Group>

              <Group label="Match">
                <div className="flex gap-2">
                  <Chip
                    selected={draft.match === "all"}
                    onClick={() => setDraft({ ...draft, match: "all" })}
                  >
                    All selected
                  </Chip>
                  <Chip
                    selected={draft.match === "any"}
                    onClick={() => setDraft({ ...draft, match: "any" })}
                  >
                    Any selected
                  </Chip>
                </div>
              </Group>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <OptionPicker
                label="Managers"
                placeholder="Search managers…"
                options={managerOptions}
                selected={draft.managers}
                onChange={(managers) => setDraft({ ...draft, managers })}
              />
              <OptionPicker
                label="Players"
                placeholder="Search players…"
                options={playerOptions}
                selected={draft.players}
                onChange={(players) => setDraft({ ...draft, players })}
              />
              <OptionPicker
                label="Picks"
                placeholder="Search picks…"
                options={pickOptions}
                selected={draft.picks}
                onChange={(picks) => setDraft({ ...draft, picks })}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-foreground/10 px-5 py-4">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_TRADE_FILTERS)}
              className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-semibold text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              Reset
            </button>
            <span className="text-sm text-foreground/60">
              <b className="font-semibold tabular-nums text-foreground">
                {matching}
              </b>{" "}
              {matching === 1 ? "trade matches" : "trades match"}
            </span>
            <button
              type="button"
              onClick={apply}
              className="ml-auto rounded-lg bg-active px-4 py-2 text-sm font-bold text-[#04141a] shadow-[0_0_24px_-6px_rgba(0,255,229,0.7)] transition-[filter] hover:brightness-110"
            >
              Apply
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-foreground/40">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
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
      className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${
        selected
          ? "border-active/45 bg-active/10 text-foreground"
          : "border-foreground/10 bg-foreground/[0.04] text-foreground/60 hover:border-foreground/25 hover:text-foreground"
      }`}
    >
      {children}
    </button>
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
      // An emptied input is an *open* end, not today — a window is two
      // independent halves and one of them has to stay expressible.
      onChange={(event) => onChange(event.target.value || null)}
      className="rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-active/45"
    />
  );
}

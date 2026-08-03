"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_CIRCLES,
  TRADE_RANGE_PRESETS,
  activeTradeFilterCount,
  pickLabel,
  tradeRangeBounds,
} from "../filters";
import type {
  TradeCircle,
  TradeFilters,
  TradeOption,
  TradeRangePreset,
} from "../filters";
import { useTradeCount, useTradeFacets } from "../hooks/use-trade-facets";
import type { LeagueScope } from "../trade-query";
import type { PlayerSummary, TradeManager } from "../types";
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
 * Edited as a draft and committed on Apply, because every option carries how
 * many trades it would leave and those counts can't be read while the list
 * behind the dialog moves.
 *
 * **The options are counted by the database now, and the dialog is what asks.**
 * They used to be counted here, off the season the browser was holding; with the
 * board paginated there is no season in the browser to count, so `useTradeFacets`
 * asks `/api/trades/facets` for the same three menus over the same population.
 * The lists and their numbers are unchanged — what changed is that a reader who
 * never opens this dialog never pays for them, which is most readers. That is
 * also why this component is dynamically imported: its markup, its option picker
 * and the query behind it are all off the first-paint bundle.
 *
 * The request is `null` while the dialog is closed, which is the mechanism —
 * `useAdp`'s, for the same reason — that keeps a closed dialog from costing a
 * request.
 */
export function TradeFiltersModal({
  filters,
  onChange,
  season,
  scope,
  account,
  players,
  managers,
  today,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  season: string;
  /**
   * The league narrowing in force — the options are counted over the leagues the
   * *league* filters leave, since that is the list this dialog narrows further.
   */
  scope: LeagueScope;
  /**
   * The reader's stored account, or null. The circle is the only control here
   * that needs one, and with none it is offered as a disabled row that says why
   * rather than being hidden — a filter nobody can see is one nobody knows they
   * could have.
   */
  account: UserInfo | null;
  /** Names the board has already resolved; the facets bring their own for the rest. */
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  /** `YYYY-MM-DD`, so the relative presets resolve without a clock in here. */
  today: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(false);
  const active = activeTradeFilterCount(filters);

  // Seeded on open rather than synced with an effect: while the dialog is up it
  // holds focus and the page behind it is inert, so the only moment the two can
  // disagree is the moment it opens.
  const show = useCallback(() => {
    setDraft(filters);
    setOpen(true);
    ref.current?.showModal();
    // The panel takes the focus rather than the first control in it — see
    // `LeagueFiltersModal`, where `showModal`'s autofocus put a focus ring on a
    // chip nobody had pressed.
    panelRef.current?.focus();
  }, [filters]);

  // Every way out reports through the dialog's own `close` event, so the parent
  // hears one signal rather than three — and the facets query is disabled the
  // moment it does, rather than on the next render of whoever closed it.
  const close = useCallback(() => setOpen(false), []);

  const apply = useCallback(() => {
    onChange(draft);
    ref.current?.close();
  }, [draft, onChange]);

  const bounds = useMemo(
    () => tradeRangeBounds(draft.range, today),
    [draft.range, today],
  );

  // Two requests, because they move at different rates. The **menus** are
  // counted over the league scope and the window the draft describes — so they
  // re-ask when a date chip is pressed and cannot when a checkbox is — and the
  // selection is stripped from their key so a checkbox doesn't re-run a
  // season-wide aggregate for an answer that can't have changed. The **count**
  // is the whole draft, and is a `count(*)`.
  const user = account?.user_id ?? null;
  const circle = draft.circle;
  const menuRequest = useMemo(
    () =>
      open
        ? {
            season,
            scope,
            // The selection is stripped and **the circle is not**: it says which
            // trades are on this board at all, so a menu counted without it
            // would offer managers and players the reader cannot reach. Only the
            // three checkbox lists are lifted out, because only they can't
            // change what these counts say.
            filters: { ...DEFAULT_TRADE_FILTERS, circle },
            bounds,
            user,
          }
        : null,
    [open, season, scope, bounds, circle, user],
  );
  const countRequest = useMemo(
    () => (open ? { season, scope, filters: draft, bounds, user } : null),
    [open, season, scope, draft, bounds, user],
  );

  const { data: facets, loading: facetsLoading } = useTradeFacets(menuRequest);
  const matching = useTradeCount(countRequest);

  const names = facets?.names;
  const managerOptions = useMemo(
    () =>
      toOptions(facets?.managers, (id) => ({
        label: names?.managers[id]?.display_name || managers[id]?.display_name || id,
      })),
    [facets?.managers, names, managers],
  );
  const playerOptions = useMemo(
    () =>
      toOptions(facets?.players, (id) => {
        const player = names?.players[id] ?? players[id];
        return {
          label: player?.name ?? id,
          note: [player?.position, player?.team].filter(Boolean).join(" · "),
        };
      }),
    [facets?.players, names, players],
  );
  const pickOptions = useMemo(
    // A pick's label is a pure formatting of its own token, which is why the
    // route doesn't send one — it would be a string derivable from the one
    // beside it.
    () => toOptions(facets?.picks, (token) => ({ label: pickLabel(token) })),
    [facets?.picks],
  );

  const setRange = (preset: TradeRangePreset) =>
    setDraft({ ...draft, range: { ...draft.range, preset } });

  return (
    <>
      <button
        type="button"
        onClick={show}
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
        onClose={close}
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
            <Group label="Scope">
              <div className="flex flex-wrap gap-2">
                {TRADE_CIRCLES.map((option) => (
                  <CircleChip
                    key={option.value}
                    option={option}
                    selected={draft.circle === option.value}
                    // Every circle but the widest is drawn around an account, so
                    // without one there is nothing to draw. Disabled rather than
                    // absent: what it takes to switch it on is a sentence, and
                    // hiding the control hides the sentence too.
                    disabled={option.value !== "all" && account === null}
                    onSelect={(value) => setDraft({ ...draft, circle: value })}
                  />
                ))}
              </div>
              <p className="text-xs text-foreground/45">
                {account === null
                  ? "Look your Sleeper account up on the tools page to filter by your own leagues and leaguemates."
                  : circleNote(draft.circle, account)}
              </p>
            </Group>

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
                loading={facetsLoading}
              />
              <OptionPicker
                label="Players"
                placeholder="Search players…"
                options={playerOptions}
                selected={draft.players}
                onChange={(players) => setDraft({ ...draft, players })}
                loading={facetsLoading}
              />
              <OptionPicker
                label="Picks"
                placeholder="Search picks…"
                options={pickOptions}
                selected={draft.picks}
                onChange={(picks) => setDraft({ ...draft, picks })}
                loading={facetsLoading}
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
              {matching === null ? (
                // The count is a round trip now, so there is a moment before it
                // exists. An em dash rather than a stale or invented number —
                // the same reading an unprojected week gets.
                <b className="font-semibold tabular-nums text-foreground">—</b>
              ) : (
                <b className="font-semibold tabular-nums text-foreground">
                  {matching.toLocaleString()}
                </b>
              )}{" "}
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

/**
 * A facet list as the picker's options, labelled.
 *
 * The counts arrive ordered by count already; the tiebreak on label is applied
 * here because only this side knows what a value is called — a player's name is
 * a row in another table and a pick's is a formatting of its own token.
 */
function toOptions(
  facets: readonly { value: string; count: number }[] | undefined,
  label: (value: string) => { label: string; note?: string },
): TradeOption[] {
  if (!facets) return [];
  return facets
    .map((facet) => ({ ...label(facet.value), ...facet }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
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

/**
 * One circle, with what it means under its name.
 *
 * A wider key than the chips beside it because the label alone does not separate
 * the two leaguemate readings — one is about who was dealing, the other about
 * where the deal happened — and a reader choosing between them is choosing
 * between two quite different boards.
 */
function CircleChip({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: (typeof TRADE_CIRCLES)[number];
  selected: boolean;
  disabled: boolean;
  onSelect: (value: TradeCircle) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(option.value)}
      className={`flex max-w-[15rem] flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-active/45 bg-active/10 text-foreground"
          : disabled
            ? // Flat and unlit, the app bar's rule at chip scale: a part that
              // does nothing when pressed must not look pressable.
              "cursor-not-allowed border-foreground/[0.06] bg-transparent text-foreground/25"
            : "border-foreground/10 bg-foreground/[0.04] text-foreground/60 hover:border-foreground/25 hover:text-foreground"
      }`}
    >
      <span className="text-sm font-semibold">{option.label}</span>
      <span className="text-[11px] leading-tight opacity-70">{option.note}</span>
    </button>
  );
}

/**
 * The one fact the chips cannot carry: *whose* circle this is.
 *
 * Each chip already says what its circle means, so restating that here would be
 * saying it twice; what is worth a line is the account it is drawn around, which
 * is stored on the device and may not be the one the reader has in mind.
 */
function circleNote(circle: TradeCircle, account: UserInfo): string {
  return circle === "all"
    ? "Every league this database has crawled."
    : `Drawn around @${account.display_name || account.username} — the account stored on this device.`;
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

"use client";

import { type ReactNode, useEffect, useRef } from "react";

import {
  ADP_RANGE_PRESETS,
  type AdpControls,
  type AdpRange,
  defaultAdpControls,
  rangeLabel,
  seedFromLeague,
} from "../adp-controls";
import type { AdpState } from "../hooks/use-adp";
import type { ManagerLeague } from "../types";
import { PositionBadge } from "./ui";

const DRAFT_TYPE_OPTS = [
  { value: "snakelinear", label: "Snake / Linear" },
  { value: "snake", label: "Snake" },
  { value: "linear", label: "Linear" },
  { value: "auction", label: "Auction" },
] as const;

const LEAGUE_TYPE_OPTS = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
] as const;

const SCORING_OPTS = [
  { value: "all", label: "All scoring" },
  { value: "std", label: "Standard" },
  { value: "half_ppr", label: "Half PPR" },
  { value: "ppr", label: "PPR" },
] as const;

const SUPERFLEX_OPTS = [
  { value: "all", label: "SF & 1QB" },
  { value: "yes", label: "Superflex" },
  { value: "no", label: "1QB" },
] as const;

const BEST_BALL_OPTS = [
  { value: "all", label: "BB & lineup" },
  { value: "no", label: "Lineup" },
  { value: "yes", label: "Best ball" },
] as const;

const ROUNDS_OPTS = [
  { value: "all", label: "All rounds" },
  { value: "rookie", label: "≤5 (rookie)" },
  { value: "full", label: "12+ (startup)" },
] as const;

// The value-curve steepness — how top-heavy the ADP → team-value curve is. It
// drives the Leagues-tab card value, not which drafts the per-player ADP averages.
const STEEPNESS_OPTS = [
  { value: "flat", label: "Flat" },
  { value: "balanced", label: "Balanced" },
  { value: "steep", label: "Top-heavy" },
] as const;

/**
 * The button that opens the board, sitting in the manager header's state cluster
 * beside the league filters' own trigger.
 *
 * It carries the two facts worth having without opening anything: the window the
 * board covers and how many crawled drafts that matched. The ten selects this
 * replaced cost ~110px above every tab's first row for controls that are read
 * once and then ignored.
 *
 * It wears the same pill as the filters trigger but never its accent: that
 * button tints when a filter is *active*, a state this one doesn't have — a
 * board is always chosen — so borrowing the tint would spend the header's one
 * "something is narrowed" signal on a constant. The cyan is kept to the `ADP`
 * tag, which says which of the two neighbouring buttons this is.
 */
export function AdpTrigger({
  range,
  draftCount,
  loading,
  onClick,
}: {
  range: AdpRange;
  /** Drafts the current board matched; null before the first board lands. */
  draftCount: number | null;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 py-1.5 pl-3 pr-3.5 text-sm font-semibold text-foreground/70 transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-active/80">
        ADP
      </span>
      {rangeLabel(range)}
      <span className="font-normal text-foreground/40">
        {draftCount === null
          ? loading
            ? "loading…"
            : "—"
          : `${draftCount.toLocaleString()} draft${draftCount === 1 ? "" : "s"}`}
      </span>
    </button>
  );
}

/**
 * The ADP board: which crawled drafts the average is taken over, and the board
 * those settings produce.
 *
 * A right-hand drawer rather than a bar on the page, because the settings are
 * set once and read rarely while the page under them is what a visitor came for.
 * The controls are pinned at the top and only the board scrolls, which is the
 * whole point of the shape: changing a filter and watching the ADP move is one
 * glance, where a stacked panel puts the board below the fold on a laptop. That
 * is also why the filters are chips rather than eight labelled selects — the
 * pinned block has to stay short enough to leave the board room.
 *
 * The board is fetched by the caller and passed in, gated on `open`, so a closed
 * drawer costs nothing.
 */
export function AdpDrawer({
  open,
  onClose,
  controls,
  onChange,
  leagues,
  board,
}: {
  open: boolean;
  onClose: () => void;
  controls: AdpControls;
  onChange: (controls: AdpControls) => void;
  leagues: ManagerLeague[];
  /** The board these controls produce; `data` is null until the first load lands. */
  board: AdpState;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind stops scrolling while it's open — a
  // full-height panel over a scrolling page reads as a rendering bug.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const { draft_count, player_count, players } = board.data ?? {
    draft_count: null,
    player_count: null,
    players: [],
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close ADP board"
        onClick={onClose}
        className="absolute inset-0 bg-[rgb(4,10,16)]/70 backdrop-blur-[1px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="ADP board"
        tabIndex={-1}
        className="relative ml-auto flex h-full w-full max-w-[32rem] flex-col border-l border-active/20 bg-[rgb(12,23,33)] shadow-[-24px_0_60px_rgba(0,0,0,0.5)] outline-none"
      >
        <header className="flex items-center gap-3 border-b border-foreground/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight">ADP board</h2>
            <p className="truncate text-xs text-foreground/45">
              {draft_count === null
                ? "Loading…"
                : `${draft_count.toLocaleString()} draft${draft_count === 1 ? "" : "s"}`}{" "}
              · {rangeLabel(controls.range)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid h-7 w-7 place-items-center rounded-md border border-foreground/10 text-foreground/50 transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            ✕
          </button>
        </header>

        {/* Pinned: everything that changes the board stays on screen while the
            board itself scrolls under it. */}
        <div className="flex flex-col gap-3 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-3">
          <RangeControl
            range={controls.range}
            onChange={(range) => onChange({ ...controls, range })}
          />

          <div className="flex flex-wrap gap-1.5">
            {/* An action, not a selection: the value stays "" so it re-arms after use. */}
            <ChipSelect
              value=""
              placeholder="Match a league…"
              ariaLabel="Match one of this manager's leagues"
              options={leagues.map((league) => ({
                value: league.league_id,
                label: league.name,
              }))}
              onChange={(leagueId) => {
                const league = leagues.find((l) => l.league_id === leagueId);
                if (league) onChange(seedFromLeague(controls, league));
              }}
            />
            <ChipSelect
              value={controls.draftType}
              options={DRAFT_TYPE_OPTS}
              ariaLabel="Draft type"
              narrowed={controls.draftType !== "snakelinear"}
              onChange={(draftType) => onChange({ ...controls, draftType })}
            />
            <ChipSelect
              value={controls.leagueType}
              options={LEAGUE_TYPE_OPTS}
              ariaLabel="League type"
              narrowed={controls.leagueType !== "all"}
              onChange={(leagueType) => onChange({ ...controls, leagueType })}
            />
            <ChipSelect
              value={controls.scoring}
              options={SCORING_OPTS}
              ariaLabel="Scoring"
              narrowed={controls.scoring !== "all"}
              onChange={(scoring) => onChange({ ...controls, scoring })}
            />
            <ChipSelect
              value={controls.superflex}
              options={SUPERFLEX_OPTS}
              ariaLabel="Quarterbacks started"
              narrowed={controls.superflex !== "all"}
              onChange={(superflex) => onChange({ ...controls, superflex })}
            />
            <ChipSelect
              value={controls.bestBall}
              options={BEST_BALL_OPTS}
              ariaLabel="Format"
              narrowed={controls.bestBall !== "all"}
              onChange={(bestBall) => onChange({ ...controls, bestBall })}
            />
            <ChipSelect
              value={controls.rounds}
              options={ROUNDS_OPTS}
              ariaLabel="Draft rounds"
              narrowed={controls.rounds !== "all"}
              onChange={(rounds) => onChange({ ...controls, rounds })}
            />
            <ChipSelect
              value={controls.teams}
              ariaLabel="League size"
              narrowed={controls.teams !== "all"}
              options={[
                { value: "all", label: "All sizes" },
                ...teamSizes(leagues).map((size) => ({
                  value: String(size),
                  label: `${size} teams`,
                })),
              ]}
              onChange={(teams) => onChange({ ...controls, teams })}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/40">
              Value curve
            </span>
            <div className="flex flex-1 gap-1">
              {STEEPNESS_OPTS.map((opt) => (
                <Segment
                  key={opt.value}
                  active={controls.steepness === opt.value}
                  onClick={() => onChange({ ...controls, steepness: opt.value })}
                >
                  {opt.label}
                </Segment>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {board.error ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              ADP unavailable — {board.error}
            </p>
          ) : players.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-foreground/45">
              {board.loading
                ? "Loading the board…"
                : "No crawled drafts match these filters."}
            </p>
          ) : (
            <>
              <div className="mb-1.5 grid grid-cols-[1.75rem_1fr_2rem_3rem_3rem] items-center gap-2 px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35">
                <span className="text-right">#</span>
                <span>Player</span>
                <span />
                <span className="text-right">ADP</span>
                <span className="text-right">Taken</span>
              </div>
              <ul>
                {players.map((player) => (
                  <li
                    key={player.player_id}
                    className="grid grid-cols-[1.75rem_1fr_2rem_3rem_3rem] items-center gap-2 border-t border-foreground/[0.04] px-1 py-1.5 text-sm"
                  >
                    <span className="text-right text-xs tabular-nums text-foreground/35">
                      {player.rank}
                    </span>
                    <span className="truncate">
                      {player.name}
                      {player.team && (
                        <span className="ml-1.5 text-xs text-foreground/35">
                          {player.team}
                        </span>
                      )}
                    </span>
                    <PositionBadge position={player.position} />
                    <span className="text-right font-semibold tabular-nums">
                      {player.adp.toFixed(1)}
                    </span>
                    {/* Of the drafts on this board, not of every draft crawled —
                        which is what makes it readable beside the ADP. */}
                    <span className="text-right text-xs tabular-nums text-foreground/40">
                      {draft_count ? `${Math.round((player.picks / draft_count) * 100)}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              {player_count !== null && player_count > players.length && (
                <p className="px-1 pt-2 text-xs text-foreground/35">
                  Showing the first {players.length.toLocaleString()} of{" "}
                  {player_count.toLocaleString()} players on this board.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-foreground/10 bg-foreground/[0.015] px-4 py-2.5">
          <button
            type="button"
            onClick={() => onChange(defaultAdpControls())}
            className="rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/75 transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            Reset
          </button>
          <p className="min-w-0 flex-1 truncate text-xs text-foreground/35">
            Averaged over this app’s crawled drafts — not market ADP.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-active/35 bg-active/[0.08] px-3 py-1.5 text-sm font-semibold text-active transition-colors hover:bg-active/[0.16]"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The Players tab's page-side line: how many crawled drafts the board matched,
 * and the standing caveat that the number describes this app's database and not
 * the market. The drawer names the board too, but this has to survive the drawer
 * being closed — the ADP column is on screen either way.
 */
export function AdpBoardCaption({
  draftCount,
  loading,
  error,
  range,
}: {
  /** Drafts the current filters matched; null while the first board loads. */
  draftCount: number | null;
  loading: boolean;
  error: string | null;
  range: AdpRange;
}): ReactNode {
  if (error) {
    return <span className="text-amber-300">ADP unavailable — {error}</span>;
  }
  if (draftCount === null) return "Loading ADP…";
  if (draftCount === 0) return "No crawled drafts match these filters.";
  return (
    <>
      Averaged over{" "}
      <b className="font-semibold text-foreground/70">
        {draftCount.toLocaleString()}
      </b>{" "}
      crawled {draftCount === 1 ? "draft" : "drafts"} from{" "}
      {rangeLabel(range).toLowerCase()} in this app’s data — not market ADP.
      {loading && <span className="text-foreground/35"> Updating…</span>}
    </>
  );
}

/**
 * The window control: presets carry the intent ("recent drafts", "everything"),
 * and the two date fields appear only under Custom so the common path is one
 * click and the pinned block stays short.
 *
 * Switching to Custom seeds nothing — an empty custom range is "all time", which
 * is honest about narrowing nothing rather than inventing a window.
 */
function RangeControl({
  range,
  onChange,
}: {
  range: AdpRange;
  onChange: (range: AdpRange) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/40">
          Drafted
        </span>
        {ADP_RANGE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange({ ...range, preset: preset.value })}
            aria-pressed={range.preset === preset.value}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              range.preset === preset.value
                ? "border-active/35 bg-active/10 text-active"
                : "border-foreground/10 bg-foreground/5 text-foreground/50 hover:border-foreground/25 hover:text-foreground/80"
            }`}
          >
            {preset.chip}
          </button>
        ))}
      </div>

      {range.preset === "custom" && (
        <div className="flex items-center gap-2">
          <DateField
            label="From"
            value={range.from}
            max={range.to}
            onChange={(from) => onChange({ ...range, from })}
          />
          <span aria-hidden="true" className="text-xs text-foreground/30">
            →
          </span>
          <DateField
            label="To"
            value={range.to}
            min={range.from}
            onChange={(to) => onChange({ ...range, to })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One end of a custom range. `min`/`max` are the *other* end, so the picker
 * can't produce an inverted range — which the route rejects outright rather than
 * answering with an empty board.
 */
function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string | null;
  min?: string | null;
  max?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="flex flex-1 items-center gap-2">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/40">
        {label}
      </span>
      <input
        type="date"
        value={value ?? ""}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1 text-xs text-foreground transition-colors hover:border-foreground/20 focus:border-active/50 focus:outline-none [color-scheme:dark]"
      />
    </label>
  );
}

/**
 * A filter as a chip. It is a real `<select>` under the styling rather than a
 * bespoke menu, so keyboard and touch behaviour come free and the pinned block
 * costs one line per filter instead of a labelled row.
 *
 * `narrowed` tints a chip that is actually cutting the population, which is what
 * lets the row be read at a glance: the accented chips are the board.
 */
function ChipSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  narrowed = false,
}: {
  value: T | "";
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Shown as a disabled first option — for a chip that acts rather than selects. */
  placeholder?: string;
  narrowed?: boolean;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
      className={`max-w-[12rem] truncate rounded-full border px-2.5 py-1 text-xs transition-colors [color-scheme:dark] focus:outline-none ${
        narrowed
          ? "border-active/32 bg-active/10 text-active hover:border-active/50"
          : "border-foreground/10 bg-foreground/5 text-foreground/60 hover:border-foreground/25 hover:text-foreground/85"
      }`}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-md border px-2 py-1 text-xs transition-colors ${
        active
          ? "border-active/35 bg-active/10 text-active"
          : "border-foreground/10 bg-foreground/5 text-foreground/50 hover:border-foreground/25 hover:text-foreground/80"
      }`}
    >
      {children}
    </button>
  );
}

/** The sizes this manager actually plays, so seeding from a league always lands on a listed option. */
function teamSizes(leagues: ManagerLeague[]): number[] {
  return Array.from(new Set(leagues.map((l) => l.total_rosters))).sort((a, b) => a - b);
}

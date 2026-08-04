"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { DraftDensityMonth, ManagerLeague } from "@/shared/manager";

import {
  ADP_PEAK,
  type AdpControls,
  type AdpRange,
  DEFAULT_ADP_RANGE,
  STEEPNESS_RANGE,
  adpRangePresets,
  boardLabel,
  previewAdpPool,
  previewAdpValue,
  rangeBounds,
  seasonOptions,
  seedFromLeague,
  steepnessSummary,
  todayIso,
} from "../adp-controls";
import type { AdpState } from "../use-adp";
import type { AdpDensityState } from "../use-adp-density";
import { PositionBadge } from "./position-badge";
import { RangeScrubber, RangeSparkline } from "./range-scrubber";

/**
 * The board's grid, written out whole so Tailwind can see it, and shared by the
 * heading row and the rows under it — a header laid out separately drifts the
 * moment a width changes, the same rule the roster panel's `SectionLayout` holds.
 */
const BOARD_COLUMNS = "grid-cols-[1.75rem_1fr_2rem_2.75rem_2.5rem_3.25rem]";

/**
 * The board's filters, as a table rather than six hand-written controls.
 *
 * They are read as a list now — only the ones actually narrowing the board are
 * on screen, and the rest are behind one key — so the row has to be able to say
 * *which* those are. `get` and `set` are what keeps that type-safe without a
 * computed key: each entry names its own field, so a value can only be written
 * back to the field it was read from.
 */
type FilterSpec = {
  key: string;
  ariaLabel: string;
  options: readonly { value: string; label: string }[];
  get: (c: AdpControls) => string;
  set: (c: AdpControls, value: string) => AdpControls;
};

// What *kind* of draft, which is a round count underneath: a startup fills a
// roster, a rookie draft is a handful of rounds. It replaced a snake/linear/auction
// chip in this slot — the room's picking order is not a fact about the market it
// priced, where a startup's 1.01 and a rookie draft's 1.01 are different players.
const ROUNDS_FILTER: FilterSpec = {
  key: "rounds",
  ariaLabel: "Kind of draft",
  options: [
    { value: "all", label: "All drafts" },
    { value: "full", label: "Startup (12+ rds)" },
    { value: "rookie", label: "Rookie (≤5 rds)" },
  ],
  get: (c) => c.rounds,
  set: (c, v) => ({ ...c, rounds: v as AdpControls["rounds"] }),
};

const FIXED_FILTERS: readonly FilterSpec[] = [
  ROUNDS_FILTER,
  {
    key: "leagueType",
    ariaLabel: "League type",
    options: [
      { value: "all", label: "All types" },
      { value: "0", label: "Redraft" },
      { value: "1", label: "Keeper" },
      { value: "2", label: "Dynasty" },
    ],
    get: (c) => c.leagueType,
    set: (c, v) => ({ ...c, leagueType: v as AdpControls["leagueType"] }),
  },
  {
    key: "scoring",
    ariaLabel: "Scoring",
    options: [
      { value: "all", label: "All scoring" },
      { value: "std", label: "Standard" },
      { value: "half_ppr", label: "Half PPR" },
      { value: "ppr", label: "PPR" },
    ],
    get: (c) => c.scoring,
    set: (c, v) => ({ ...c, scoring: v as AdpControls["scoring"] }),
  },
  {
    key: "superflex",
    ariaLabel: "Quarterbacks started",
    options: [
      { value: "all", label: "SF & 1QB" },
      { value: "yes", label: "Superflex" },
      { value: "no", label: "1QB" },
    ],
    get: (c) => c.superflex,
    set: (c, v) => ({ ...c, superflex: v as AdpControls["superflex"] }),
  },
  {
    key: "bestBall",
    ariaLabel: "Format",
    options: [
      { value: "all", label: "BB & lineup" },
      { value: "no", label: "Lineup" },
      { value: "yes", label: "Best ball" },
    ],
    get: (c) => c.bestBall,
    set: (c, v) => ({ ...c, bestBall: v as AdpControls["bestBall"] }),
  },
];

/**
 * The button that opens the board, seated in the app bar.
 *
 * **It says one word.** It used to carry the window and the matched draft count
 * — `All of 2026 · 1,204 drafts` — which was right in the manager header's
 * control dock, where a line of chrome could afford a sentence. The bar is a row
 * of *names* (the mark, the tool you are in, Tools), it is the width a phone has
 * for all of them at once, and the drawer states the board and the count in its
 * own header one press away. So the label is the tool's name and the sentence is
 * inside. The board is still named on hover, which is the desktop backstop the
 * roster panel's contracted names already use — not the plan, since a phone has
 * no hover and is the width the change was made for.
 *
 * **It is a block, not a face** (`.lab-billet`). The bar's other parts extrude
 * straight down at 3px; this one carries a 6px wall down and to the right,
 * graded from a lit near corner to a dark far one. At 3px a wall is a line and
 * its colour is decoration; at 6px it is a face you read the shading of, which
 * is the difference between an object sitting on the bar and a rectangle drawn
 * in it. That is what lets the part be recognisable at three characters — and
 * what keeps it from being the Tools key in a second colour, which is the
 * failure mode of drawing it in the bar's existing material.
 *
 * **It wears its own subject.** An accent rail down the leading face — the
 * manager plate's mark for "a readout follows" — and three descending bars,
 * which is what an ADP curve looks like at 13px. The bars stand in a milled
 * channel (`.lab-channel`) rather than being painted on the face, because at
 * this size the eye reads the *inside* of a part before it reads the outline:
 * three cyan rectangles are a texture, three solids with a lit top edge and a
 * dark side standing in a cut are objects.
 *
 * **Those bars carry the one fact the label gave up.** The old trigger never
 * took an accent state, on the grounds that a board is always chosen and tinting
 * a constant spends a signal; that argument held *because the trigger named the
 * board*. It doesn't now, so whether this reader's board is narrowed away from
 * everybody else's lights the bars ({@link adpNarrowingCount}) — the part that
 * already means "board" — and raises the block's own glow. Never the face: the
 * bar keeps exactly one fully lit key, and that is Tools.
 */
export function AdpTrigger({
  range,
  season,
  draftCount,
  narrowed,
  onClick,
}: {
  range: AdpRange;
  season: string;
  /** Drafts the current board matched; null before the first board lands. */
  draftCount: number | null;
  /** Settings narrowing the board away from the default — 0 is everyone's board. */
  narrowed: number;
  onClick: () => void;
}) {
  const board = boardLabel(range, season);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      // The board and its size, for a pointer that rests on the part. Everything
      // it says is stated again inside the drawer, so nothing here is the only
      // place a fact lives.
      title={
        draftCount === null
          ? `ADP board — ${board}`
          : `ADP board — ${board}, ${draftCount.toLocaleString()} draft${
              draftCount === 1 ? "" : "s"
            }`
      }
      className={`lab-billet lab-notch-all inline-flex h-[38px] flex-none pb-[6px] pr-[6px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70 ${
        narrowed > 0 ? "lab-billet-lit" : ""
      }`}
    >
      <span className="lab-billet-face lab-notch-all flex h-[32px] items-center gap-[9px] whitespace-nowrap pr-3 font-display text-[11px] font-extrabold uppercase tracking-[0.13em] text-foreground/90">
        {/* The rail is flush to the block's leading edge — no inset — because it
            is the *side* of the part catching the light, not a stripe on it. */}
        <span aria-hidden className="lab-billet-rail w-[6px] flex-none self-stretch" />
        <span
          aria-hidden
          className="lab-channel flex flex-none items-end gap-[2px] rounded-[2px] px-1 py-[3px]"
        >
          {/* Three descending heights: the shape of a board, and data rather
              than material, so it stays here and not in the class. */}
          {[13, 9, 5].map((height) => (
            <span
              key={height}
              style={{ height }}
              className={`block w-[3px] rounded-[1px] ${
                narrowed > 0 ? "lab-channel-bar-lit" : "lab-channel-bar"
              }`}
            />
          ))}
        </span>
        ADP
        {/* Nothing visible says what the lit bars mean, and there is no room to
            write it. */}
        {narrowed > 0 && (
          <span className="sr-only">
            — board narrowed by {narrowed} setting{narrowed === 1 ? "" : "s"}
          </span>
        )}
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
  onReset,
  defaultSeason,
  leagues,
  board,
  density,
}: {
  open: boolean;
  onClose: () => void;
  controls: AdpControls;
  onChange: (controls: AdpControls) => void;
  /** Back to the default board — held by the store, which owns what "default" is. */
  onReset: () => void;
  /** The season a board opens on; decides which relative presets can mean anything. */
  defaultSeason: string;
  leagues: readonly ManagerLeague[];
  /** The board these controls produce; `data` is null until the first load lands. */
  board: AdpState;
  /** Crawled drafts per month and season, for the range scrubber's strip. */
  density: AdpDensityState;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // The curve the slider is *currently* sitting on, while it is being dragged.
  // The preview below has to re-price on every notch — watching the board bend
  // is the whole reason the curve is a slider — but the committed value re-fetches
  // every league's team value on the Leagues tab behind this drawer, so the store
  // only moves when the handle is let go. Null means nothing is being dragged.
  const [dragging, setDragging] = useState<number | null>(null);
  const steepness = dragging ?? controls.steepness;

  // Which of the two expanding controls is up, as one selection rather than two
  // booleans. They can't both be: the window's panel *floats* over the rows below
  // it, so an open filter tray under it would be a control the reader can see and
  // can't reach — and one-open-at-a-time is what the league filters' own floating
  // rows do, for the same reason.
  const [openPanel, setOpenPanel] = useState<"range" | "filters" | null>(null);
  const toggle = (which: "range" | "filters") =>
    setOpenPanel((current) => (current === which ? null : which));

  // A drawer reopened is a drawer at rest: the window's panel floats over the
  // board, so one left hanging open covers the thing the drawer was opened to
  // show. Adjusted during render against the previous `open` rather than in an
  // effect — the pattern `useFilteredTrades` and `ColumnsEditor` use, and the
  // cascading render the lint rule objects to.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (openPanel !== null) setOpenPanel(null);
  }

  // Read by the Escape handler below, which depends on `open` alone.
  const latestPanel = useRef(openPanel);
  useEffect(() => {
    latestPanel.current = openPanel;
  }, [openPanel]);

  // Held in a ref so the effect below can depend on `open` alone. Callers pass a
  // fresh arrow every render, so depending on `onClose` re-ran the whole effect
  // on every keystroke — which meant `panel.focus()` fired again and took focus
  // off whatever was being used. That was survivable while the drawer held only
  // selects (each change already ends the interaction); it is not survivable for
  // the range scrubber, whose handles are nudged with the arrow keys one press
  // at a time.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);

  // Escape closes, and the page behind stops scrolling while it's open — a
  // full-height panel over a scrolling page reads as a rendering bug. Focus
  // moves to the panel once, on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the innermost thing that is up. Without this the window's
      // floating panel and the whole drawer would go on one keypress.
      if (latestPanel.current !== null) {
        setOpenPanel(null);
        return;
      }
      latestClose.current();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // The seasons on offer and the strip behind the window are both slices of the
  // one density read. Memoised on the rows so the scrubber's own domain memo
  // isn't invalidated by a fresh array every render.
  const seasons = useMemo(
    () => seasonOptions(density.months, controls.season, defaultSeason),
    [density.months, controls.season, defaultSeason],
  );
  // The size filter is the one whose options are data, so the table is completed
  // here rather than at module scope. Memoised because `FilterRow` walks it on
  // every render to decide what is narrowing the board.
  const filters = useMemo<readonly FilterSpec[]>(
    () => [
      ...FIXED_FILTERS,
      {
        key: "teams",
        ariaLabel: "League size",
        options: [
          { value: "all", label: "All sizes" },
          // The sizes this manager actually plays, so seeding from a league
          // always lands on a listed option.
          ...Array.from(new Set(leagues.map((l) => l.total_rosters)))
            .sort((a, b) => a - b)
            .map((size) => ({ value: String(size), label: `${size} teams` })),
        ],
        get: (c) => c.teams,
        set: (c, v) => ({ ...c, teams: v }),
      },
    ],
    [leagues],
  );

  const seasonMonths = useMemo(
    () =>
      controls.season === "all"
        ? density.months
        : density.months.filter((m) => m.season === controls.season),
    [density.months, controls.season],
  );

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
        {/* Pinned: everything that changes the board stays on screen while the
            board itself scrolls under it.

            It is three rows rather than six. The identity, the season and the
            draft count are one line — a header stating a count the trigger
            already carried, over a labelled row of two season keys, was two
            lines saying what fits on one. The `DRAFTED` label and its segment
            strip are gone into the strip's own caption, which was already
            reporting the window. And the filter row shows only what is actually
            narrowing the board: seven chips permanently reading "All" are seven
            controls' worth of height reporting that nothing is set. */}
        <div className="flex flex-col gap-2 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-2">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[0.8rem] font-bold tracking-[0.14em] text-active/85">
              ADP
            </h2>
            <div className="flex gap-1">
              {seasons.map((s) => (
                <KeyChip
                  key={s}
                  on={controls.season === s}
                  onClick={() =>
                    // The window is dropped with the season, not carried across
                    // it: a date range is a cut *inside* one, so the same dates
                    // against a different season are a window that mostly isn't
                    // there — and silently returning an empty board is worse
                    // than starting the new season whole.
                    onChange({ ...controls, season: s, range: DEFAULT_ADP_RANGE })
                  }
                >
                  {s === "all" ? "All" : s}
                </KeyChip>
              ))}
            </div>
            <span className="lab-readout ml-auto flex items-baseline gap-1.5 rounded-[5px] px-2.5 py-[3px]">
              <span className="font-display text-[0.8rem] font-bold tabular-nums text-active">
                {draft_count === null ? "—" : draft_count.toLocaleString()}
              </span>
              <span className="text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-foreground/40">
                {draft_count === 1 ? "draft" : "drafts"}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-foreground/10 text-foreground/50 transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              ✕
            </button>
          </div>

          <RangeControl
            range={controls.range}
            season={controls.season}
            defaultSeason={defaultSeason}
            months={seasonMonths}
            density={density}
            today={todayIso()}
            open={openPanel === "range"}
            onToggle={() => toggle("range")}
            onClose={() => setOpenPanel(null)}
            onChange={(range) => onChange({ ...controls, range })}
          />

          <FilterRow
            controls={controls}
            filters={filters}
            leagues={leagues}
            open={openPanel === "filters"}
            onToggle={() => toggle("filters")}
            onChange={onChange}
          />

          <SteepnessSlider
            value={steepness}
            onPreview={setDragging}
            onCommit={(next) => {
              setDragging(null);
              // A release that didn't move it is not a change: committing it
              // anyway would hand the store a fresh object and re-render the
              // tab behind for nothing.
              if (next !== controls.steepness) {
                onChange({ ...controls, steepness: next });
              }
            }}
          />
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
              {/* Sticky, because the board is the one part of the drawer that scrolls and
                  a column of bare numbers three hundred rows down says nothing. It
                  paints the panel's own ground rather than a translucent one — the
                  rows have to pass *behind* it, not through it. */}
              <div className={`sticky top-0 z-10 -mx-1 mb-1.5 grid ${BOARD_COLUMNS} items-center gap-2 bg-[rgb(12,23,33)] px-2 pb-1.5 pt-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35`}>
                <span className="text-right">#</span>
                <span>Player</span>
                <span />
                <span className="text-right">ADP</span>
                {/* "Taken" is a share, and the header is the only place to say of
                    what — a column reading 46% next to an ADP of 3.2 is otherwise
                    a number nobody can name. */}
                <span
                  className="text-right"
                  title="Share of this board’s drafts the player was taken in"
                >
                  Taken
                </span>
                <span
                  className="text-right"
                  title={`Draft capital under the value curve above, on a ${previewAdpPool(controls.teams)}-slot startable pool — the shape a league card's team value is summed from`}
                >
                  Value
                </span>
              </div>
              <ul>
                {players.map((player) => {
                  const value = previewAdpValue(player.adp, controls.teams, steepness);
                  return (
                    <li
                      key={player.player_id}
                      className={`grid ${BOARD_COLUMNS} items-center gap-2 border-t border-foreground/[0.04] px-1 py-1.5 text-sm`}
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
                      {/* The rail under the number is what makes the slider legible:
                          the shape of the whole column bends as the curve does, where
                          a row of digits only moves for the reader checking one. */}
                      <span className="relative text-right text-xs tabular-nums text-active/80">
                        {value.toLocaleString()}
                        <span
                          aria-hidden
                          className="absolute inset-x-0 -bottom-0.5 h-px bg-active/45"
                          style={{ transform: `scaleX(${value / ADP_PEAK})`, transformOrigin: "right" }}
                        />
                      </span>
                    </li>
                  );
                })}
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
            onClick={onReset}
            className="rounded-md border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm font-medium text-foreground/75 transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            Reset
          </button>
          {/* The value column has a premise the ADP beside it doesn't: this board
              belongs to no league, so the curve is anchored to an assumed pool.
              A number priced on an assumption says which one. */}
          <p className="min-w-0 flex-1 truncate text-xs text-foreground/35">
            This app’s crawled drafts, not market ADP · values on a{" "}
            {previewAdpPool(controls.teams)}-slot pool
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
 * The window control: one line at rest, the full scrubber floating over the
 * panel when it is opened.
 *
 * The strip and its three attendant rows — the calendar rail, the month axis and
 * the caption — were ~112px of a ~224px pinned block, half of it, sitting above
 * the board that is the reason the drawer opens at all. A window is chosen once
 * and then read, which is the same case the filter row already answers: state
 * what is set, put the control that sets it behind one press.
 *
 * Three things make that affordable rather than merely shorter:
 *
 *   - **The resting line keeps the strip's argument.** The scrubber replaced two
 *     date inputs because it says where the drafts *are* before you pick a
 *     window; behind a press it would say that only afterwards. So the trigger
 *     carries a {@link RangeSparkline} of the same bars over the same domain,
 *     and the answer is still on screen at rest.
 *   - **The panel floats; it does not push.** Expanding in place would shove the
 *     filters, the curve and the board down by more than the height this change
 *     just saved — the reader would be back where they started, one press later.
 *     It is a raised face over the pinned block's own ground, the material
 *     grammar the app bar and the league filters' floating rows already use.
 *   - **The presets stay outside it.** They fly the handles, but they are also
 *     the whole of what most readers want from this control, and drawing them in
 *     both places would be two controls for one selection. They sit on the
 *     resting line, so "last 30 days" is still the single press it was.
 */
function RangeControl({
  range,
  season,
  defaultSeason,
  months,
  density,
  today,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  range: AdpRange;
  season: string;
  defaultSeason: string;
  /** The density rows for this season — what the strip is drawn from. */
  months: DraftDensityMonth[];
  density: AdpDensityState;
  /** `YYYY-MM-DD`, resolving the relative presets. */
  today: string;
  /** The scrubber is up. */
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (range: AdpRange) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const presets = adpRangePresets(season, defaultSeason);
  const bounds = rangeBounds(range, today);
  // Only a board that can contain today gets an axis running to it.
  const live = season === "all" || season === defaultSeason;

  // Held in a ref for the reason the drawer holds `onClose` in one: the parent
  // passes a fresh arrow every render and re-renders on every pointer move of a
  // drag, so a listener keyed on its identity would be torn down and re-attached
  // once a frame for the whole of a gesture.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);

  // A press anywhere else dismisses it — the third of the three behaviours a
  // floating control owes (with Escape, handled by the drawer, and one open at a
  // time, handled by its `openPanel`). Containment covers the trigger too, so a
  // press on it toggles rather than closing and immediately reopening.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) latestClose.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Closing takes the focused element with it when the focus was inside the
  // panel, which drops the reader on `body` with no way back into the drawer by
  // keyboard. The trigger is where they were.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) {
      trigger.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      {/* It wraps rather than compressing, and the wrap is decided by the
          trigger's own min-content width: every part of it below is `shrink-0`
          except the sparkline, so the line breaks exactly when the words stop
          fitting and never truncates the one thing on it that answers the
          question. A phone, and a desktop showing a spelled-out custom window,
          put the presets on a second 18px line. */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          One key holding everything the line says, the shape `AdpTrigger` already
          has: the label, the board it resolves to, and a picture of it. It never
          takes `.lab-chip-on` — a window is always chosen, so tinting it would
          spend the drawer's one "something is narrowed" signal on a constant,
          and the lit preset chip beside it already carries that where it means
          something.
        */}
        <button
          ref={trigger}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="lab-chip lab-chip-sm flex flex-1 items-center gap-2 rounded-full py-[3px] pl-2.5 pr-2 text-left"
        >
          <span className="shrink-0 text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-foreground/40">
            Window
          </span>
          {/* The board's name and nothing else. The dates behind a preset's name
              are `rangeSummary`'s job and they belong *inside* the scrubber,
              where the handles are sitting on them — out here the name is exact
              and stays true as time passes, which is the whole reason a preset
              keeps its name. */}
          <span className="shrink-0 whitespace-nowrap text-[0.7rem] font-semibold text-active">
            {boardLabel(range, season)}
          </span>
          {/* The elastic member, so the line fits a phone and a laptop without a
              breakpoint: everything else on it is content-sized. */}
          <RangeSparkline
            months={months}
            live={live}
            today={today}
            bounds={bounds}
            className="h-4 min-w-[2.25rem] flex-1"
          />
          <span aria-hidden className="shrink-0 text-[0.6rem] text-foreground/40">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* A finished season leaves one preset, and a row of one is no choice at
            all — the strip and its calendar markers are the control there, which
            is what they were for. */}
        {presets.length > 1 && (
          <span className="flex shrink-0 items-center gap-1">
            {presets.map((preset) => (
              <KeyChip
                key={preset.value}
                small
                on={range.preset === preset.value}
                onClick={() => onChange({ preset: preset.value, from: null, to: null })}
              >
                {preset.chip}
              </KeyChip>
            ))}
          </span>
        )}
      </div>

      {open && (
        // Raised over the pinned block rather than expanding it. It keeps the
        // panel's own ground rather than a lighter one, because the scrubber
        // paints its scrim, its bubble and its draft flag in that exact colour —
        // a lifted face here would leave four hardcoded surfaces a shade adrift.
        // `z-30` clears the board's sticky headings (`z-10`) below it.
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-lg border border-active/20 bg-[rgb(12,23,33)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_20px_44px_rgba(0,0,0,0.6)]">
          <RangeScrubber
            range={range}
            season={season}
            bounds={bounds}
            months={months}
            live={live}
            error={density.error}
            loading={density.loading}
            today={today}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The value curve, as one continuous control.
 *
 * It was three segments — Flat, Balanced, Top-heavy — which is three points on a
 * scale that is continuous underneath: the knob is how many times value halves
 * across a league's startable pool, and there was never anything special about
 * 3, 4 and 5. A slider says that, and the board below re-prices as it moves, so
 * the curve is chosen by watching what it does rather than by reading three
 * adjectives. The ends keep the adjectives as the axis labels, which is the job
 * they were always doing.
 *
 * **Dragging previews; releasing commits.** Every committed value re-fetches the
 * team value of every league on the tab behind this drawer, so a drag across the
 * range would fire two dozen of those. `onPreview` runs per notch (the board
 * below is local and free), `onCommit` runs on release — pointer, key or focus
 * leaving, since a slider is as often nudged with the arrow keys as dragged.
 */
function SteepnessSlider({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  // The release events carry no value of their own, so it is read back off the
  // input — which is controlled, so what it holds is what was last previewed.
  const commit = (e: { currentTarget: HTMLInputElement }) =>
    onCommit(Number(e.currentTarget.value));

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/40">
        Curve
      </span>
      <span aria-hidden className="text-[0.6rem] text-foreground/25">
        Flat
      </span>
      <input
        type="range"
        className="lab-slider min-w-0 flex-1"
        min={STEEPNESS_RANGE.min}
        max={STEEPNESS_RANGE.max}
        step={STEEPNESS_RANGE.step}
        value={value}
        aria-label="Value curve steepness"
        aria-valuetext={steepnessSummary(value)}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span aria-hidden className="text-[0.6rem] text-foreground/25">
        Top-heavy
      </span>
      {/* The halving count is the honest parameter and an unreadable label, so
          the readout says what it does to a board instead. */}
      <span className="shrink-0 text-[0.62rem] tabular-nums text-foreground/40">
        {steepnessSummary(value)}
      </span>
    </div>
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
  className = "",
}: {
  value: T | "";
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Shown as a disabled first option — for a chip that acts rather than selects. */
  placeholder?: string;
  narrowed?: boolean;
  /** Layout from the caller — this component owns the chip, not where it sits. */
  className?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as T)}
      className={`max-w-[12rem] truncate rounded-full border px-2.5 py-1 text-xs transition-colors [color-scheme:dark] focus:outline-none ${className} ${
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

/**
 * A raised key, in the app bar's own material grammar (`.lab-chip`) rather than
 * the flat bordered `Segment` this replaced.
 *
 * The whole drawer is now keys instead of segments — the season, the window
 * presets, the filter tray's trigger — and that is the point: a part you press
 * should look pressable everywhere, and the drawer was the one place in the app
 * still drawing its own outlined buttons. `.lab-chip-on` is the lit state, the
 * same one the filter triggers wear when they are narrowing something.
 *
 * `small` is `.lab-chip-sm`, the half-thickness spelling — worn by the window
 * presets, which sit on the strip's caption where full-thickness keys would
 * outweigh the dates they are next to.
 */
function KeyChip({
  on,
  small = false,
  onClick,
  children,
}: {
  on: boolean;
  small?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`lab-chip rounded-full font-semibold transition-colors ${
        small ? "lab-chip-sm px-2 py-[1px] text-[0.62rem]" : "px-2.5 py-[3px] text-[0.7rem]"
      } ${on ? "lab-chip-on" : "text-foreground/70"}`}
    >
      {children}
    </button>
  );
}

/**
 * The filters, showing only what is actually narrowing the board.
 *
 * All seven sat on screen permanently, wrapping to three rows on a laptop and
 * four on a phone — and six of the seven usually read "All", which is a control
 * spending a row to report that it is doing nothing. Closed, this is one key and
 * whatever is set; open, it is the full set. A filter that *is* narrowing stays
 * a live `<select>`, so changing one is the single press it always was — what
 * costs a second press is reaching for a filter that was off, which is the case
 * where the drawer was previously spending the height.
 *
 * The open tray holds **every** filter rather than only the unset ones, so the
 * set doesn't reshuffle as it is used; the summary chips step aside while it is
 * up, since two controls for one filter is a worse answer than either.
 */
function FilterRow({
  controls,
  filters,
  leagues,
  open,
  onToggle,
  onChange,
}: {
  controls: AdpControls;
  filters: readonly FilterSpec[];
  leagues: readonly ManagerLeague[];
  open: boolean;
  onToggle: () => void;
  onChange: (controls: AdpControls) => void;
}) {
  const narrowing = filters.filter((f) => f.get(controls) !== "all");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`lab-chip lab-chip-sm inline-flex items-center gap-1.5 rounded-full px-3 py-[3px] text-xs font-semibold transition-colors ${
            narrowing.length > 0 && !open ? "lab-chip-on" : "text-foreground/70"
          }`}
        >
          Filters
          {narrowing.length > 0 ? (
            <span
              className={`rounded-full px-1.5 text-[0.6rem] font-bold tabular-nums ${
                open ? "bg-active text-[#052029]" : "bg-[#052029]/25"
              }`}
            >
              {narrowing.length}
            </span>
          ) : (
            <span aria-hidden className="text-[0.6rem] text-foreground/40">
              {open ? "▴" : "▾"}
            </span>
          )}
        </button>

        {/* Open, the tray below holds these — two controls for one filter would
            be a worse answer than either of them alone. */}
        {!open &&
          narrowing.map((f) => (
            <ChipSelect
              key={f.key}
              value={f.get(controls)}
              options={f.options}
              ariaLabel={f.ariaLabel}
              narrowed
              onChange={(value) => onChange(f.set(controls, value))}
            />
          ))}

        {/* An action, not a selection: the value stays "" so it re-arms after use. */}
        <ChipSelect
          value=""
          placeholder="Match a league…"
          ariaLabel="Match one of this manager's leagues"
          // Right-aligned where the row has room to spare, and simply next in
          // line where it wraps — `ml-auto` on a wrapped item strands it alone
          // on its own line with a hole to its left.
          className="sm:ml-auto"
          options={leagues.map((league) => ({
            value: league.league_id,
            label: league.name,
          }))}
          onChange={(leagueId) => {
            const league = leagues.find((l) => l.league_id === leagueId);
            if (league) onChange(seedFromLeague(controls, league));
          }}
        />
      </div>

      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-foreground/[0.07] pt-2">
          {filters.map((f) => (
            <ChipSelect
              key={f.key}
              value={f.get(controls)}
              options={f.options}
              ariaLabel={f.ariaLabel}
              narrowed={f.get(controls) !== "all"}
              onChange={(value) => onChange(f.set(controls, value))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

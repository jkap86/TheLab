"use client";

import { Fragment } from "react";
import type { ManagerLeague } from "@/shared/contract";

import { CONSOLE_CHANNEL_METAL, CONSOLE_CHIP } from "../console-chrome";
import { WEEK_READINGS, type WeekReading } from "../league-subjects";

/**
 * The four week readings as controls: the tray a row's narrowing is picked in,
 * and the chip that says a closed tray left one behind.
 *
 * **A module of its own because two panels draw them**, which is the line
 * `CONSOLE_KEY`, `ManagerPlate` and `SharesDrawer` all moved on. They were the
 * week shares drawer's own until gametime's stat board merged that panel into
 * it: the board's rows carry the same four counts and the same four keys, and
 * a second spelling of a tray would be two panels whose keys stopped agreeing
 * about which dot is filled — invisible, because both would render.
 *
 * What the two callers differ on is the **surface**, and only that. The
 * drawer's rows are lit glass, where the board's bar is machined metal, so the
 * chip's ink and its type are the caller's to state — the arrangement
 * `LeagueFiltersDialog` already takes its trigger by, and for its reason. The
 * construction is not: the pip, the truncating name against the fixed tail,
 * and the ✕ key are one part however it is inked.
 */

/** The four counts a row carries, whatever else it carries beside them. */
export type WeekReadingCounts = {
  started: number;
  benched: number;
  oppStarted: number;
  oppBenched: number;
};

/** What each of the four keys says on its face — the side is the dot's job. */
const READING_LABEL: Record<WeekReading, string> = {
  start: "Start",
  bench: "Bench",
  "opp-start": "Start",
  "opp-bench": "Bench",
};

/**
 * And what each says on a chip, where there is no dot to carry the side and
 * the four have to tell themselves apart in words.
 *
 * Short rather than the column's own label, because a chip states a row's
 * whole narrowing on one line beside other controls: `start+opp start` is the
 * pair, where `Started + Opp start` is most of the strip.
 */
const READING_CHIP: Record<WeekReading, string> = {
  start: "start",
  bench: "bench",
  "opp-start": "opp start",
  "opp-bench": "opp bench",
};

/** And what it says to a reader who cannot see the dot. */
const READING_NAME: Record<WeekReading, string> = {
  start: "Narrow on my starters",
  bench: "Narrow on my bench",
  "opp-start": "Narrow on opposing starters",
  "opp-bench": "Narrow on opposing bench",
};

const READING_COUNT: Record<WeekReading, (counts: WeekReadingCounts) => number> = {
  start: (c) => c.started,
  bench: (c) => c.benched,
  "opp-start": (c) => c.oppStarted,
  "opp-bench": (c) => c.oppBenched,
};

/**
 * How many leagues a row's picked readings leave — the union, deduped.
 *
 * Deduped by league id, because two readings *can* name one league: a player
 * on the manager's bench in a league whose opponent also… cannot happen, but a
 * union counted by summing would be a number nothing else on screen agrees
 * with the day the data says otherwise.
 */
export function leaguesLeft(
  leagues: Record<WeekReading, readonly ManagerLeague[]>,
  picked: readonly WeekReading[],
): number {
  const ids = new Set<string>();
  for (const reading of picked) {
    for (const league of leagues[reading]) ids.add(league.league_id);
  }
  return ids.size;
}

/**
 * A row's tray: four keys in one channel.
 *
 * **The legends are `Start` and `Bench` twice, and that is what makes them
 * fit.** A filled dot is the manager's own side and a hollow one is the
 * opposing side — the fill semantics `OpponentsMark` already uses on the rack
 * key — and the groove between the pairs is the side boundary. Spelled out as
 * `My starters` / `Opp starters` the four are wider than the tray at either
 * panel's width; with the dot and the groove saying the side, they are one
 * line. What a reader who cannot see either gets is the whole sentence, on the
 * key's own accessible name.
 *
 * **Multi-select, so pressing a lit key clears it** — which is why there is no
 * Clear key in here. The chip beside the tray carries one, for the row.
 *
 * The count on each key is that reading's own league count for this player,
 * which is the same figure its cell above prints.
 */
export function ReadingKeys({
  counts,
  picked,
  onPress,
  layout = "line",
}: {
  counts: WeekReadingCounts;
  picked: readonly WeekReading[];
  onPress: (reading: WeekReading) => void;
  /**
   * `line` is one channel of four pill keys; `grid` is two columns of 44px
   * keys, for a pane a line of four does not survive.
   *
   * **44px is the app's touch floor and the line arm does not clear it**, which
   * is the whole of why there are two: a tray a thumb cannot hit is a control
   * that only works with a mouse. The grid arm also draws **no groove** — the
   * row break between the pairs is the side boundary, and a vertical cut
   * across a wrap is a stub hanging off the line above.
   */
  layout?: "line" | "grid";
}) {
  const grid = layout === "grid";
  return (
    <span
      className={
        grid
          ? `${CONSOLE_CHANNEL_METAL} mt-0.5 grid grid-cols-2 gap-1 rounded-xl p-1`
          : `${CONSOLE_CHANNEL_METAL} inline-flex flex-wrap items-center gap-1 p-1`
      }
    >
      {WEEK_READINGS.map((reading, i) => {
        const on = picked.includes(reading);
        const mine = reading === "start" || reading === "bench";
        return (
          <Fragment key={reading}>
            {/* The side boundary, cut once, between the pairs — and only on
                the line arm, where there is a line for it to cut. */}
            {i === 2 && !grid && (
              <span
                aria-hidden
                className="mx-[0.1875rem] w-px shrink-0 self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
              />
            )}
            <button
              type="button"
              aria-pressed={on}
              aria-label={READING_NAME[reading]}
              onClick={() => onPress(reading)}
              className={
                "inline-flex items-center gap-1.5 whitespace-nowrap border font-mono text-[length:var(--fs-10)] uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                (grid
                  ? "min-h-11 min-w-0 justify-center rounded-[10px] px-2 py-[0.3125rem] tracking-[0.12em] "
                  : "shrink-0 rounded-full px-2.5 py-[0.3125rem] tracking-[0.14em] ") +
                (on
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : "border-transparent text-foreground/62 hover:text-readout")
              }
            >
              <SideDot mine={mine} on={on} />
              {READING_LABEL[reading]} · {READING_COUNT[reading](counts)}
            </button>
          </Fragment>
        );
      })}
    </span>
  );
}

/** Filled for the manager's own side, hollow for the side facing them. */
function SideDot({ mine, on }: { mine: boolean; on: boolean }) {
  const ink = on ? "var(--accent)" : "currentColor";
  return (
    <svg viewBox="0 0 12 12" className="size-2 shrink-0" aria-hidden>
      {mine ? (
        <circle cx="6" cy="6" r="5" fill={ink} />
      ) : (
        <circle cx="6" cy="6" r="4.4" fill="none" stroke={ink} strokeWidth="1.6" />
      )}
    </svg>
  );
}

/**
 * One row's narrowing, named where the row is not.
 *
 * **A closed tray says nothing**, and the readings are picked inside one: a row
 * scrolled out of sight is still narrowing the grid behind the panel, and
 * without this the only thing saying so is a pip on a row nobody can see. It is
 * the argument `SubjectTokens` is written by, one grain in — that tray names
 * the *rows*, and this names what was picked inside them.
 */
export function NarrowingChip({
  name,
  readings,
  left,
  onClear,
  className = "py-1 pl-2.5 pr-[0.3125rem]",
  chrome = "text-[length:var(--fs-10)] tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)]",
}: {
  name: string;
  readings: readonly WeekReading[];
  left: number;
  onClear: () => void;
  /** The chip's own box, where a caller's is not the drawer's. */
  className?: string;
  /**
   * Its ink and its type, which belong to the surface rather than to the chip.
   *
   * The drawer's rows are lit glass and take the readout's ink; the board's bar
   * is a milled billet and takes `--billet-accent` over `--standing-engrave`.
   * A chip drawn in the readout's mint on metal would say the bar was a window.
   */
  chrome?: string;
}) {
  const tail = `${readings.map((r) => READING_CHIP[r]).join("+")} · ${left}`;
  return (
    <span
      className={`${CONSOLE_CHIP} inline-flex min-w-0 max-w-full items-center gap-[0.4375rem] rounded-full border border-active/45 shadow-[var(--chip-shadow),0_0_18px_-8px_var(--accent-glow)] ${className}`}
    >
      <span
        aria-hidden
        className="size-[0.4375rem] shrink-0 rounded-full bg-active shadow-[0_0_9px_var(--accent-glow)]"
      />
      {/* **The name truncates and the tail does not**, which is the right way
          round: the readings and the league count are the whole of what this
          chip adds, and the name is already on the row it came from. Left to
          truncate as one string it is the count that goes — the chip is wider
          than a 354px panel at a phone's width, and the panel clips. */}
      <span className={`flex min-w-0 items-baseline gap-1 font-mono uppercase ${chrome}`}>
        <span className="truncate">{name}</span>
        <span className="shrink-0 whitespace-nowrap">· {tail}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear the readings narrowing ${name}`}
        className="inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border border-foreground/12 bg-[image:var(--key-bg)] font-mono text-[length:var(--fs-9)] leading-none text-foreground/80 shadow-[var(--key-shadow)] transition-colors duration-150 hover:text-readout focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      >
        <span aria-hidden>✕</span>
      </button>
    </span>
  );
}

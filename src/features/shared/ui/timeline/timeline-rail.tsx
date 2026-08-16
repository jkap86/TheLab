"use client";

import type { PlayerSummary } from "@/shared/players";

import { formatInstantDate, formatInstantTime } from "../../format";
import {
  moveKindLabel,
  movedPlayerNames,
  type TimelineOrigin,
  type TimelineStop,
} from "../../timeline";

/**
 * Where in the league's history its host is reading, and how to move it.
 *
 * **The one control either host adds**, and it is a *position* rather than a
 * setting — which is what decides everything about how it is drawn. The trades
 * board's own seek key is the same idea one level out (a place in a chronological
 * list, pinned rather than filed with the filters), and the argument is the same:
 * a control a reader reaches for *while reading* has to be on screen while they
 * read. So this sits above the rosters it moves, and nothing about it is behind a
 * press.
 *
 * **It opens at "now" and every stop before it is in the past.** That is the
 * conservative half of the whole arrangement: a league opened from a card shows
 * exactly what it always did, and the history is a drag away. What the far end
 * *is* differs by host and is named by {@link TimelineOrigin} rather than decided
 * here — the trades sheet stops at the trade the reader pressed, the leagues card
 * runs to the oldest move on file.
 *
 * **Live, with no preview/commit split**, which is where it parts company with
 * the ADP drawer's steepness slider. That one commits on release because a
 * committed value re-fetches every league's team value, so a drag across the
 * range would fire two dozen requests; a stop here is arithmetic over a payload
 * the browser already holds (see `../../timeline`), so there is nothing to protect
 * a dragging finger from and watching the rosters change under it is the point.
 */
export function TimelineRail({
  stop,
  moves,
  origin,
  players,
  onChange,
}: {
  /** Where the rail is now — see {@link TimelineStop}. */
  stop: TimelineStop;
  /** How many moves the rail spans; the far end is the league before the oldest. */
  moves: number;
  /** What that far end is called — see {@link timelineOrigin}. */
  origin: TimelineOrigin;
  /** Names for the players a move touched, for the line under the date. */
  players: Readonly<Record<string, PlayerSummary>>;
  /** Move to a stop, counted back from now. */
  onChange: (back: number) => void;
}) {
  // The slider runs left-to-right in time, so its value is the *inverse* of the
  // stop: the far left is every move reversed. The state is a count back from now
  // rather than a slider position for the reason `../timeline` gives — the
  // payload arrives after the sheet opens, and "now" has to be expressible before
  // there is a rail to be at the end of.
  const position = moves - stop.back;
  const atNow = stop.back === 0;
  const atOrigin = stop.back >= moves;

  return (
    <div className="shrink-0 border-b border-foreground/10 px-3 py-2 sm:px-4">
      {/* Two rows rather than one, because at 390px a readout, a summary, two
          keys and a slider do not share a line — and the row that has to stay
          readable is the one saying *when* this is. The keys ride with the
          readout because both are about the position; the slider and its steps
          are the instrument that moves it. */}
      <div className="flex items-baseline gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          {/* The trade card's own instant grammar: the primary reading in a cut
              and the secondary engraved beside it, so the rail reads as the same
              instrument as the card the reader pressed to get here. */}
          <span className="lab-readout shrink-0 rounded px-1.5 py-px text-[0.71875rem] font-semibold leading-4 tabular-nums text-foreground/85">
            {atNow ? "Now" : formatInstantDate(stop.at)}
          </span>
          {!atNow && stop.at !== null && (
            <span className="lab-engraved shrink-0 text-[0.65625rem] font-semibold leading-4 tabular-nums text-foreground/70">
              {formatInstantTime(stop.at)}
            </span>
          )}
          {/* **Its own line below `sm`, inline from it**, which is one element
              wrapping rather than two spellings of the same sentence. Sharing the
              row with a date, a clock time and two keys left it ~60px on a phone
              — `after f…`, which is worse than not drawing it: the date says
              *when* and this is the only thing that says *what*, so it is the half
              that must not be the one to give. `basis-full` before `sm:basis-auto`
              rather than `sm:flex-1` alone, since Tailwind emits `basis-auto`
              after `flex-1` and the pair would resolve back to a shared line. */}
          <span className="min-w-0 flex-1 basis-full truncate text-[0.6875rem] text-foreground/45 sm:basis-auto">
            {stopSummary(stop, origin, players)}
          </span>
        </p>

        <span className="flex shrink-0 items-center gap-1">
          {/* Named ends. A bare slider can say where you are and not what either
              end *is*, and the far one is a reading worth a press rather than a
              full drag — a drag that is the whole width of a season's moves on
              the unanchored rail. Its wording is the payload's (see
              {@link timelineOrigin}) rather than this component's, so the key
              cannot promise a trade on a rail that has none. */}
          <EndKey
            label={origin.key}
            title={origin.title}
            on={atOrigin}
            onClick={() => onChange(moves)}
          />
          <EndKey
            label="Now"
            title="The league as it stands today"
            on={atNow}
            onClick={() => onChange(0)}
          />
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Back is *older*, so the leading key steps left along the rail — which
            is a step further into the past and therefore a larger `back`. */}
        <StepKey
          label="One move earlier"
          glyph="‹"
          disabled={atOrigin}
          onClick={() => onChange(stop.back + 1)}
        />
        <input
          type="range"
          className="lab-slider min-w-0 flex-1"
          min={0}
          max={moves}
          step={1}
          value={position}
          aria-label="Point in this league's history"
          // The stop's own words, so a screen reader hears "Jun 30, 2026 — waiver"
          // rather than a slider position that means nothing on its own.
          aria-valuetext={stopSummary(stop, origin, players)}
          onChange={(e) => onChange(moves - Number(e.target.value))}
        />
        <StepKey
          label="One move later"
          glyph="›"
          disabled={atNow}
          onClick={() => onChange(stop.back - 1)}
        />
      </div>
    </div>
  );
}

/**
 * What this stop is, in words.
 *
 * Three readings, because the three kinds of stop answer different questions. The
 * present needs no move to name it; the far end is named by what it comes
 * *before*, which is the one stop whose move is not part of it and the one reading
 * that differs between the two hosts; and everything between is named by the move
 * that produced it.
 */
function stopSummary(
  stop: TimelineStop,
  origin: TimelineOrigin,
  players: Readonly<Record<string, PlayerSummary>>,
): string {
  if (stop.kind === "now") return "as they stand today";
  if (stop.kind === "before") return origin.summary;

  const kind = moveKindLabel(stop.event?.type ?? null);
  const moved = movedPlayerNames(stop.event, players);
  return moved
    ? `after ${kind.toLowerCase()} · ${moved}`
    : `after ${kind.toLowerCase()}`;
}

/**
 * One end of the rail, as a key.
 *
 * Lit when the rail is standing on it, which is the app's own chip grammar —
 * `.lab-chip-on.lab-chip-sm` written as the intersection rather than as two
 * classes, since `.lab-chip-on` re-declares the wall `.lab-chip-sm` thinned and a
 * lit small chip would otherwise stand a pixel prouder than its neighbour.
 */
function EndKey({
  label,
  title,
  on,
  onClick,
}: {
  label: string;
  title: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`lab-chip lab-chip-sm rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide transition-colors ${
        on ? "lab-chip-on text-foreground/85" : "text-foreground/50 hover:text-active"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * One notch along the rail.
 *
 * A key rather than a bare arrow because it travels on press — the grammar that
 * separates a control from a label — and it is drawn flat when it can do nothing,
 * the rule the filters' quick-adds keep: a part that looks pressable and isn't is
 * worse than one that says so.
 */
function StepKey({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-6 shrink-0 place-items-center rounded-full text-xs leading-none transition-colors ${
        disabled
          ? "text-foreground/20"
          : "lab-chip lab-chip-sm text-foreground/55 hover:text-active"
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

"use client";

import type { PlayerSummary } from "@/shared/contract";

import { CONSOLE_READOUT, CONSOLE_TRACK } from "../../console-chrome";
import { formatInstantDate, formatInstantTime } from "../../format";
import { stopSummary, type TimelineStop } from "../../timeline";

/**
 * Where in the league's history the card is reading, and how to move it.
 *
 * **It is a *position* rather than a setting**, which decides everything about
 * how it is drawn: a control a reader reaches for *while reading* has to be on
 * screen while they read, so it sits above the rosters it moves and nothing
 * about it is behind a second press.
 *
 * **It opens at "now" and every stop before it is in the past.** That is the
 * conservative half of the whole arrangement: a card opened for the standings
 * shows exactly what it always did, and the history is a drag away.
 *
 * **Live, with no preview/commit split.** A stop is arithmetic over a payload
 * the browser already holds (see `../../timeline`), so there is nothing to
 * protect a dragging finger from and watching the rosters change under it is
 * the point.
 *
 * **One row, where TheLabX's rail is two**, and the difference is where the
 * moving line went. There the stop's own summary — `after waiver · Josh Allen`
 * — rides the rail beside the date; here it rides the caveat under the panes,
 * which is drawn only in the past and is the line already explaining how those
 * rosters are known. That leaves the rail with three fixed-width parts and lets
 * the seat above the panes be **the same height in every one of its four
 * states**, so pressing `History` on a card moves nothing under it. At a phone's
 * width the row wraps, which is the same thing every other control row on this
 * card does.
 *
 * The instrument grammar is the console's rather than the chip vocabulary the
 * original wears: the moment is a lit readout, the two ends are one lit key in
 * a track — the switch grammar `LineupLensKeys` uses, which shows its position
 * rather than offering two buttons — and the slider runs in a cut channel with
 * a meter's fill behind it.
 */
export function TimelineRail({
  stop,
  moves,
  players,
  onChange,
}: {
  /** Where the rail is now — see {@link TimelineStop}. */
  stop: TimelineStop;
  /** How many moves the rail spans; the far end is the league before the oldest. */
  moves: number;
  /** Names for the players a move touched, for the slider's own announcement. */
  players: Readonly<Record<string, PlayerSummary>>;
  /** Move to a stop, counted back from now. */
  onChange: (back: number) => void;
}) {
  // The slider runs left-to-right in time, so its value is the *inverse* of the
  // stop: the far left is every move reversed. The state is a count back from
  // now rather than a slider position for the reason `../../timeline` gives —
  // the payload arrives after the card opens, and "now" has to be expressible
  // before there is a rail to be at the end of.
  const position = moves - stop.back;
  const atNow = stop.back === 0;
  const atOrigin = stop.back >= moves;
  const fill = moves === 0 ? 100 : (position / moves) * 100;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
      {/* A labelled recess with the instrument inside it, which is the grammar
          the `Rank by` control one row down already wears — two labelled
          recesses stacked read as one rack, where a bare slider under a labelled
          menu reads as something that fell out of the card. The caption is also
          the only thing that says what the rail *is* once the `History` key it
          replaced is gone. */}
      <span className="flex min-w-[11rem] flex-1 items-center gap-2 rounded-full border border-foreground/8 py-1 pl-3.5 pr-2 shadow-[var(--track-shadow)]">
        <span
          aria-hidden
          className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45"
        >
          History
        </span>
        {/* Back is *older*, so the leading key steps left along the rail — a
            step further into the past and therefore a larger `back`. */}
        <StepKey
          label="One move earlier"
          glyph="‹"
          disabled={atOrigin}
          onClick={() => onChange(stop.back + 1)}
        />

        <span className="relative flex h-6 min-w-0 flex-1 items-center">
          {/* The channel and its fill are the card's own meter grammar, one
              grain down: a cut groove with a lit bar counting up to where the
              reader is standing. It is `aria-hidden` because the input over it
              carries the whole control's semantics. */}
          <span
            aria-hidden
            className="absolute inset-x-0 h-1.5 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
          >
            <span
              className="block h-1.5 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
              style={{ width: `${fill}%` }}
            />
          </span>
          <input
            type="range"
            className="lab-rail relative z-10 min-w-0 flex-1"
            min={0}
            max={moves}
            step={1}
            value={position}
            aria-label="Point in this league's history"
            // The stop's own words, so a screen reader hears "Jun 30, 2026 —
            // after waiver" rather than a slider position that means nothing on
            // its own. It is the one place the move's summary still rides the
            // rail, because a caveat two elements away is not what a reader
            // arrowing along this control is being read.
            aria-valuetext={stopSummary(stop, players)}
            onChange={(e) => onChange(moves - Number(e.target.value))}
          />
        </span>

        <StepKey
          label="One move later"
          glyph="›"
          disabled={atNow}
          onClick={() => onChange(stop.back - 1)}
        />
      </span>

      {/* The moment, as the reading it is. `Now` is a word rather than today's
          date, because the present is not a date a reader has scrubbed to. */}
      <span
        className={`${CONSOLE_READOUT} inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.625rem] px-3 py-1.5`}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
        <span className="relative font-mono text-[0.75rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
          {atNow ? "Now" : formatInstantDate(stop.at)}
        </span>
        {!atNow && stop.at !== null && (
          <span className="relative font-mono text-[0.625rem] tabular-nums text-readout-muted">
            {formatInstantTime(stop.at)}
          </span>
        )}
      </span>

      {/* Named ends. A bare slider can say where you are and not what either end
          *is*, and the far one is a reading worth a press rather than a full
          drag across a season of moves. Neither is lit in between, which is the
          honest position for a switch standing off its detents. */}
      <span
        role="group"
        aria-label="Rail ends"
        className={`${CONSOLE_TRACK} inline-flex shrink-0 gap-1 p-1`}
      >
        <EndKey
          label="Start"
          title="The league as it stood before the oldest move on file"
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
  );
}

/**
 * One end of the rail, as a key in the track.
 *
 * An unselected end is bare text *on the track*, not a second raised key: two
 * raised faces in one channel is a row of buttons, where one raised and the
 * other flush is a switch showing its position — the grammar `LineupLensKeys`
 * already uses on this card.
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
      className={`rounded-full border px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
        on
          ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
          : "border-transparent text-foreground/58 hover:text-readout"
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
 * separates a control from a label — and it is drawn flat when it can do
 * nothing, the rule the filters' quick-adds keep: a part that looks pressable
 * and isn't is worse than one that says so.
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
      className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs leading-none transition-[color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
        disabled
          ? "border-transparent text-foreground/20"
          : "border-foreground/10 bg-[image:var(--key-bg)] text-foreground/70 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)]"
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

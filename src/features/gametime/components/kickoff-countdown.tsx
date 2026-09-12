"use client";

import { Fragment } from "react";

import {
  CONSOLE_CARD_SHELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  kickoffTime,
  Scanlines,
} from "@/features/shared";

import { countdownBays, countdownParts, type CountdownBay } from "../helpers/connection";
import { useSecondClock } from "../hooks/use-second-clock";

/** What the bays read on the one render that has no clock yet — the server's and hydration's. */
const PLACEHOLDER: CountdownBay[] = [
  { key: "hours", label: "Hrs", value: "--" },
  { key: "minutes", label: "Min", value: "--" },
  { key: "seconds", label: "Sec", value: "--" },
];

/**
 * The page's hero while the week's games are still to come: a countdown to the
 * next kickoff, ticking every second.
 *
 * **It is an instrument rather than a sentence** — a metal housing tilted back
 * under a perspective, lit glass bays set into it on their own plane, and each
 * figure struck in the accent the way the lineup checker strikes its alerts
 * (`--countdown-face` clipped to the glyphs over `--countdown-depth`'s stepped
 * extrusion). A changed digit rolls in (`cd-tick`), keyed by its value so only
 * the digits that moved animate; the separators beat once a second, keyed by
 * the second so the beat is the tick rather than a timer beside it.
 *
 * **The depth rides `pointer-fine:`**, on the league card's own rule: the tilt
 * exists to be flattened by a hover, so on a coarse pointer it is a composited
 * plane with nothing to spend it on. The extrusion does not, because there is
 * one of this on the page rather than one per card. `lab-card-3d` clears the
 * tilt under reduced motion and `lab-anim` stops the roll, the beat and the
 * sheen, which is the whole of what moves.
 *
 * **It is not a live region.** The figures are `aria-hidden` under an `sr-only`
 * sentence naming the kickoff, which changes only when the kickoff does; the
 * pill beside the stepper still carries the page's announced status. A region
 * whose text changed every second would be read aloud every second.
 *
 * The time it counts to is `live-rules`' `nextKickoff` over the board — the
 * kickoff the room's own cadence is waiting on — so the two cannot disagree
 * about which game is next. See `gametimeReadout` for when it is drawn at all.
 */
export function KickoffCountdown({ at, className = "" }: { at: number; className?: string }) {
  const now = useSecondClock();
  // Undefined is "no clock yet"; null is "the clock has run out".
  const parts = now === null ? undefined : countdownParts(at - now);
  const when = kickoffTime(at);

  return (
    <section
      aria-label="Countdown to the next kickoff"
      className={`relative mb-8 [perspective:1600px] sm:mb-10 ${className}`}
    >
      <p className="sr-only">Next kickoff {when}</p>
      <div
        aria-hidden
        className={`${CONSOLE_CARD_SHELL} ${CONSOLE_METAL} lab-anim lab-card-3d rounded-[1.375rem] px-3.5 pb-4 pt-3.5 transition-transform duration-500 ease-out sm:px-7 sm:pb-6 sm:pt-5 pointer-fine:[transform-style:preserve-3d] pointer-fine:[transform:rotateX(9deg)] pointer-fine:hover:[transform:rotateX(0deg)_translateZ(12px)]`}
      >
        <Finish />

        <div className="relative mb-3 flex items-center justify-between gap-3 sm:mb-5 pointer-fine:[transform:translateZ(16px)]">
          <span className="flex items-center gap-2.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.2em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-11)]">
            <span className="size-2 shrink-0 rounded-full bg-readout shadow-[0_0_10px_var(--accent-glow)]" />
            {parts === null ? "Kickoff" : "Next kickoff"}
          </span>
          <span
            className={`${CONSOLE_WINDOW} rounded-full px-3 py-1 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] tabular-nums text-readout [text-shadow:var(--readout-text-glow)] sm:px-3.5 sm:py-1.5`}
          >
            <Scanlines />
            <span className="relative whitespace-nowrap">{when}</span>
          </span>
        </div>

        {parts === null ? (
          <KickingOff />
        ) : (
          <Bays bays={parts ? countdownBays(parts) : PLACEHOLDER} beat={now} />
        )}
      </div>
    </section>
  );
}

/**
 * The bays and the separators between them, over a row of labels.
 *
 * One grid, so a label sits under its own window and a separator lines up on
 * the windows' middle without either being measured. Two literal templates
 * rather than one built from the count, because Tailwind finds classes by
 * scanning source text and a template assembled from a number generates none.
 * The grid carries `preserve-3d` so the windows' `translateZ` reaches the
 * housing's projection — a plain wrapper is a flat context, and every plane
 * under it collapses with no error to say so.
 */
function Bays({ bays, beat }: { bays: CountdownBay[]; beat: number | null }) {
  const cols =
    bays.length === 4
      ? "grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]"
      : "grid-cols-[1fr_auto_1fr_auto_1fr]";
  return (
    <div
      className={`relative grid ${cols} items-center gap-x-1.5 gap-y-2 sm:gap-x-3 sm:gap-y-2.5 pointer-fine:[transform-style:preserve-3d]`}
    >
      {bays.map((bay, i) => (
        <Fragment key={bay.key}>
          {i > 0 && <Separator key={`beat-${beat ?? 0}`} />}
          <span
            className={`${CONSOLE_WINDOW} flex min-w-0 items-center justify-center rounded-xl py-2.5 sm:rounded-2xl sm:py-4 pointer-fine:[transform:translateZ(26px)]`}
          >
            <Scanlines />
            <span className="relative">
              <Digits value={bay.value} />
            </span>
          </span>
        </Fragment>
      ))}
      {bays.map((bay, i) => (
        <Fragment key={bay.key}>
          {i > 0 && <span />}
          <span className="text-center font-mono text-[length:var(--fs-9)] uppercase tracking-[0.22em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-10)] pointer-fine:[transform:translateZ(16px)]">
            {bay.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A two-digit figure, each digit its own clipped glyph so it can roll in on
 * its own when it changes.
 *
 * **The extrusion is on the pair and the face is on each digit.** A
 * `background-clip: text` gradient is painted per element, so a digit that
 * animates carries its own; the chained `drop-shadow`s are on the parent, which
 * composites both digits — mid-roll included — before casting them, so the
 * extrusion follows the glyph wherever it is. The colour is spelled as well as
 * the fill, on the lineup checker's `STRUCK_FIGURE` terms, so a browser that
 * ignores the clip still paints something.
 */
function Digits({ value }: { value: string }) {
  return (
    <span className="inline-flex font-display text-[length:clamp(2.125rem,10.5vw,5.75rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums [filter:var(--countdown-depth)]">
      {[...value].map((ch, i) => (
        <span
          key={`${i}:${ch}`}
          className="lab-anim inline-block animate-[cd-tick_380ms_cubic-bezier(0.2,0.8,0.2,1)] bg-[image:var(--countdown-face)] bg-clip-text text-transparent [-webkit-text-fill-color:transparent]"
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** Two lit dots that beat once a second — remounted by the parent's key on every tick. */
function Separator() {
  return (
    <span className="lab-anim flex flex-col items-center gap-2 animate-[cd-beat_1s_ease-out_forwards] sm:gap-3 pointer-fine:[transform:translateZ(20px)]">
      <span className="size-1.5 rounded-full bg-readout shadow-[0_0_10px_var(--accent-glow)] sm:size-2" />
      <span className="size-1.5 rounded-full bg-readout shadow-[0_0_10px_var(--accent-glow)] sm:size-2" />
    </span>
  );
}

/**
 * The clock has run out and the scoreboard has not flipped the game to live:
 * the ordinary state for the minute either side of a snap. See `countdownParts`.
 */
function KickingOff() {
  return (
    <div className="relative pointer-fine:[transform:translateZ(26px)]">
      <span className={`${CONSOLE_WINDOW} flex items-center justify-center rounded-2xl py-5 sm:py-7`}>
        <Scanlines />
        <span className="lab-anim relative inline-block animate-pulse bg-[image:var(--countdown-face)] bg-clip-text font-display text-[length:clamp(1.75rem,8vw,4.25rem)] font-semibold uppercase leading-none tracking-[0.04em] text-transparent [-webkit-text-fill-color:transparent] [filter:var(--countdown-depth)]">
          Kicking off
        </span>
      </span>
    </div>
  );
}

/**
 * The housing's decorative layers, in one wrapper that does the clipping.
 *
 * The housing itself cannot clip: `overflow: hidden` forces a flat rendering
 * context and every `translateZ` under it collapses — the tools page's own
 * finding. So the brushed grain, the specular, a graticule floor fading up from
 * the foot, the accent's bloom behind the bays, the edge light and a slow sheen
 * all live here, and the content stays a direct child.
 */
function Finish() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span className="absolute inset-0 bg-[image:var(--card-grain)]" />
      <span className="absolute inset-0 bg-[image:var(--card-specular)]" />
      <span className="absolute inset-x-0 bottom-0 h-3/5 bg-[image:var(--card-floor)] opacity-60 [mask-image:linear-gradient(to_top,black,transparent)]" />
      <span className="absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_62%,var(--accent-glow),transparent_70%)] opacity-50" />
      <span className="absolute inset-x-[12%] top-0 h-px bg-[image:var(--card-edge-light)]" />
      <span className="lab-anim absolute inset-y-0 -left-1/3 w-1/3 animate-[cd-sheen_7s_ease-in-out_infinite] bg-[image:var(--card-sheen)] opacity-70" />
    </span>
  );
}

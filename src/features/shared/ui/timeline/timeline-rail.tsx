"use client";

import type { PlayerSummary } from "@/shared/contract";

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
 * **One line, at every width, and the strip is the caller's.** It was three
 * fixed-width parts in a wrapping row — a labelled recess bay, a readout pill
 * for the moment and a two-key switch that took a line of its own below `sm`
 * — inside a 56px well: ~94px of a 390px card. The expanded-card pass made the
 * seat one 32px recess strip (30 on a phone) and this the parts *on* it, so the
 * rail is a fragment: the caption, two 22px step keys, a 6px channel with a
 * 14px key on it, a `--groove` hairline, the moment as a bare lit figure, and
 * the two end keys inline. The strip's own geometry is `TimelineView`'s, since
 * the seat has to be the same height in all five of its states and only the
 * caller knows the other four.
 *
 * **The phone drops the separate moment readout**, and that is a width rather
 * than a taste: at 360px of content box there is no line for it. The lit `Now`
 * end key doubles as the moment — it is the same key, and at rest it already
 * says `Now`. Scrubbed back, that key's own legend prints the stop's date, so
 * the moment becomes the right-hand key's legend rather than a fourth part.
 * Nothing about the announcement changes: `aria-valuetext` on the slider still
 * carries the stop's own words, at every width.
 *
 * TheLabX's rail is two rows of chips with the stop's summary riding the rail
 * beside the date; here the summary rides the caveat under the panes, which is
 * drawn only in the past and is the line already explaining how those rosters
 * are known. The instrument grammar is the console's: the moment is lit readout
 * ink, the two ends are one lit key in a track — the switch grammar
 * `LineupLensKeys` uses, which shows its position rather than offering two
 * buttons — and the slider runs in a cut channel with a meter's fill behind it.
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
  const moment = atNow ? "Now" : formatInstantDate(stop.at);

  return (
    <>
      {/* **`Hist` at a phone's width**, which is the caption's own version of
          the rule the theme key's legend keeps: the two step keys, the channel
          and the thumb are what a reader actually grips, so the word is the
          part that gives. It is `aria-hidden` either way — the slider carries
          the control's whole name. */}
      <span
        aria-hidden
        className="shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/62 sm:text-[length:var(--fs-11)]"
      >
        <span className="sm:hidden">Hist</span>
        <span className="hidden sm:inline">History</span>
      </span>

      {/* Back is *older*, so the leading key steps left along the rail — a
          step further into the past and therefore a larger `back`. */}
      <StepKey
        label="One move earlier"
        glyph="‹"
        disabled={atOrigin}
        onClick={() => onChange(stop.back + 1)}
      />

      {/* `h-6` is `.lab-rail`'s own box — the input is 24px tall with a 14px
          key centred in it by that rule's arithmetic — and the 6px channel is
          centred in the same box by `items-center`, so the key rides the
          groove. A 24px control in a 32px strip is what leaves the strip its
          4px of recess either side. */}
      <span className="relative flex h-6 min-w-0 flex-1 items-center">
        {/* The channel and its fill are the card's own meter grammar, one
            grain down: a cut groove with a lit bar counting up to where the
            reader is standing. It is `aria-hidden` because the input over it
            carries the whole control's semantics.

            **Deeper than a meter's, because a thumb rides it.** A rank tile's
            bar is a hairline drawn on glass and this is a groove a key sits
            *in* — `--rail-channel-shadow` is the cut and `--lit-bar-bg` the
            bar, the same lit stock the manager's own row is marked with, so
            "this is where you are" is one colour on this card rather than
            two. */}
        <span
          aria-hidden
          className="absolute inset-x-0 h-1.5 rounded-full bg-[var(--meter-track)] shadow-[var(--rail-channel-shadow)]"
        >
          <span
            className="block h-1.5 rounded-full bg-[image:var(--lit-bar-bg)] shadow-[var(--lit-bar-shadow)]"
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

      {/* The cut between the scrubber and the reading it produces — the same
          `--groove` every plate divider on the card is cut with. */}
      <span
        aria-hidden
        className="h-3.5 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
      />

      {/* The moment, as the reading it is: lit readout ink on the strip, with
          no pill around it — the strip is already the recess. `Now` is a word
          rather than today's date, because the present is not a date anybody
          scrubbed to. Hidden below `sm`, where the `Now` key carries it. */}
      <span className="hidden shrink-0 items-baseline gap-1.5 sm:inline-flex">
        <span className="font-mono text-[length:var(--fs-14)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
          {moment}
        </span>
        {!atNow && stop.at !== null && (
          <span className="font-mono text-[length:var(--fs-10)] tabular-nums text-readout-muted">
            {formatInstantTime(stop.at)}
          </span>
        )}
      </span>

      {/* Named ends. A bare slider can say where you are and not what either end
          *is*, and the far one is a reading worth a press rather than a full
          drag across a season of moves. Neither is lit in between, which is the
          honest position for a switch standing off its detents.

          **The track is drawn from `sm` up and not below it**: on a phone the
          two keys sit bare on the strip, because a recess drawn inside the
          strip's own recess is two cuts where the design has one, and the
          strip is 30px tall with nothing to spare for a second wall. */}
      <span
        role="group"
        aria-label="Rail ends"
        className="inline-flex shrink-0 gap-[3px] rounded-full sm:bg-[color:var(--recess-bg)] sm:p-[3px] sm:shadow-[var(--track-shadow)]"
      >
        <EndKey
          title="The league as it stood before the oldest move on file"
          on={atOrigin}
          onClick={() => onChange(moves)}
        >
          Start
        </EndKey>
        <EndKey
          title="The league as it stands today"
          on={atNow}
          onClick={() => onChange(0)}
        >
          {/* The phone's moment — see the module note. Two spans switched by
              the cascade rather than by state, so the key needs no hydration
              to learn a breakpoint. */}
          <span className="sm:hidden">{moment}</span>
          <span className="hidden sm:inline">Now</span>
        </EndKey>
      </span>
    </>
  );
}

/**
 * One end of the rail, as a key in the track.
 *
 * An unselected end is bare text *on the track*, not a second raised key: two
 * raised faces in one channel is a row of buttons, where one raised and the
 * other flush is a switch showing its position — the grammar `LineupLensKeys`
 * already uses on this card.
 *
 * `tabular-nums` because the right key prints a date on a phone, and a date
 * that reflowed as the reader scrubbed would move the key under their thumb.
 */
function EndKey({
  title,
  on,
  onClick,
  children,
}: {
  title: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-1.5 py-[2px] text-center font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] tabular-nums transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:px-[11px] sm:text-[length:var(--fs-11)] sm:tracking-[0.16em] ${
        on
          ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
          : "border-transparent text-foreground/58 hover:text-readout"
      }`}
    >
      {children}
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
 *
 * 22px, which is under the 44px a touch target is owed and is accepted for the
 * reason the rack's 32px caps are: the strip is 30px tall on a phone and a key
 * taller than its strip is a different part. The slider beside them is the
 * control a thumb actually uses; the keys are the keyboard's.
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
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border text-[length:var(--fs-13)] leading-none transition-[color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
        disabled
          ? "border-transparent text-foreground/24"
          : "border-foreground/12 bg-[image:var(--key-bg)] text-foreground/78 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)]"
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

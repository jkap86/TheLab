import { MilledHairline, Scanlines } from "@/features/shared";
import type { ManagerLeague } from "@/shared/contract";

import {
  formatCombinedRecord,
  formatWinShare,
  seasonSummary,
} from "../helpers/season-summary";

/**
 * The season's figures, milled into the identity billet: two stamped counts in
 * one well, and a mounted gauge.
 *
 * **It used to be a housing of its own** — a two-row ledger beside a 112px dial,
 * standing next to the plate on the header row. The merge is the header pass:
 * the manager's name and how their season is going are one statement about one
 * person, and four instruments on one row were four boxes saying it. So this is
 * no longer a surface; it is the right-hand half of `ManagerBillet`'s face,
 * mounted through that component's `children` seam.
 *
 * The split inside it survives every pass, because it was never about the
 * boxes. Leagues and the combined record are *counts* — they are stamped
 * figures under etched labels, and the eye compares them to nothing, so they
 * share one well and a cut between them. The win rate is a *proportion*, so it
 * keeps the instrument: a dial whose arc is the number, with the figure
 * repeated in a lit window at the centre because an arc alone cannot be read to
 * three decimals.
 *
 * **The dial is the hero now, and the two decisions that makes are both
 * content.** It is 108px on its own bezel rather than 88px on the plate's
 * face — a mounted gauge, with the cast under it that says bolted-on rather
 * than printed — and it reads a three-decimal *share*: `.583`, the unit a
 * season's record is quoted in, where the plate read `58.0%`. See
 * {@link formatWinShare}, which takes the same `summary.winPct` the arc does,
 * so the two cannot disagree.
 *
 * **The `WIN` caption inside the window is gone with it.** It was a second copy
 * of the label beside the dial, and with the dial this size the label outside
 * it is legible on its own. What that costs is the figure's accessible name, so
 * the pair is a `<dl>`: the caption is the `<dt>` and the mount holding the
 * figure is the `<dd>`, which is the reading — a name and its value — rather
 * than an `aria-label` on a `<span>` that has no role to carry one.
 *
 * Everything here is taken over the **filtered** list — see {@link seasonSummary},
 * which reverses what it used to say, and {@link SeasonSummary.total} for the
 * one figure that is not.
 *
 * **Below `lg` this block is the billet's second row; from `lg` up it has no
 * box at all.** That is the reverse of what it used to be, and it is the
 * design's compact arm rather than a refactor: narrow, the win well and the
 * counts well sit side by side under a milled cut; wide, the counts, a hairline
 * and the bare gauge are three items of the billet's own single row.
 * `lg:contents` is what dissolves the wrapper at the breakpoint, so every
 * `order-*` here is the compact arrangement and every `lg:order-none` hands the
 * row back to DOM order — which is the wide order, read left to right. See
 * `ManagerBillet` for why the turn is `lg` and not the `sm` the design names.
 *
 * The dial steps 84px → 108px at `lg` and **every inset steps with it**, which
 * is a chain rather than a set of independent numbers: the arc, the pointer and
 * the lit window are all measured from the bezel's own edge, and the innermost
 * of them is what the figure has to fit inside. So the figure's own size is on
 * the same breakpoint as the mount, and moving one without the others is how a
 * reading ends up clipped by a circle that still looks big enough for it.
 */
export function SeasonSummary({
  leagues,
  total,
  narrowing,
}: {
  /** The list as the reader has narrowed it — what every figure is taken over. */
  leagues: readonly ManagerLeague[];
  /** Every league on the account, for the denominator below. */
  total: number;
  /** Whether any narrowing is in force — see the Leagues field. */
  narrowing: boolean;
}) {
  const summary = seasonSummary(leagues);
  const share = formatWinShare(summary);
  // The dial's arc. Null (no league has a record yet) draws an empty track
  // rather than a zero-length arc at the top, which would read as .000.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;

  return (
    // Below `sm`: the billet's second row, carrying its own milled cut above it
    // — a dark hairline with the light catching its upper lip, which is the
    // horizontal reading of the vertical cuts between the desktop row's items.
    //
    // From `sm`: `display: contents`, so the three items below become items of
    // the billet's row and can be ordered among the name and the keys that
    // share it. An element with `display: contents` generates no box, so the
    // border, the padding and the width above it need no reset — they simply
    // stop applying.
    <div className="relative order-4 flex w-full items-stretch gap-2 border-t border-[color:var(--milled-hairline)] pt-2 shadow-[0_-1px_0_rgba(255,255,255,0.06)] lg:order-none lg:contents">
      {/*
        **The denominator appears exactly when it means something.** Unfiltered,
        the figure is one number and reads as the account. Narrowed, `9 / 14` is
        what stops "Leagues 9" from claiming to be the whole account to anyone
        who did not set the filter — which is the readout the View housing used
        to carry and the reason the header had to take it over when that housing
        moved into the rack.

        The well stretches on the phone's row, where it is one of two parts
        sharing a line, and hugs its content on the desktop's, where the name
        column beside it is what takes the slack. It is `order-2` because the
        gauge leads on a phone: the hero is the first thing on the row it is the
        subject of, and on the desktop row DOM order puts the counts first
        because the gauge is what the row builds up to.
      */}
      <div className="relative order-2 flex min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-3 py-2 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-none lg:gap-1 lg:px-3.5 lg:py-[0.4375rem]">
        <Count label="Leagues">
          {narrowing ? `${summary.leagues} / ${total}` : String(total)}
        </Count>
        {/* The cut between the two counts: the same milled line the row's
            vertical hairlines are, turned on its side. It is drawn here rather
            than by {@link Count} because it belongs between two of them. */}
        <span
          aria-hidden
          className="h-px bg-[color:var(--milled-hairline)] shadow-[0_1px_0_rgba(255,255,255,0.07)]"
        />
        <Count label="Record">{formatCombinedRecord(summary)}</Count>
      </div>

      {/* Gone below `sm`, where the two wells are on their own row with a gap
          between them: a vertical cut is what separates two things standing
          side by side on one part's face, and the gap is the separation there. */}
      <MilledHairline className="relative hidden lg:block" />

      {/*
        The gauge. A `<dl>` because it is one name and one value — see the
        module note on what the dropped `WIN` caption cost.

        `flex-col-reverse` below `sm` is what puts the caption *under* the dial
        while leaving the `<dt>` first in the DOM, so the label still reads as
        the figure's name. From `sm` the caption is beside it, the well is
        dissolved and the mount sits directly on the billet's own face — four
        overrides for one element rather than a second copy of the dial.
      */}
      <dl className="relative order-1 m-0 flex shrink-0 flex-col-reverse items-center gap-1 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-[0.4375rem] py-1.5 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-row lg:gap-3.5 lg:rounded-none lg:bg-none lg:p-0 lg:shadow-none">
        <dt className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-10)] sm:tracking-[0.14em]">
          Win rate
        </dt>
        {/* The mount. Its second cast is what makes a gauge this size read as
            bolted onto the face rather than printed on it, and its colour is
            `--surface-shadow` rather than a literal black: a black cast smears
            on the light scheme's pale ground, which is the rule every other
            cast in `globals.css` is written by. */}
        <dd className="relative m-0 size-21 shrink-0 rounded-full border border-foreground/12 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow),0_10px_18px_-10px_var(--surface-shadow)] lg:size-27 lg:shadow-[var(--bezel-shadow),0_12px_22px_-12px_var(--surface-shadow)]">
          {/* The arc itself. A conic gradient rather than an SVG ring: the
              angle is the only thing that varies, and it varies per render. */}
          <span
            aria-hidden
            className="absolute inset-1.5 rounded-full shadow-[inset_0_0_14px_rgba(0,0,0,0.95)] lg:inset-2"
            style={{
              background: `conic-gradient(var(--accent) 0deg ${degrees}deg, var(--dial-track) ${degrees}deg 360deg)`,
            }}
          />
          {/* The pointer, parked at the end of the arc. Rotating a wrapper and
              pinning the dot to its top edge keeps the maths to one angle. */}
          {summary.winPct !== null && (
            <span
              aria-hidden
              className="absolute inset-1.5 rounded-full lg:inset-2"
              style={{ transform: `rotate(${degrees}deg)` }}
            >
              <span className="absolute -top-1 left-1/2 -ml-1 size-2 rounded-full bg-readout shadow-[0_0_12px_var(--accent-glow)] lg:-top-[0.28125rem] lg:-ml-[0.28125rem] lg:size-2.5 lg:shadow-[0_0_14px_var(--accent-glow)]" />
            </span>
          )}
          {/* The lit window at the centre, so the arc can be read exactly. */}
          <div className="absolute inset-[0.6875rem] flex items-center justify-center overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--readout-shadow)] lg:inset-3.5">
            <Scanlines />
            {/*
              **The circle is what sizes this figure, not the window's width.**
              The window is round, so a line of digits crossing it below its
              centre sits on a chord of `2·√(r² − offset²)` — which is why the
              plate's own dial needed two step-downs for a `50.0%` that looked
              like it fitted. Here the figure is the only thing in the window
              and therefore centred, where the chord is longest, and the reading
              is at most five characters: `1.000`, a small account that has won
              every game, is what both sizes have to clear. Measured, they do —
              but if the type or the inset moves, re-measure against the chord
              rather than nudging pixels.
            */}
            <span className="relative font-display text-[length:var(--fs-17)] font-semibold leading-none tracking-[-0.02em] tabular-nums text-readout [text-shadow:var(--figure-engrave),0_0_20px_var(--accent-glow)] lg:text-[length:var(--fs-21)] lg:[text-shadow:var(--figure-engrave),0_0_22px_var(--accent-glow)]">
              {share}
            </span>
          </div>
        </dd>
      </dl>
    </div>
  );
}

/**
 * One count: a stamped label and its figure, on one baseline in the well they
 * share.
 *
 * A `<dl>` per count rather than one list holding both, because the cut between
 * them is not list content: a definition list may hold only `dt`, `dd` and the
 * `div`s grouping them. One name and one value is exactly what a `<dl>` is for,
 * so two of them is the reading that keeps the semantics without wrapping a
 * milled hairline in a group it does not belong to.
 */
function Count({ label, children }: { label: string; children: string }) {
  return (
    <dl className="m-0 flex items-baseline justify-between gap-3 lg:gap-4">
      <dt className="whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
        {label}
      </dt>
      {/* `nowrap`: the en dash in `8–5` is a line-break opportunity, and a
          record split across two lines reads as two numbers. */}
      <dd className="m-0 whitespace-nowrap font-display text-[length:var(--fs-21)] font-semibold leading-[1.1] tracking-[-0.015em] tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
        {children}
      </dd>
    </dl>
  );
}

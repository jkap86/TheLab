import { MilledHairline, Scanlines, StampedCount } from "@/features/shared";

import {
  formatProjectedRecord,
  formatProjectedWinPct,
  type WeekSummary as Summary,
} from "../helpers/week-summary";

/**
 * The week's figures, milled into the identity billet: two stamped counts in
 * one well — the projected record and how many lineups want a press — and a
 * mounted gauge for the win rate the record implies.
 *
 * `features/manager/components/season-summary.tsx` with a week's numbers in it,
 * and deliberately the same object: the same well, the same {@link StampedCount},
 * the same milled cut, the same 108px gauge on its own bezel with the figure in
 * a lit window at its centre. A reader walking from `/manager` to here is
 * looking at one console, and a second dial drawn to hold a proportion would be
 * a second chance for one of them to stop matching. Until this landed the two
 * headers were two objects — that one a billet, this one a recessed plate with
 * the figures engraved in chrome — which is exactly the drift this file's
 * predecessor said it existed to prevent.
 *
 * **`Need a look` moved into the well, and that is the one content change.** It
 * was the headline of a lit glass window at the row's end, with the four
 * reasons stacked under it; it is a stamped count beside the record now, and
 * the reasons are a strip of their own under the row — see `AttentionStrip`.
 * The window did not fit: with a 108px gauge, the counts well, the keys and a
 * name column that must not truncate, a `min-w-[12.5rem]` window does not fit a
 * 1092px content box. The rules it carried survive whole. It is `—` until the
 * check lands (a zero would read as "all clear" for the length of a round
 * trip), it is `--error` above zero and the billet's own figure ink at zero,
 * the `aria-live` that announces the answer rides the figure, and its
 * denominator is the leagues *on screen* the check answered for. The spelling
 * is `3 / 12` rather than `3 of 12` because it stands in a well of ratios now,
 * and the `title` carries the sentence.
 *
 * Three things changed on the dial against the 88px one this replaces:
 *
 * - **The `WIN` caption inside the window is gone.** It was a second copy of
 *   the label beside the dial, and at this size the label outside is legible
 *   on its own. What that costs is the figure's accessible name, so the pair is
 *   a `<dl>`: `Proj win` is the `<dt>` and the mount is the `<dd>`.
 * - **The gauge reads a percentage, `66.7%`, and not the share `/manager`
 *   reads.** That is the page's own unit — a week's projection is quoted as a
 *   percentage where a season's record is quoted as a share — unchanged by the
 *   surface it is drawn on. The handoff leaves this open and defaults to the
 *   percentage; `formatWinShare` one folder over is the other answer, and it
 *   is one import if matching `/manager` digit for digit matters more.
 * - **The six-character step-down stays, one size up.** `100.0%` — what a
 *   small account projects when every league is a win — is the reading that
 *   clips, and a window is a *circle*: a line of digits crossing it sits on a
 *   chord of `2·√(r² − offset²)`, not on the diameter. Measured, the 108px
 *   window's chord at the figure's own height is ~74px and `100.0%` at
 *   `--fs-21` is ~83; at `--fs-17` it is ~68. The 84px window is the same sum
 *   one size down. Every five-character reading keeps the design's own size.
 *   `SeasonSummary` needs no step because a share is five characters at most.
 *
 * **Leagues with no opponent are already gone** — `weekSummary` drops them
 * rather than counting a future week as a loss — so a week with nothing
 * projected draws an empty track and an em dash, never `0.0%`.
 *
 * **Below `lg` this block is the billet's second row; from `lg` up it has no
 * box at all.** `SeasonSummary`'s arrangement, to the class: narrow, the gauge
 * in its own well beside the counts well under a milled cut; wide, the counts,
 * a hairline and the bare gauge as three items of the billet's own row.
 * `lg:contents` dissolves the wrapper, so every `order-*` here is the compact
 * arrangement and every `lg:order-none` hands the row back to DOM order. See
 * `ManagerBillet` for why the turn is `lg`, and that component's own
 * measurement — this header carries *more* than `/manager`'s, so the same
 * conclusion holds harder.
 */
export function WeekSummary({
  summary,
  attention,
  of,
  pending,
}: {
  summary: Summary;
  /** How many of the leagues on screen want a press — over leagues, not reasons. */
  attention: number;
  /** The leagues on screen the check answered for. */
  of: number;
  /** True until the check lands. */
  pending: boolean;
}) {
  // The dial's arc. Null (nothing projected) draws an empty track rather than a
  // zero-length arc at the top, which would read as 0%.
  const degrees = summary.winPct === null ? 0 : (summary.winPct / 100) * 360;
  const pct = formatProjectedWinPct(summary);
  const lit = !pending && attention > 0;

  return (
    <div className="relative order-4 flex w-full items-stretch gap-2 border-t border-[color:var(--milled-hairline)] pt-2 shadow-[0_-1px_0_rgba(255,255,255,0.06)] lg:order-none lg:contents">
      {/* The counts well. It stretches on the phone's row, where it is one of
          two parts sharing a line, and hugs its content on the desktop's,
          where the name column beside it takes the slack. `order-2` because
          the gauge leads on a phone — see `SeasonSummary`. */}
      <div className="relative order-2 flex min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-3 py-2 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-none lg:gap-1 lg:px-3.5 lg:py-[0.4375rem]">
        <StampedCount label="Proj rec">{formatProjectedRecord(summary)}</StampedCount>
        {/* The cut between the two counts — the row's vertical hairline turned
            on its side, drawn here because it belongs between two of them. */}
        <span
          aria-hidden
          className="h-px bg-[color:var(--milled-hairline)] shadow-[0_1px_0_rgba(255,255,255,0.07)]"
        />
        <StampedCount
          label="Need a look"
          tone={lit ? "var(--error)" : undefined}
          live
          title={
            pending
              ? undefined
              : `${attention} of ${of} league${of === 1 ? "" : "s"} checked need a look`
          }
        >
          {pending ? "—" : `${attention} / ${of}`}
        </StampedCount>
      </div>

      {/* Gone below `lg`, where the two wells are on their own row with a gap
          between them: a vertical cut separates two things standing side by
          side on one part's face, and the gap is the separation there. */}
      <MilledHairline className="relative hidden lg:block" />

      {/* The gauge: one name and one value, so a `<dl>`. `flex-col-reverse`
          below `lg` puts the caption under the dial while the `<dt>` stays
          first in the DOM; from `lg` the caption is beside it, the well is
          dissolved and the mount sits on the billet's own face. */}
      <dl className="relative order-1 m-0 flex shrink-0 flex-col-reverse items-center gap-1 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-[0.4375rem] py-1.5 shadow-[var(--standing-well-shadow)] lg:order-none lg:flex-row lg:gap-3.5 lg:rounded-none lg:bg-none lg:p-0 lg:shadow-none">
        <dt className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:text-[length:var(--fs-10)] sm:tracking-[0.14em]">
          Proj win
        </dt>
        {/* The mount. Its second cast is what makes a gauge this size read as
            bolted onto the face rather than printed on it, in
            `--surface-shadow` rather than a literal black for the light
            scheme's sake — the rule every cast in `globals.css` is written by. */}
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
            {/* Six characters step down one size at both mounts — see the
                module note for the chord this was measured against. */}
            <span
              className={`relative font-display font-semibold leading-none tracking-[-0.02em] tabular-nums text-readout [text-shadow:var(--figure-engrave),0_0_20px_var(--accent-glow)] lg:[text-shadow:var(--figure-engrave),0_0_22px_var(--accent-glow)] ${
                pct.length > 5
                  ? "text-[length:var(--fs-13)] lg:text-[length:var(--fs-17)]"
                  : "text-[length:var(--fs-17)] lg:text-[length:var(--fs-21)]"
              }`}
            >
              {pct}
            </span>
          </div>
        </dd>
      </dl>
    </div>
  );
}

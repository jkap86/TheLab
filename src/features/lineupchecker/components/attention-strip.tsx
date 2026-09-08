import { MilledHairline } from "@/features/shared";

import type { AttentionReasons } from "../helpers/lineup-check-metrics";

/**
 * What the lineups that want a press want it *for*: four reasons, each a lamp,
 * a stamped label and its count, on one milled strip cut into the billet
 * under the header's row.
 *
 * **It was the lower half of a lit glass window at the row's end**, under the
 * attention count. The count moved into the counts well beside the record
 * (see `WeekSummary`), and the four rows had nowhere left to stand on the
 * billet's row: with a 108px gauge, the counts well, the keys and a name
 * column that must not truncate, a `min-w-[12.5rem]` window does not fit a
 * 1092px content box. So they are a full-width strip under the row, cut into
 * the same part — the handoff's `milled` arm over its `glass` one, on the
 * grounds that the whole point of the change is one object rather than an
 * instrument with a screen bolted to it.
 *
 * The rows keep every rule they had. The em dash before the check lands — a
 * zero would read as "all clear" for the length of a round trip. The lit error
 * tone above zero, lamp and figure both, so the eye finds the reasons that want
 * a press without reading four numbers. The billet's own inks at zero. And the
 * fact that the four **do not sum** to the count in the well: they are counted
 * over reasons where the count is over leagues, which is why they are labelled
 * by reason rather than presented as a breakdown a reader could add up. See
 * `attentionByReason`.
 *
 * **The unlit lamp is the machined-slot pip**, `--pip-unlit-bg` under
 * `--pip-unlit-shadow`, which is the billet's own vocabulary for an unlit pip
 * and the token that exists precisely so one is not painted near-black on
 * metal — the window's `--readout-muted` was a colour for ink on glass.
 *
 * **Below `sm` the labels shorten and the hairlines go**, and both were
 * measured rather than assumed. At 390 the strip's content box is ~330px, and
 * four lamp-label-figure bays with cuts between them do not fit one line at
 * `--fs-9` with full words; the `short` spellings are two spans switched by
 * the cascade rather than by state, because this renders above the fold on
 * every visit and must not wait for hydration to learn its width. The strip
 * wraps where it has to, and a vertical cut across a wrap is a stub hanging
 * off the line above — so below `sm` the bays are `flex-auto` (basis auto,
 * which is what lets a flex row *wrap*; `flex-1`'s zero basis never does) and
 * the cuts are gone, and the gap is the separation.
 */
export function AttentionStrip({
  reasons,
  pending,
}: {
  reasons: AttentionReasons;
  /** True until the check lands — every figure is an em dash. */
  pending: boolean;
}) {
  return (
    <div className="relative order-5 flex w-full flex-wrap items-stretch gap-x-2.5 gap-y-1 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-3 py-1.5 shadow-[var(--standing-well-shadow)] lg:order-none">
      <ReasonBay
        label="Points left"
        short="Pts"
        count={pending ? null : reasons.points}
      />
      <MilledHairline className="hidden sm:block" />
      <ReasonBay
        label="Kickoff order"
        short="Kick"
        count={pending ? null : reasons.kickoff}
      />
      <MilledHairline className="hidden sm:block" />
      <ReasonBay
        label="Superflex"
        short="SF"
        count={pending ? null : reasons.superflex}
      />
      <MilledHairline className="hidden sm:block" />
      <ReasonBay
        label="Roster slots"
        short="Roster"
        count={pending ? null : reasons.roster}
      />
    </div>
  );
}

/**
 * One reason, and how many leagues are off for it: a lamp, the label stamped
 * on the metal, and the figure engraved beside it on one baseline.
 *
 * `null` is the state before the check lands — the em dash, never a zero, for
 * the reason the count in the well draws one. `short` is the label below
 * `sm`; both are rendered and the cascade picks one, never state — see the
 * strip's own note.
 */
function ReasonBay({
  label,
  short,
  count,
}: {
  label: string;
  short: string;
  count: number | null;
}) {
  const lit = count !== null && count > 0;
  return (
    <span className="flex flex-auto items-baseline gap-2 sm:flex-none">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 self-center rounded-full ${
          lit
            ? "bg-error shadow-[0_0_9px_rgba(252,165,165,0.55)]"
            : "bg-[color:var(--pip-unlit-bg)] shadow-[var(--pip-unlit-shadow)]"
        }`}
      />
      <span className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <span
        className={`whitespace-nowrap font-display text-[length:var(--fs-16)] font-semibold leading-[1.1] tracking-[-0.015em] tabular-nums [text-shadow:var(--standing-engrave)] ${
          lit ? "text-error" : "text-[color:var(--billet-figure)]"
        }`}
      >
        {count ?? "—"}
      </span>
    </span>
  );
}

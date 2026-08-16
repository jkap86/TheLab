"use client";

// The pure module that owns the constant, deep-imported the way client code
// reaches `projections/slots` — a barrel here would drag `pg` into the bundle.
import { LAST_REGULAR_WEEK } from "@/shared/projections/weeks";

/**
 * Which week the page is reading, with a step either side.
 *
 * **The weeks are an ordering, and this is the control that says so** — the
 * trades board's circle stepper, one tool over, arrived at the same shape from
 * the same argument. Eighteen answers cannot be eighteen keys, and they are not
 * unrelated: what a reader is choosing is a *position* on a line, so `‹` and `›`
 * are the two presses the question actually has.
 *
 * Where it parts company with that control is the pips. Four dots say "there is
 * an ordering and you are third along it"; eighteen would be a texture, and the
 * readout already names the position in the one unit anybody counts weeks in.
 * A number is its own pip strip.
 *
 * **It is seated on the subject rail rather than in a lit face of its own**, and
 * takes that rail's shape to get there: 10px type, `.lab-chip-sm` keys, the
 * row's own height. That is `SEATS.rail`'s rule — a seat may change a control's
 * shape and nothing else — and the reason is the one the rail's own note gives:
 * a part standing a step prouder than its neighbours is the only thing on that
 * face claiming a rank, where the row's hierarchy is about questions rather than
 * controls. The week leads it, since the rail reads *which week · what these
 * leagues are · who is in them* and that is the order the three narrowings are
 * applied in.
 *
 * Two behaviours carried over from the circle stepper, for the same reasons.
 * A step with nowhere to go is drawn inert rather than hidden, and is
 * `aria-disabled` rather than `disabled` — the latter takes the key out of the
 * tab order, and a reader who cannot reach a key cannot discover why it is dead.
 * And the number is a live region: the keys are labelled with what they *do*,
 * so the one thing a press changes has to announce itself or the control is
 * legible only to someone who can see it.
 */
export function WeekStepper({
  week,
  onChange,
}: {
  /**
   * The week being shown, or null while the route is still resolving which one
   * the schedule points at.
   *
   * Null draws the control inert rather than hiding it, which is the same call
   * the opponent plate makes for a week it has nothing for: a control that
   * appears once its data lands moves the row under the reader's cursor, and
   * this row is directly above a list they are about to scroll.
   */
  week: number | null;
  /** Step to a week. Never called with one outside the regular season. */
  onChange: (week: number) => void;
}) {
  const back = step(week, -1);
  const forward = step(week, 1);

  return (
    <div className="flex flex-none items-center gap-1">
      <StepKey to={back} label="Previous week" onChange={onChange}>
        ‹
      </StepKey>

      {/* The readout is the rail's own scale rather than the trades board's:
          there it is the block above a windowed list and can afford 19rem, here
          it is the first of four parts sharing one row. Fixed width so the
          digits don't shift the parts beside them as the week runs from 1 to 18
          — a control that resizes as it is used is one a thumb has to re-aim. */}
      <span className="lab-readout flex w-[5.25rem] flex-none items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2">
        {/* Flush to the leading edge and stretched to the height: the side of
            the part catching the light, the manager plate's mark for "a readout
            follows", rather than a stripe drawn on the face. */}
        <span
          aria-hidden
          className="lab-billet-rail w-[2px] flex-none self-stretch rounded-[2px]"
        />
        <span
          aria-live="polite"
          className="lab-engraved min-w-0 flex-1 truncate text-center font-display text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-foreground/90 tabular-nums"
        >
          {week === null ? "Week —" : `Week ${week}`}
        </span>
      </span>

      <StepKey to={forward} label="Next week" onChange={onChange}>
        ›
      </StepKey>
    </div>
  );
}

/**
 * Where a key goes, or null where the season ends.
 *
 * Both bounds live here rather than at the two call sites, the `stepCircle`
 * rule: a stepper asks "can I move" where a key per week would ask "is this one
 * allowed", and answering null is what lets a key with nowhere to go be drawn
 * inert instead of silently re-selecting the week already showing.
 *
 * A null week has no position to step from, so neither key moves — the control
 * is inert whole until the route says which week it settled on.
 */
function step(week: number | null, by: number): number | null {
  if (week === null) return null;
  const next = week + by;
  return next >= 1 && next <= LAST_REGULAR_WEEK ? next : null;
}

/**
 * One week forward or back — or the inert spelling of it, where `to` is null.
 *
 * Flat and unlit when there is nowhere to go: the app bar's rule held to at this
 * size, that a part which does nothing when pressed must not look pressable, so
 * it loses its wall rather than only dimming its glyph.
 */
function StepKey({
  to,
  label,
  onChange,
  children,
}: {
  to: number | null;
  label: string;
  onChange: (week: number) => void;
  children: React.ReactNode;
}) {
  const dead = to === null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={dead || undefined}
      onClick={() => {
        if (to === null) return;
        onChange(to);
      }}
      className={`grid h-[1.375rem] w-[1.25rem] flex-none place-items-center rounded-md text-[0.75rem] leading-none ${
        dead
          ? "cursor-not-allowed text-foreground/25"
          : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

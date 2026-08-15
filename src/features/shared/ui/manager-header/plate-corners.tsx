import type { ReactNode } from "react";

import { stepSeason } from "../../manager-season";

import type { HeaderSeasonControl, HeaderStat } from "./manager-header.types.ts";

/**
 * The plate's top corners: two wells, at one scale, in one material.
 *
 * **Recessed, because on this card that means *read me*.** The plate's four
 * corners were briefly three readouts and a filters' key, and the pairing was the
 * rule this file existed to hold — a well is read, a raised part is pressed, so a
 * tab-shaped well carrying a filter would have been the plate telling you to read
 * its control. The key led the subject rail below instead, which left every
 * corner a fact. A corner added on either edge still has to pick a side of it.
 *
 * **The season corner now takes both sides of it at once, and that is the rule
 * being kept rather than bent.** The well stays the readout it always was — the
 * season is a fact about the whole card, which is why it is up here — and the two
 * *steps* beside it are raised keys riding in it. `.lab-well`'s own note already
 * spells that arrangement out ("used for the bar's current-page chip **and as the
 * trough a raised part sits in**"), and it is the same construction as
 * `.lab-slider` one scale down: recessed because it is read, raised because it is
 * grabbed. What would have broken the rule is a tab-shaped well you press.
 *
 * Why the season and not the stat beside it: the season is the page's
 * *population* rather than a count of it — stepping it re-keys the leagues
 * stream and every read hanging off that stream — so it is not the filter seat
 * this card spent a while regretting. The stat corner remains a pure readout, as
 * does the season corner on any page that passes no control.
 */

/**
 * A tab cut into one of the plate's top corners.
 *
 * Both of them were pills on the identity line, where three things — the
 * manager's name and two constants — competed for one row's width and the *name*
 * was what gave way. They are facts about the whole card rather than about that
 * line (which season, how many leagues), so they read as well from its corners,
 * and moving them there costs the plate no height: the tabs sit in top padding
 * the avatar's own height already paid for.
 *
 * "Flush" is the whole of the styling, and what makes a tab flush changed with
 * the plate under it. It used to carry the card's radius one pixel in
 * (`rounded-tl-[15px]` against a `rounded-2xl` border); the plate is a chamfered
 * slab now, so its own `clip-path` cuts these tabs on the same 9px diagonal —
 * `clip-path` clips a whole subtree — and a radius underneath that cut is a
 * curve inside a bevel, which reads as a tab *almost* fitting its corner. So the
 * outer corners are square and the clip does the work. The two inner corners
 * keep their small return, and the fill is `lab-well` — the recessed material
 * the countdown cells wear — so a tab reads as machined out of the plate's edge
 * rather than as a chip parked near it. The left one pads past the accent rail
 * it covers.
 *
 * They sit above that rail (`z-[3]` against its `z-[2]`), so the accent passes
 * behind the left tab and resumes below it rather than stopping at the chip.
 */
function CornerTab({
  side,
  align = "baseline",
  padding = "px-2.5 py-1",
  children,
}: {
  side: "left" | "right";
  /**
   * How the tab's contents line up. Two facts on one line share a baseline; a
   * readout between two keys is centred, because a key has no baseline worth
   * sharing and would hang below the digits it steps.
   */
  align?: "baseline" | "center";
  /**
   * The tab's own inset. A parameter because the stepper spends its vertical
   * padding on the keys instead: they define the tab's height at 22px, which is
   * within 2px of the plain tab's 20 — near enough that the two corners still
   * read as "two wells, at one scale", which is the rule above.
   */
  padding?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`lab-well absolute top-0 z-[3] inline-flex gap-1.5 text-[10px] leading-none ${
        align === "center" ? "items-center" : "items-baseline"
      } ${padding} ${
        side === "left"
          ? "left-0 rounded-br-lg pl-3.5"
          : "right-0 rounded-bl-lg"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The season being read, in the plate's top-left corner — with a step either
 * side of it where the page offers one.
 *
 * **The seasons are a ladder, and this is the control that says so.** The trades
 * board's circle stepper and the lineup checker's week stepper arrived at the
 * same shape from the same argument, and it holds here too: what a reader is
 * choosing is a *position* on a line, so `‹` and `›` are the two presses the
 * question actually has. There are no pips, for {@link WeekStepper}'s reason — a
 * year is its own pip strip — and no menu, because a list of a decade of years
 * is a list where every entry but two is a place nobody is going.
 *
 * Three behaviours carried over from those two, for the same reasons. A step
 * with nowhere to go is drawn inert rather than hidden, and is `aria-disabled`
 * rather than `disabled` — the latter takes the key out of the tab order, and a
 * reader who cannot reach a key cannot discover why it is dead. The bounds live
 * in {@link stepSeason} rather than at this call site. And the year is a live
 * region: the keys are labelled with what they *do*, so the one thing a press
 * changes has to announce itself or the control is legible only to someone who
 * can see it.
 *
 * The keys clear the plate's chamfer by construction rather than by luck: the
 * tab's own `pl-3.5` starts them 14px in, past the 9px diagonal `.lab-notch-all`
 * cuts out of this exact corner. `clip-path` clips a whole subtree, so a key any
 * further left would have its lit face sliced and read as a part with no
 * thickness — which is the one thing a pressable part must never be.
 */
export function SeasonTab({
  season,
  control,
}: {
  season: string;
  /**
   * How to step, or undefined where the page reads one season and offers no
   * choice — the lineup checker, which is the season it is in by definition.
   * Absent, this is exactly the readout it has always been.
   */
  control?: HeaderSeasonControl;
}) {
  if (!control) {
    return (
      <CornerTab side="left">
        <SeasonDigits season={season} />
      </CornerTab>
    );
  }

  return (
    // `py-0`: the keys are the tab's height, so the stepper costs the plate
    // nothing beyond the 2px they stand taller than the digits alone.
    <CornerTab side="left" align="center" padding="py-0 pr-1">
      <StepKey
        to={stepSeason(season, -1, control.latest)}
        label="Previous season"
        onChange={control.onChange}
      >
        ‹
      </StepKey>
      <SeasonDigits season={season} live />
      <StepKey
        to={stepSeason(season, 1, control.latest)}
        label="Next season"
        onChange={control.onChange}
      >
        ›
      </StepKey>
    </CornerTab>
  );
}

/**
 * The year itself.
 *
 * `live` only where a press can change it: an `aria-live` region on a constant
 * is a promise to announce something that never happens, and three of these
 * cards draw exactly that.
 */
function SeasonDigits({ season, live }: { season: string; live?: boolean }) {
  return (
    <span
      aria-live={live ? "polite" : undefined}
      className="font-mono text-[12px] font-bold leading-none tabular-nums text-active drop-shadow-[0_0_12px_rgba(0,255,229,0.35)]"
    >
      {season}
    </span>
  );
}

/**
 * One season back or forward — or the inert spelling of it, where `to` is null.
 *
 * Flat and unlit when there is nowhere to go: the app bar's rule held to at this
 * size, that a part which does nothing when pressed must not look pressable, so
 * it loses its wall rather than only dimming its glyph. `.lab-chip-sm` rather
 * than `.lab-chip` for the thickness reason the quick-adds already give — this
 * key sits inside a readout, and a full-thickness wall in a 22px well reads as a
 * part that does not fit its slot.
 */
function StepKey({
  to,
  label,
  onChange,
  children,
}: {
  to: string | null;
  label: string;
  onChange: (season: string) => void;
  children: ReactNode;
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
      className={`grid h-[22px] w-[18px] flex-none place-items-center rounded-md text-[12px] leading-none ${
        dead
          ? "cursor-not-allowed text-foreground/25"
          : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The top-right corner, which is a *slot* rather than the league count: it
 * renders whatever {@link HeaderStat} each view passes, `sub` included ("of 121
 * total" is what the count is out of, and a denominator separated from its
 * numerator is the thing this card keeps having to relearn).
 */
export function StatTab({ stat }: { stat: HeaderStat }) {
  return (
    <CornerTab side="right">
      <span className="font-bold uppercase tracking-[0.12em] text-foreground/40">
        {stat.label}
      </span>
      <span className="font-mono text-[12px] font-bold leading-none tabular-nums text-foreground/85">
        {stat.value}
      </span>
      {stat.sub && <span className="text-foreground/35">{stat.sub}</span>}
    </CornerTab>
  );
}

import type { ReactNode } from "react";

import type { HeaderStat } from "./manager-header.types.ts";

/**
 * The plate's top corners: two wells, at one scale, in one material.
 *
 * **Recessed, because on this card that means *read me*.** The plate's four
 * corners were briefly three readouts and a filters' key, and the pairing was the
 * rule this file existed to hold — a well is read, a raised part is pressed, so a
 * tab-shaped well carrying a filter would have been the plate telling you to read
 * its control. The key leads the subject rail below now, which leaves every
 * corner a fact and the rule with nothing left to arbitrate. A corner added on
 * either edge still has to pick a side of it.
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
 * "Flush" is the whole of the styling. The outer corner takes the card's radius
 * one pixel in (`15px` against a `rounded-2xl` border), the two inner corners are
 * square but for a small return, and the fill is `lab-well` — the recessed
 * material the countdown cells wear — so a tab reads as machined out of the
 * plate's edge rather than as a chip parked near it. The left one pads past the
 * accent rail it covers.
 *
 * They sit above that rail (`z-[3]` against its `z-[2]`), so the accent passes
 * behind the left tab and resumes below it rather than stopping at the chip.
 */
function CornerTab({
  side,
  children,
}: {
  side: "left" | "right";
  children: ReactNode;
}) {
  return (
    <span
      className={`lab-well absolute top-0 z-[3] inline-flex items-baseline gap-1.5 px-2.5 py-1 text-[10px] leading-none ${
        side === "left"
          ? "left-0 rounded-br-lg rounded-tl-[15px] pl-3.5"
          : "right-0 rounded-bl-lg rounded-tr-[15px]"
      }`}
    >
      {children}
    </span>
  );
}

/** The season being read, in the plate's top-left corner. */
export function SeasonTab({ season }: { season: string }) {
  return (
    <CornerTab side="left">
      <span className="font-mono text-[12px] font-bold leading-none tabular-nums text-active drop-shadow-[0_0_12px_rgba(0,255,229,0.35)]">
        {season}
      </span>
    </CornerTab>
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

import type { ReactNode } from "react";

import type { HeaderStat } from "./manager-header.types.ts";

/**
 * The plate's four corners, which are one family at one scale split by material:
 * two wells at the top you read, one key at the bottom you press.
 *
 * **The key is raised and not a tab, and that is the whole of the styling
 * argument.** The top corners are `lab-well`, because on this card recessed means
 * *read me*. A filter is pressed, so a tab-shaped well down there would be the
 * plate telling you to read its filter. They are kept in one file because that
 * pairing is the rule — a corner added on either edge has to pick a side of it.
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

/**
 * The filters' key, machined into the plate's bottom-right corner — the top
 * tabs' geometry in the raised material.
 *
 * It is anchored to the *plate* rather than to the body, so it follows the
 * plate's bottom down when the transient state line appears rather than being
 * left floating in the middle of the card.
 *
 * Right rather than left for two reasons: the accent rail runs down the left edge
 * and a key started over it would stop the accent at a button, and the plate's
 * right edge then reads read-then-press — the stat count's well above, the
 * control below it.
 *
 * **Flush rather than straddling, which is the change.** Hanging half below the
 * border made the key a part rising out of the edge, and cost 20px of clearance
 * to keep its lit face off the columns rail's lit face — on a card that is pinned
 * over the list, which is 20px of league rows covered for a gap. Flush it costs
 * the 4px its wall stands on, and the corner it fills was empty plate. The wall
 * is why this is a sibling *outside* the plate's clip and not a {@link CornerTab}:
 * a clipped wall is a part with no thickness, which is the one thing a pressable
 * part must not be.
 *
 * The key keeps `.lab-chip`'s wall and its press travel, which is the other half
 * of that: a part you press has to travel when pressed, and the wall is what it
 * travels into.
 *
 * Seated 3px up, `flex` so no inline baseline adds its own descender.
 * `.lab-chip`'s wall is a `0 3px 0` shadow — the face's own shape shifted down —
 * so a face resting 3px above the border puts the *wall* on the plate's
 * bottom-right corner, tracing its radius. The part is then exactly contained by
 * the plate: thickness visible, nothing overhanging, which is the whole of what
 * flush buys over straddling. At `bottom-0` the face would fill the corner and
 * the wall would hang below it, which is a smaller overhang than before but still
 * an overhang to be cleared.
 */
export function FilterSeat({ children }: { children: ReactNode }) {
  return <div className="absolute bottom-[3px] right-0 flex">{children}</div>;
}

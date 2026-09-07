import type { RosterPick } from "@/shared/contract";

import { ordinal } from "../format";
import { DrawerRow } from "./pane";

/**
 * The roster's future draft picks, as the rows of the roster pane's second
 * drawer.
 *
 * **It was a grid of season plates below the two panes, and the capped panel is
 * what moved it.** Once the expanded half is a fixed-height column sized to
 * whatever viewport is left under the parked card, anything standing below the
 * panes is height taken *from* them — so a portfolio down there would squeeze
 * the two lists the card is opened to read, on every card, whether or not
 * anybody was looking at the picks. Pinned behind a bar it costs the panes 42px
 * and is one press from open. See `LineupBreakdown` for the bar it sits
 * behind.
 *
 * A pick reads the way Sleeper names it: by its slot ("1.05") once that draft's
 * order is set, by its round ("2nd") before — and only then does an acquired
 * pick name its original owner, since a slot already says exactly which pick
 * this is. Acquired picks are lit either way: a third party's 1st is a
 * different asset from your own, order or no order. That rule has exactly one
 * spelling, {@link pickName}, because it is the one thing about a pick that is
 * easy to get differently wrong in two places.
 *
 * **An unpriced pick draws an em dash here, where the pills drew nothing.**
 * That is the app's ordinary three-way grammar restored rather than an
 * exception dropped: the pills gave it up on a density argument — a dozen of
 * them three words wide, with a column of dashes across the seasons KTC has no
 * opinion about being more ink than the picks themselves — and a row has a
 * figure column that is either filled or not. There is no zero on screen to
 * mistake a dash for, and `ktc_picks` on the card above is the number that *is*
 * summed.
 *
 * **The season leads the row rather than grouping it.** The grid was scanned
 * season by season ("what do I have in 2027?") and put the year on a ledge over
 * each plate; a list a third the width has no room for that, and picks arrive
 * sorted by season anyway — so the year is the row's own first cell, in the
 * well the bench rows opposite put a position in. The reading is the same and
 * the column does the grouping.
 *
 * **The timeline is the second reader**, and two of the three fields on a
 * rewound pick are null by construction: see `timelinePickAssets` for why a
 * past moment can state a round and not a slot, and why it prices nothing.
 * Nothing here has to branch for it, which is what the three-way grammar is
 * for.
 */

/**
 * What this pick is called — the naming rule, in one place.
 *
 * `1.05` once the draft's order is known, the round before it. The zero-pad is
 * what makes a slot read as a slot rather than as a decimal, which is the
 * spelling every league uses.
 */
export function pickName(pick: RosterPick): string {
  return pick.slot !== null
    ? `${pick.round}.${String(pick.slot).padStart(2, "0")}`
    : ordinal(pick.round);
}

/**
 * The seasons a portfolio spans, for the drawer's bar: `2027–2028`, or the one
 * year where that is all there is.
 *
 * Picks arrive sorted by season, so the two ends are the two ends of the list.
 * Empty answers null rather than a dash — the bar it labels is not drawn at all
 * when there is nothing to open.
 */
export function pickSpan(picks: readonly RosterPick[]): string | null {
  const first = picks[0]?.season;
  const last = picks[picks.length - 1]?.season;
  if (!first || !last) return null;
  return first === last ? first : `${first}–${last}`;
}

/**
 * One row per pick, in the drawer's own stock.
 *
 * The season leads the row, in the well the bench rows opposite put a position
 * in — a portfolio is scanned season by season, picks arrive sorted by season,
 * and the column is what does the grouping the old grid's per-season ledges
 * did. It is wider than that well by four characters against three, which is a
 * year against a position.
 */
export function PickRows({ picks }: { picks: readonly RosterPick[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {picks.map((pick, i) => (
        <DrawerRow
          // Position in the sorted list is the identity the payload keeps — two
          // acquired picks can share round *and* origin name, so nothing on the
          // pick itself is unique.
          key={i}
          lead={pick.season}
          leadWidth="lg:w-[54px]"
          figure={pick.value !== null ? pick.value.toLocaleString("en-US") : "—"}
        >
          <span className="relative min-w-0 flex-1 truncate text-[length:var(--fs-14)] lg:order-3">
            {/* Lit where the pick came from somebody else — the pills' own
                rule, and the one thing about a portfolio that is not simply a
                list of rounds. */}
            <span
              className={
                pick.from
                  ? "text-[color:var(--billet-accent)]"
                  : "text-[color:var(--billet-name)]"
              }
            >
              {pickName(pick)}
            </span>
            {pick.from && (
              <span className="text-[color:var(--billet-label)]">
                {" "}
                from {pick.from}
              </span>
            )}
          </span>
        </DrawerRow>
      ))}
    </ul>
  );
}

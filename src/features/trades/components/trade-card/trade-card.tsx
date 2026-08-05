"use client";

import { memo } from "react";

// The pure module directly, never the `@/shared/ktc` barrel: this is a client
// component, and the barrel re-exports the `pg`-backed queries beside it.
import { isSuperflexLineup } from "@/shared/ktc/roster";

import { TradeCardHeader } from "./trade-header";
import { TradeSideColumn } from "./trade-side";
import type { TradeCardProps } from "./trade-card.types.ts";

/**
 * One trade: which league it happened in, when, and what each side came away
 * with — beside what it handed over.
 *
 * **The card is machined rather than glass, and that is a deliberate break from
 * the other two lists.** League cards and share cards wear `LIST_ROW_SURFACE`,
 * and the point of sharing it is that three lists read as one material; this one
 * wears `.lab-slab` instead — the app bar's corner-lit block at card scale, with
 * a wall running down *and* right, a chamfered leading and trailing corner, a
 * brushed face and a static specular sweep. What buys the divergence is that a
 * trade card is not a row that opens into something: it is the whole of what it
 * has to say, four columns deep, and the depth is what sorts those columns into
 * an order. The cyan rail, the hover lift and the bloom all survive, so the card
 * still answers the pointer the way its neighbours do.
 *
 * This file is the composition root and holds only what the whole card shares:
 * which board the trade is priced on, and the two bundles every level below
 * threads (see `./trade-card.types`). Everything with markup of its own lives
 * beside it in this folder — the header, one side's plate, and the asset tracks
 * inside it.
 *
 * Memoised, because the list re-renders on every scroll frame: without it ~26
 * cards re-ran their exchange assembly and whole subtree at 60Hz.
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  players,
  managers,
  metric,
  ktc,
  pickKtc,
  pickSlots,
}: TradeCardProps) {
  const lookups = { players, managers, pickSlots };
  const pricing = {
    metric,
    ktc,
    pickKtc,
    // Which KTC board this trade reads, from the league's own lineup — the
    // stream spans every crawled league, and the two boards move in opposite
    // directions at quarterback. An unsynced lineup falls to 1QB, which is what
    // `isSuperflexLineup` answers for an unknown one.
    superflex: isSuperflexLineup(league?.roster_positions ?? null),
    teams: league?.total_rosters ?? null,
  };

  return (
    // The wall, and the face standing on it. Both carry the chamfer: a wall that
    // turns two corners shows a square one wherever the clip doesn't follow it.
    <div className="lab-slab lab-notch-lg">
      <article className="lab-slab-face lab-notch-lg p-2.5 sm:p-3">
        <TradeCardHeader
          name={league?.name ?? trade.league_id}
          completedAt={trade.completed_at}
        />

        {/* Gaps rather than the old `gap-px` hairline: the sides are seated
            plates now, so what separates them is the ground showing between two
            objects and there is no rule to draw. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {trade.sides.map((side, i) => (
            <TradeSideColumn
              key={side.roster_id}
              side={side}
              // The odd side of a three-way takes the whole row rather than
              // leaving the cell beside it empty: an empty cell in a grid of
              // sides reads as a participant who came away with nothing, which
              // is a real state this card draws in words.
              wide={trade.sides.length % 2 === 1 && i === trade.sides.length - 1}
              trade={trade}
              lookups={lookups}
              pricing={pricing}
            />
          ))}
        </div>
      </article>
    </div>
  );
});

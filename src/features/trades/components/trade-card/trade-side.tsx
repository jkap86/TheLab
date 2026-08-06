import { Avatar } from "@/features/shared/ui/avatar";

import {
  counterpartyRoster,
  givenBundle,
  isEmptyBundle,
  receivedBundle,
} from "../../exchange";
import type { Trade, TradeSide } from "../../types";
import { TradeValueTag } from "../trade-value";
import { AssetTrack } from "./trade-assets";
import { ASSET_TRACKS_PAIRED, SIDE_ZONE } from "./trade-card.constants.ts";
import type {
  TradeCardLookups,
  TradeCardPricing,
} from "./trade-card.types.ts";
import { sideContext } from "./trade-card.utils.ts";

/**
 * One manager's half of the trade: who they are, what the haul is worth, what
 * they took and what they sent.
 *
 * **A side lists what it received *and* what it gave.** The give half was
 * dropped once, for a narrow layout that printed every asset twice — once as a
 * `+` on the side that took it and once as a `−` on the side that sent it — and
 * the redundancy is real and unchanged. What changed is what it buys: a
 * manager's block can now be read on its own, which is how a card in a windowed
 * list of forty thousand is actually read, rather than by finding the
 * counterparty's column and inverting it. It is paid for in *material* rather
 * than in height — the gives sit in a groove milled into the card's face, dimmer
 * and a step smaller, so the card still reads take-first — and it is drawn only
 * where it is honest, which is a two-sided trade (see `../../exchange`).
 *
 * **It is a region of that face and not a plate on it**, which is the card's
 * whole hierarchy — see `SIDE_ZONE` for what was wrong with the plate and
 * `TradeCard` for what the correction cost.
 */
export function TradeSideColumn({
  side,
  trade,
  lookups,
  pricing,
  seam,
  wide,
}: {
  side: TradeSide;
  trade: Trade;
  lookups: TradeCardLookups;
  pricing: TradeCardPricing;
  /**
   * The cut parting this side from the one before it, empty for the first —
   * which way it runs is the call site's arithmetic, since only it knows where
   * this side sits in the grid.
   */
  seam: string;
  /** Whether this side takes the whole row — see the grid at the call site. */
  wide: boolean;
}) {
  const manager = side.user_id ? lookups.managers[side.user_id] : undefined;
  const name = manager?.display_name || `Roster ${side.roster_id}`;
  const received = receivedBundle(side);
  const context = sideContext(pricing, lookups, trade.league_id, received);

  // Who handed this side its haul, resolved once for the side rather than per
  // pick line — it is the same answer for every asset a side received.
  const giver = counterpartyRoster(trade, side);
  // Null in a three-way, where nothing Sleeper stores says which participant an
  // asset came through; empty where a two-sided counterparty took nothing.
  const given = givenBundle(trade, side);
  const showGiven = given !== null && !isEmptyBundle(given);

  return (
    // A region of the card's face: the seam is what says where it starts, and
    // there is nothing else to see.
    <div className={`${SIDE_ZONE} ${seam} ${wide ? "sm:col-span-2" : ""}`}>
      {/* No "Receives" eyebrow: at half a card's width it spent ~70px of the
          manager's line restating what every `+` under it already says, and the
          name is what was giving way for it. No parting line under the row
          either — with the side no longer a plate, the seam above it is the only
          horizontal cut this block gets, and a second one two lines down would
          be back to drawing a box. */}
      <div className="mb-2 flex items-center gap-2">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-[13px] font-bold">{name}</span>
        {/* In a readout, flush right — the same edge the per-line values below
            sit on, so the column reads as the lines summing to the figure above
            them. Recessed and not under a lens: a lens is glass with a cyan rim
            and a gloss, which is the *lit* reading the card deliberately trades
            away for an engraved one. */}
        <span className="lab-readout ml-auto shrink-0 rounded px-2 py-0.5">
          <TradeValueTag metric={pricing.metric} ctx={context} />
        </span>
      </div>

      {isEmptyBundle(received) && !showGiven ? (
        // A side of a three-way can take nothing from the others; saying so is
        // clearer than a blank block that reads as a rendering gap.
        <p className="text-[13px] text-foreground/40">Nothing</p>
      ) : (
        <div
          className={`grid gap-x-2 gap-y-2 ${showGiven ? ASSET_TRACKS_PAIRED : ""}`}
        >
          <AssetTrack
            bundle={received}
            tone="in"
            context={context}
            metric={pricing.metric}
            giver={giver}
            lookups={lookups}
          />
          {showGiven && (
            <AssetTrack
              bundle={given}
              tone="out"
              context={context}
              metric={pricing.metric}
              // A pick this side is handing over needs no "from" line when it
              // was this side's own — the same rule as the take half, with the
              // roster on the other end of it.
              giver={side.roster_id}
              lookups={lookups}
            />
          )}
        </div>
      )}
    </div>
  );
}

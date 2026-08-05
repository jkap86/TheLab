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
import { ASSET_TRACKS_PAIRED } from "./trade-card.constants.ts";
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
 * than in height — the gives sit in a groove milled into the side plate, dimmer
 * and a step smaller, so the card still reads take-first — and it is drawn only
 * where it is honest, which is a two-sided trade (see `../../exchange`).
 */
export function TradeSideColumn({
  side,
  trade,
  lookups,
  pricing,
  wide,
}: {
  side: TradeSide;
  trade: Trade;
  lookups: TradeCardLookups;
  pricing: TradeCardPricing;
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
    // Seated in the card's own face, which is why it wears both the thinner wall
    // and the lifted fill: a part seated in another has to catch more light than
    // what it is seated in, or the two read as one surface with a seam.
    <div
      className={`lab-plate-sm lab-plate-brushed rounded-lg px-2.5 py-2.5 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      {/* No "Receives" eyebrow: at half a card's width it spent ~70px of the
          manager's line restating what every `+` under it already says, and the
          name is what was giving way for it. The parting line under the row is a
          milled one — a dark cut with a lit far lip — rather than a border. */}
      <div className="mb-2 flex items-center gap-2 pb-2 shadow-[0_1px_0_rgba(0,0,0,0.6),0_2px_0_rgba(255,255,255,0.06)]">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-[13px] font-bold">{name}</span>
        {/* Under glass, and flush right — the same edge the per-line values
            below sit on, so the column reads as the lines summing to the figure
            above them. */}
        <span className="lab-readout lab-lens ml-auto shrink-0 rounded px-2 py-0.5">
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

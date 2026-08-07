import type { ManagerLeague } from "@/shared/manager";

import type { RookieLadderRung } from "../../pick-value";
import type { TradeMetric } from "../../trade-metrics";
import type {
  AdpBoardType,
  AdpPlayerPayload,
  KtcValue,
  PlayerSummary,
  Trade,
  TradeManager,
} from "../../types";

/**
 * The shapes a trade card's parts hand each other.
 *
 * A card is four levels deep — card → side → track → line — and the two things
 * every level needs are the page's lookup tables and the board the haul is
 * priced on. Threaded as loose props that was `players`, `managers` and
 * `pickSlots` retyped in four prop lists and passed through four call sites,
 * which is the duplication a bundle removes: a fifth lookup is one field here
 * rather than four more prop declarations, and a level that merely passes them
 * on cannot fall out of step with the level above it.
 *
 * Types only, and every cross-module dependency arrives as `import type`, so
 * this module compiles to nothing and the pure half of the card can read it
 * without a runtime import.
 */

/**
 * Which track a line is in: what a side took, or what it handed over.
 *
 * The two tracks are the same list of the same kind of thing — what separates
 * them is the surface they sit on and the sign that starts each line, which is
 * exactly the amount of difference there is. See `ASSET_TONES` for the material
 * each one wears.
 */
export type AssetTone = "in" | "out";

/**
 * The page's lookup tables, as one prop rather than three.
 *
 * All three are read at the bottom of the card — a player's name and position, a
 * pick's original owner, the draft slot that turns "a 1st" into "1.05" — and by
 * nothing above it, so every level between exists only to pass them down.
 * `pickSlots` is keyed by `pickSlotKey`, the same key the route wrote the slots
 * under, so both ends of the wire read one definition.
 */
export type TradeCardLookups = {
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
};

/**
 * What a haul is priced against: the chosen column, the two boards behind the
 * value metrics, and the league facts that decide how each is read.
 *
 * `superflex`, `teams`, `adpBoard` and `adpPool` are derived once from the
 * league at the top of the card rather than re-derived per side, and they are on
 * this bundle rather than the lookups because all four exist only to be read *by
 * the metric* — see {@link sideContext}, which is the one place they are
 * assembled into the shape a metric takes.
 */
export type TradeCardPricing = {
  /** The value column every side wears, chosen once for the whole list. */
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  /**
   * The ADP panel's board, keyed by player id — both league-type markets per
   * row, since this list spans leagues that play different ones. Empty until
   * `/api/adp` answers, which reads as an unpriced haul for that moment.
   */
  adp: Record<string, AdpPlayerPayload>;
  /** Which of those markets this trade's league is in — see `leagueAdpBoard`. */
  adpBoard: AdpBoardType;
  /**
   * The same board's rookie class in draft order — the rookie-pick ladder a
   * traded pick is priced off. Picked from the page's two by `adpBoard`, since
   * a rookie's place in the queue is a different place in each market.
   */
  adpLadder: readonly RookieLadderRung[];
  /** Teams × starting slots, the pool the ADP value curve is anchored to. */
  adpPool: number;
  /** Halvings across that pool — the panel's own slider, list-wide. */
  steepness: number;
  /**
   * KTC's rookie-pick rows for the picks on this page, keyed by season, round
   * and tier. Which row a pick reads is resolved from the slots in
   * {@link TradeCardLookups} plus `teams` below — see `../../trade-metrics`.
   */
  pickKtc: Record<string, KtcValue>;
  /**
   * Which of KTC's two boards this trade reads, from the league's own lineup —
   * the stream spans every crawled league, and the two boards move in opposite
   * directions at quarterback. An unsynced lineup falls to 1QB, which is what
   * `isSuperflexLineup` answers for an unknown one.
   */
  superflex: boolean;
  /**
   * How many teams draft in this league — what turns a pick's slot into the
   * third of the round KTC prices. Null where the league list hasn't answered,
   * which prices the pick without placing it.
   */
  teams: number | null;
};

/**
 * What a trade card is given.
 *
 * Unchanged in shape from before this folder existed: the list renders forty
 * thousand of these and passes the props flat, so the card takes them flat and
 * bundles them for its own parts. Every field is one of the two bundles above
 * spelled out — `players`, `managers` and `pickSlots` are
 * {@link TradeCardLookups}, and `metric`, `ktc`, `pickKtc`, `adp` and
 * `steepness` are the stored half of {@link TradeCardPricing}, whose other four
 * fields the card derives from `league`. What each one is for is documented
 * there rather than twice.
 */
export type TradeCardProps = {
  trade: Trade;
  /**
   * The league this trade happened in — its name for the header, its lineup and
   * size for the board its hauls are priced on. Null where the league list
   * hasn't answered yet; the id stands in and the pricing falls back the way an
   * unsynced lineup does.
   */
  league: ManagerLeague | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  pickKtc: Record<string, KtcValue>;
  adp: Record<string, AdpPlayerPayload>;
  /** Both markets' rookie ladders; the card reads the one its league plays in. */
  adpLadders: Record<AdpBoardType, readonly RookieLadderRung[]>;
  steepness: number;
  pickSlots: Record<string, number>;
  /**
   * Open this trade's league — its standings and rosters, over the board.
   *
   * It takes the trade rather than being a closure over it, and that is a
   * property the memo rests on: one stable callback for the whole list, built
   * once in `TradesHome`, where a per-card arrow would be a new prop identity on
   * every render and would re-render all ~26 windowed cards at both ends of
   * every scroll gesture. The same reason every other prop here is a `useMemo`
   * or a catalogue entry.
   */
  onOpenLeague: (trade: Trade) => void;
};

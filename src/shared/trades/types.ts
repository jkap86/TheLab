/**
 * A completed trade, read back out of the `transactions` table the league sync
 * mirrors Sleeper into.
 *
 * Sleeper describes a trade as a flat set of maps — `adds` is player → roster,
 * `draft_picks` carries its own owners, `waiver_budget` its own sender and
 * receiver — with no notion of "sides". A reader thinks in sides, so
 * {@link assembleTrade} turns those maps into one entry per participating
 * roster, holding what that roster *received*. Everything given up is what the
 * other sides received, so it is never stored twice.
 */

/** A future draft pick as it moves in a trade. */
export type TradePickAsset = {
  /** The draft's season, e.g. `"2026"`. Sleeper sends it as a string. */
  season: string;
  round: number;
  /**
   * The roster the pick *originally* belongs to, which is what names it: a 2026
   * 1st is a different asset depending on whose it is. Not who is trading it —
   * a pick can change hands several times before it is used.
   */
  roster_id: number;
};

/** One roster's half of a trade: what it came away with. */
export type TradeSide = {
  roster_id: number;
  /**
   * The manager holding that roster, or null where the league's rosters aren't
   * cached or the team is orphaned. A trade with a null side is still a real
   * trade, so it is kept rather than dropped.
   */
  user_id: string | null;
  /** Player ids received. */
  players: string[];
  picks: TradePickAsset[];
  /** FAAB received, in the league's own units; 0 where none moved. */
  faab: number;
};

export type Trade = {
  transaction_id: string;
  league_id: string;
  /** The scoring week Sleeper filed the trade under; null in the offseason. */
  week: number | null;
  /**
   * When the trade completed, epoch milliseconds — `status_updated` where
   * Sleeper sent one, else `created`. The two differ for a trade that sat
   * pending review, and the date a reader is looking for is when it went
   * through, not when it was offered.
   */
  completed_at: number | null;
  /**
   * One entry per participating roster, in roster-id order. Two for nearly every
   * trade, more for the three-way ones some leagues run.
   */
  sides: TradeSide[];
};

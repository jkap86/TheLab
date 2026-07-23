/** One value block (superflex or 1QB) inside a KTC dynasty-rankings entry. */
export type KtcValueBlock = {
  value: number;
  rank: number;
  positionalRank: number;
  overallTier?: number;
  positionalTier?: number;
};

/**
 * A KTC dynasty-rankings entry as embedded in the page's `playersArray`.
 *
 * Only the fields the sync reads are typed; each entry carries much more (bye
 * week, college, adp, etc.) which is stored verbatim in the `data` column.
 * Draft picks appear here too, with `position` "RDP".
 */
export type KtcPlayer = {
  playerID: number;
  playerName: string;
  slug: string;
  position: string; // QB | RB | WR | TE | RDP (rookie draft pick)
  team: string;
  rookie?: boolean;
  age?: number | null;
  /** Date of birth as unix seconds (string in the source); used for id matching. */
  birthday?: string | number | null;
  oneQBValues?: KtcValueBlock;
  superflexValues?: KtcValueBlock;
  [key: string]: unknown;
};

/**
 * One point of a KTC history series, as embedded on a player page: `d` is a
 * `YYMMDD` date string, `v` the value or rank on that day.
 */
export type KtcSeriesPoint = { d: string; v: number };

/** One player's superflex and 1QB numbers for a single day, merged by date. */
export type KtcHistoryPoint = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  sfValue: number | null;
  sfRank: number | null;
  sfPositionRank: number | null;
  oneqbValue: number | null;
  oneqbRank: number | null;
  oneqbPositionRank: number | null;
};

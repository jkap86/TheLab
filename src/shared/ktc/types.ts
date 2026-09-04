/**
 * The shapes KeepTradeCut embeds in its pages, as the sync reads them.
 *
 * Pure types, no runtime imports — `parse.ts` and `validate.ts` run under
 * Node's test runner and reach this file relatively.
 */

/**
 * Which of KTC's two markets a scrape reads: the dynasty rankings page or the
 * redraft one ("fantasy rankings", in KTC's own naming). A format is what one
 * fetch returns — each page's entries carry *both* QB boards (see
 * {@link KtcPlayer}), which is why format is a row's identity in `ktc_values`
 * while superflex is a pair of columns.
 *
 * **Declared in `shared/contract` and re-exported here**, not the other way
 * round: the client names a format too (the board keys, the payload echo) and
 * this barrel is server-only. One spelling, on the side of the seam both can
 * reach.
 */
export type { KtcFormat } from "@/shared/contract";

/** One value block (superflex or 1QB) inside a KTC rankings entry. */
export type KtcValueBlock = {
  value: number;
  rank: number;
  positionalRank: number;
  overallTier?: number;
  positionalTier?: number;
};

/**
 * A KTC rankings entry as embedded in a page's `playersArray`.
 *
 * Only the fields the sync reads are typed; each entry carries much more (bye
 * week, college, adp, TE-premium variants) which is stored verbatim in the
 * `data` column. The dynasty board includes rookie draft picks (`position`
 * "RDP"); the redraft board has no picks but adds "PK" and "DST".
 *
 * **`playerID` is per-board, not a global id.** The same player carries
 * different ids on the dynasty and redraft pages (Bijan Robinson was 1414 and
 * 1507 when this was written), and the slug embeds the id, so neither field
 * links the two formats. Cross-format identity waits on the Sleeper matcher.
 */
export type KtcPlayer = {
  playerID: number;
  playerName: string;
  slug: string;
  position: string; // QB | RB | WR | TE | RDP (dynasty) | PK | DST (redraft)
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

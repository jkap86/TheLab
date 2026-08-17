/**
 * The auction column's arithmetic, without the query around it.
 *
 * Split out for the reason `adp-filters` is: the read itself is a thin I/O
 * wrapper, and the parts worth testing are the aggregate list the SQL is
 * generated from and the fold that turns a row of prefixed columns into an
 * answer. Both are silent when wrong — a gate read off the wrong column gives a
 * plausible share rather than an error — and neither can be reached from a test
 * while it lives beside `pool.query`.
 *
 * No runtime imports at all, so Node's test runner can resolve it.
 */

/**
 * A draft's per-manager budget, guarded before the cast.
 *
 * Sleeper omits its defaults and promises nothing about the types inside
 * `settings`, so a bare `(settings->>'budget')::int` fails the whole query on one
 * league holding junk. **Unparseable and absent both read as null, and a null
 * budget contributes nothing** — that is the one place this differs from the
 * board's other guarded casts, which fall back to Sleeper's own default. There
 * is no honest default here: a share is a fraction of a specific number, and
 * assuming the common 200 would silently reprice every player in a room that
 * played for 100.
 */
export const AUCTION_BUDGET_SQL = `
  (CASE WHEN d.settings->>'budget' ~ '^[0-9]+(\\.[0-9]+)?$'
        THEN (d.settings->>'budget')::float8 END)`;

/**
 * What a pick went for. Sleeper carries it as a string in the pick's own
 * `metadata`, present only on an auction draft's picks — guarded on the same
 * terms as the budget, and null (rather than zero) where it cannot be read, so
 * an unreadable buy is left out of the average instead of counted as free.
 */
export const AUCTION_AMOUNT_SQL = `
  (CASE WHEN dp.metadata->>'amount' ~ '^[0-9]+(\\.[0-9]+)?$'
        THEN (dp.metadata->>'amount')::float8 END)`;

/** Which league-type board an auction counts into — the same two everywhere. */
export type AuctionBoard = "redraft" | "dynasty";

/**
 * One player's auction reading on one board.
 *
 * `share` is a **percentage of the room's budget**, not a fraction: a reader
 * holds an auction price as "58% of my cap", and a cell showing `0.58` next to a
 * heading saying `Bid` is a unit nobody carries in their head. Two decimals,
 * because the bottom of a roster is a dollar of two hundred and rounding it to a
 * whole percent is rounding it to zero.
 */
export type AdpAuctionStats = {
  /** Auctions on this board he was bought in — the sample behind `share`. */
  buys: number;
  /** Mean of `amount / budget`, as a percentage. */
  share: number;
  min_share: number;
  max_share: number;
  /** Sample standard deviation of the share; 0 for a single buy. */
  stdev: number;
};

/**
 * A player's spend on each board. A board is null when it bought him in fewer
 * than `min_picks` auctions — too few to average, which is a different answer
 * from cheap. Both null is a player the crawled auctions never bought.
 */
export type AdpAuctionBoards = {
  redraft: AdpAuctionStats | null;
  dynasty: AdpAuctionStats | null;
};

/**
 * One board's five aggregate columns, prefixed with the board's name.
 *
 * Generated rather than written twice, so the two boards cannot come to read
 * different columns — the same reason `boardAggregates` is a function. The board
 * names are this module's own closed vocabulary, not input, and the column they
 * aggregate is `buys.share`, which the query has already reduced to a plain
 * `float8`. `stdev`'s COALESCE keeps a single buy at 0 rather than null, matching
 * the ADP columns beside it.
 */
export function auctionBoardAggregates(board: AuctionBoard): string {
  const on = board === "dynasty" ? "b.dynasty" : "NOT b.dynasty";
  return `
            (count(*) FILTER (WHERE ${on}))::int AS ${board}_buys,
            round((avg(b.share) FILTER (WHERE ${on}))::numeric, 2)::float8 AS ${board}_share,
            round((min(b.share) FILTER (WHERE ${on}))::numeric, 2)::float8 AS ${board}_min_share,
            round((max(b.share) FILTER (WHERE ${on}))::numeric, 2)::float8 AS ${board}_max_share,
            round(COALESCE(stddev_samp(b.share) FILTER (WHERE ${on}), 0)::numeric, 2)::float8 AS ${board}_stdev`;
}

/** The row shape {@link auctionBoardAggregates} produces, for both boards. */
export type AuctionBoardColumns = {
  [B in AuctionBoard as `${B}_buys`]: number;
} & {
  [B in AuctionBoard as `${B}_share`]: number | null;
} & {
  [B in AuctionBoard as `${B}_min_share`]: number | null;
} & {
  [B in AuctionBoard as `${B}_max_share`]: number | null;
} & {
  [B in AuctionBoard as `${B}_stdev`]: number | null;
};

/**
 * One board's stats off a row's prefixed columns; below `minBuys` is null.
 *
 * The gate is checked here as well as in the statement's `HAVING`, and that is
 * not redundant: the `HAVING` keeps a player whose *other* board cleared it, so
 * a row can arrive carrying one board under the gate and the other over it. A
 * fold that trusted the statement would report a one-auction board as an
 * average.
 */
export function auctionStats(
  row: AuctionBoardColumns,
  board: AuctionBoard,
  minBuys: number,
): AdpAuctionStats | null {
  const buys = row[`${board}_buys`];
  const share = row[`${board}_share`];
  if (buys < minBuys || share === null) return null;
  return {
    buys,
    share,
    min_share: row[`${board}_min_share`]!,
    max_share: row[`${board}_max_share`]!,
    stdev: row[`${board}_stdev`]!,
  };
}

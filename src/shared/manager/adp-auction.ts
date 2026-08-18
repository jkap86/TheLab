import { pool } from "@/shared/db";
import { TtlPromiseCache } from "@/shared/util";

import { adpComputeAdmission } from "./adp-admission";
import {
  type AdpAuctionBoards,
  AUCTION_AMOUNT_SQL,
  AUCTION_BUDGET_SQL,
  type AuctionBoardColumns,
  auctionBoardAggregates,
  auctionStats,
} from "./adp-auction-fold";
import type { AdpFilters } from "./adp-filters";
import { DYNASTY_BOARD_SQL, draftSelection } from "./adp-selection";
import { ADP_AUCTION_CACHE } from "./read-cache";

// The pure half is `./adp-auction-fold` — the SQL fragments, the generated
// aggregates and the fold — and it is re-exported from here for the reason
// `./adp` re-exports its own selection: this is the module the feature is called
// after, and a split made for testability should not move the names.
export { AUCTION_AMOUNT_SQL, AUCTION_BUDGET_SQL } from "./adp-auction-fold";
export type { AdpAuctionBoards, AdpAuctionStats } from "./adp-auction-fold";

/**
 * What a player *costs* in the auctions this app has crawled, as a share of the
 * budget those rooms were spending.
 *
 * **A second market beside the ADP, not a second spelling of it.** A snake
 * draft's answer to "how much is this player worth" is an ordinal — pick 3 —
 * and an auction's is cardinal: 58% of what a manager had to spend. The two are
 * genuinely different information, and the second is the one that says whether
 * the consensus 1.01 is a little ahead of the 1.02 or twice the price of him.
 *
 * **The population is the board's, minus the one filter it cannot honour.**
 * Every league rule, the season, the window, the round bounds and the draft
 * statuses all apply exactly as they do to the ADP beside it, so the two numbers
 * on a row describe the same slice of the corpus. What it does *not* inherit is
 * `draft_types`: the board is never averaged over auctions (their `pick_no` is
 * nomination order, so their "ADP" is not one), so a column that honoured that
 * list would be an em dash for every reader on every board — which is the
 * failure this codebase has already paid for once, a fallback firing always
 * being indistinguishable from a feature that works. The scope is
 * `DraftTypeScope`'s `"auction"`, so the override is one named argument at one
 * call site rather than a second copy of `draftSelection`.
 *
 * It is split per league-type board for the reason everything else here is: a
 * dynasty startup auction and a redraft auction are two markets, and 58% in one
 * is not 58% in the other. `min_picks` gates it per board, the same control and
 * the same meaning — one buy is not an average.
 */

/** How many auctions each board's share is averaged over, and the players'. */
export type AuctionSpendResult = {
  redraft_auctions: number;
  dynasty_auctions: number;
  /** Player id → his share on each board; absent where neither board can average him. */
  values: Map<string, AdpAuctionBoards>;
};

/**
 * A player the crawled auctions never bought, or never bought often enough.
 *
 * One frozen object rather than a literal per row: it is what most of a page
 * gets, and it is what the payload sends — an em dash on both boards, which is
 * a different claim from cheap. Frozen because every row that has no auction
 * reading shares this one instance.
 */
export const EMPTY_AUCTION_BOARDS: AdpAuctionBoards = Object.freeze({
  redraft: null,
  dynasty: null,
});

/**
 * The auction population as a CTE, carrying the two facts an aggregate above it
 * needs about a *draft*: which board it counts into, and what a manager in it had
 * to spend.
 *
 * `AS MATERIALIZED` at both call sites, for the reason spelled out on
 * `matchedDraftsSql`: Postgres inlines a CTE referenced once, which would push a
 * JSONB extraction, a regex and a cast into every `FILTER` of every aggregate
 * standing on it — a fact about a draft recomputed once per pick per aggregate.
 */
const matchedAuctionsSql = (where: string) => `
    SELECT d.draft_id,
           ${DYNASTY_BOARD_SQL} AS dynasty,
           ${AUCTION_BUDGET_SQL} AS budget
      FROM drafts d
      JOIN leagues l ON l.league_id = d.league_id
     WHERE ${where}`;

/**
 * One page's auction spend, cached and coalesced per process.
 *
 * Keyed on the statement rather than on the filters, exactly as
 * `getDraftAdpForPlayers` is and for the same reason: the answer is a pure
 * function of the generated `where`, its bound params, the gate and the ids, and
 * a key naming anything less serves one page's shares under another's filters.
 * The ids go in verbatim rather than digested — a hash trades a silent collision
 * for a shorter key, and a collision here is one board's prices on another's
 * rows.
 */
const auctionCache = new TtlPromiseCache<AuctionSpendResult>(ADP_AUCTION_CACHE);

export async function getDraftAuctionSpend(
  filters: AdpFilters,
  playerIds: readonly string[],
): Promise<AuctionSpendResult> {
  // Sorted as well as deduped, so two callers whose pages differ only in the
  // order they enumerated them share one entry rather than aggregating twice.
  const ids = [...new Set(playerIds.filter((id) => id && id !== "0"))].sort();
  const { where, params } = draftSelection(filters, "auction");

  const cacheKey = JSON.stringify([where, params, filters.min_picks, ids]);
  // Admitted on the same terms as the two boards it rides beside — the limiter
  // wraps the loader, so a cached page never queues behind a cold one.
  return auctionCache.read(cacheKey, () =>
    adpComputeAdmission.run(() => computeAuctionSpend(filters, ids, where, params)),
  );
}

async function computeAuctionSpend(
  filters: AdpFilters,
  ids: readonly string[],
  where: string,
  params: readonly unknown[],
): Promise<AuctionSpendResult> {
  const matched = matchedAuctionsSql(where);
  const counts = await countMatchedAuctions(matched, [...params]);

  const total = counts.redraft_auctions + counts.dynasty_auctions;
  // **The one failure this read cannot tell from working**, said out loud.
  // Every number here rests on `settings.budget`, which is a key in an
  // unversioned blob: if Sleeper ever stopped sending it, every share would be
  // null and the column would read exactly like a corpus with no auctions in it.
  // The counts on the wire are of *matched* auctions rather than priceable ones
  // precisely so the two are distinguishable, and this is the line that says so
  // in a log rather than leaving it to whoever notices the em dashes.
  if (total > 0 && counts.priced_auctions === 0) {
    console.warn(
      `[adp] ${total} auction draft(s) matched and none carries a readable settings.budget — auction shares will be empty`,
    );
  }

  if (total === 0 || counts.priced_auctions === 0 || ids.length === 0) {
    return {
      redraft_auctions: counts.redraft_auctions,
      dynasty_auctions: counts.dynasty_auctions,
      values: new Map<string, AdpAuctionBoards>(),
    };
  }

  const rowParams = [...params];
  const bind = (value: unknown) => `$${rowParams.push(value)}`;
  const idsBind = bind(ids);
  const minPicks = bind(filters.min_picks);

  const { rows } = await pool.query<AuctionBoardColumns & { player_id: string }>(
    // `buys` is materialized for the same reason `matched_auctions` is: it is
    // referenced once, so Postgres would inline it and evaluate the amount's
    // extraction, regex, cast and division inside all eight aggregates above.
    `WITH matched_auctions AS MATERIALIZED (${matched}),
     buys AS MATERIALIZED (
       SELECT dp.player_id,
              ma.dynasty,
              (${AUCTION_AMOUNT_SQL} / ma.budget * 100) AS share
         FROM draft_picks dp
         JOIN matched_auctions ma ON ma.draft_id = dp.draft_id
        WHERE dp.player_id = ANY(${idsBind}::varchar[])
          AND ma.budget > 0
          AND ${AUCTION_AMOUNT_SQL} IS NOT NULL
     )
     SELECT b.player_id,
            ${auctionBoardAggregates("redraft")},
            ${auctionBoardAggregates("dynasty")}
       FROM buys b
      GROUP BY b.player_id
     HAVING count(*) FILTER (WHERE NOT b.dynasty) >= ${minPicks}
         OR count(*) FILTER (WHERE b.dynasty) >= ${minPicks}`,
    rowParams,
  );

  const values = new Map<string, AdpAuctionBoards>();
  for (const row of rows) {
    values.set(row.player_id, {
      redraft: auctionStats(row, "redraft", filters.min_picks),
      dynasty: auctionStats(row, "dynasty", filters.min_picks),
    });
  }
  return {
    redraft_auctions: counts.redraft_auctions,
    dynasty_auctions: counts.dynasty_auctions,
    values,
  };
}

type AuctionCounts = {
  redraft_auctions: number;
  dynasty_auctions: number;
  /** Of those, the ones whose budget could be read — a diagnostic, not a wire field. */
  priced_auctions: number;
};

async function countMatchedAuctions(
  matched: string,
  params: unknown[],
): Promise<AuctionCounts> {
  const { rows } = await pool.query<AuctionCounts>(
    `SELECT (count(*) FILTER (WHERE NOT ma.dynasty))::int AS redraft_auctions,
            (count(*) FILTER (WHERE ma.dynasty))::int AS dynasty_auctions,
            (count(*) FILTER (WHERE ma.budget > 0))::int AS priced_auctions
       FROM (${matched}) ma`,
    params,
  );
  return (
    rows[0] ?? { redraft_auctions: 0, dynasty_auctions: 0, priced_auctions: 0 }
  );
}


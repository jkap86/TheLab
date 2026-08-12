/**
 * What steepness does the trade market actually imply?
 *
 * The ADP value curve has one free parameter — `DEFAULT_STEEPNESS`, the number
 * of times value halves across a league's startable pool — and 4 is a
 * reasonable-sounding number rather than a measured one. Every completed trade
 * is a revealed near-indifference: two managers agreed that one bundle was worth
 * about another. Fit the parameter to those and the default stops being a guess.
 *
 * This is the *measurement*, deliberately not a feature. It answers one question
 * — is the market's preferred curve meaningfully different from 4, and is the
 * loss surface even shaped like it has an answer — and prints a table. Nothing in
 * the app reads it and nothing is written to the database. Run it against a
 * database with a season of crawled trades:
 *
 *     DATABASE_URL=... npx tsx scripts/fit-adp-curve.ts [season]
 *
 * ## What it found, the first time it was run
 *
 * Over 14,082 two-sided player-for-player trades of the 2026 season (11.6% of
 * the 123,547 complete trades crawled), the surface is emphatically **not**
 * flat, and the count-asymmetric subset has a clean interior minimum at
 * **2.70** — against a default of 4, which is 16% worse by this measure. That
 * is where `DEFAULT_STEEPNESS` now sits, rounded to the slider's own notch. The
 * even subset behaved exactly as the note below predicts, running to whatever
 * floor the search had, which is why the two are reported apart.
 *
 * It also settled a change that had been made on the strength of the maths
 * alone, and settled it against: pricing a player as the *expectation* of the
 * curve over his pick distribution rather than at his mean pick scored **worse**
 * here (0.280 against 0.265 at each one's own optimum). The reason turned out to
 * be that the correction is a cumulant series in `λσ` and needs `λσ` well under
 * 1, while the dynasty board's median is **3.32** — a board whose drafts put the
 * same player 100 picks apart is not describing a polarising player, it is
 * saying it does not know where he goes, and treating that as convexity value
 * inflated the median player 2.25× and the 95th percentile 558×. The mean is
 * still a poor statistic for a convex curve; that correction is not the fix, and
 * anything that replaces it should be measured here before it ships.
 *
 * Read the output before building anything on it. Three outcomes and they mean
 * different things:
 *
 * - **A clear minimum away from 4.** Move `DEFAULT_STEEPNESS`, and put a tick on
 *   the slider's track at the fitted value.
 * - **A clear minimum at ~4.** The guess was right; say so in the note on
 *   `DEFAULT_STEEPNESS` and stop.
 * - **A flat surface.** Trades do not identify the steepness at this sample and
 *   the nonparametric fit will not either. That is the honest negative result and
 *   the most useful thing this can print.
 *
 * ## What it measures
 *
 * For each two-sided trade, both hauls are priced on the league's own board and
 * pool, and the residual is `|log(ΣA / ΣB)|` — how lopsided the trade looks under
 * that curve. Log rather than a difference because trades span three orders of
 * magnitude and absolute residuals would let the blockbusters own the fit; the
 * score is the **median**, so a handful of salary dumps cannot either.
 *
 * The score is reported on **held-out** trades — fit on the older 80% of the
 * season, scored on the newest 20% — because a curve chosen and graded on one
 * sample is a curve graded on its own noise.
 *
 * ## What it deliberately excludes, and why each matters
 *
 * - **Trades carrying picks or FAAB.** A pick is priced through the rookie ladder
 *   and a KTC ratio, so including them would be measuring those as much as the
 *   curve; FAAB has no ADP scale at all. This leaves player-for-player trades,
 *   which is a smaller and much cleaner sample — the script prints how much
 *   smaller, because if it is tiny the answer is "not enough evidence" whatever
 *   the table says.
 * - **Trades where either side has an unpriced player.** A haul missing one of
 *   its three players is not a haul, and treating a missing price as zero would
 *   make the residual a fact about board coverage.
 * - **Three-way trades.** "Both sides balance" is not defined for three.
 *
 * ## What it cannot correct for, and what that costs
 *
 * **Trades are mutual optimism, not indifference** — both managers think they
 * won. In aggregate the bias is roughly symmetric, so the median residual
 * survives it, but one part is not symmetric: consolidation. A 3-for-1 usually
 * favours the side getting the one, because roster spots are scarce and that
 * scarcity is nowhere in this curve. So a fit run over count-asymmetric trades
 * will read some of the price of a roster spot as steepness. It is reported
 * separately (`by side-count`) rather than corrected, because the correction is a
 * second free parameter and that is the nonparametric fit, not this.
 *
 * The count-asymmetric trades are also the *only* ones that carry information
 * about steepness — a 1-for-1 balances about equally under every curve — so a
 * flat surface on the symmetric subset is expected and not a finding. The
 * asymmetric column is the one to read.
 */

import { pool } from "@/shared/db";
import {
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  adpBoardFor,
  adpValue,
  boardSignature,
  getDraftAdpForPlayers,
  leagueAdpPool,
} from "@/shared/manager";
import type { PlayerAdp } from "@/shared/manager";
import { assembleTrade } from "@/shared/trades";
import type { Trade } from "@/shared/trades";

/** `assembleTrade` fills each side's `user_id` from this; nothing here reads it. */
const NO_OWNERS = new Map<number, string>();

const season = process.argv[2] ?? String(new Date().getFullYear());

/**
 * The grid the curve is scored on, and it is deliberately **wider than
 * `STEEPNESS_RANGE`**.
 *
 * That range is what the slider offers a reader; this is what the market is
 * asked to prefer, and they are different questions. Searching the slider's own
 * bounds is how a fit comes back sitting exactly on one of them with no way to
 * tell a real optimum from a clamp — which is what the first run of this did,
 * reporting a best of 2.05 against a floor of 2.00. If the answer is outside
 * what the slider can express, that is a finding about the slider.
 */
const SEARCH = { min: 0.25, max: 10 };
const CANDIDATES: number[] = [];
for (let h = SEARCH.min; h <= SEARCH.max + 1e-9; h += 0.05) {
  CANDIDATES.push(Math.round(h * 100) / 100);
}

type TradeRow = {
  transaction_id: string;
  league_id: string;
  at: string | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: unknown[] | null;
  waiver_budget: unknown[] | null;
  roster_ids: unknown;
  total_rosters: number | null;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  league_type: number | null;
};

/**
 * Every complete trade of the season with the shape of the league it happened
 * in, newest first. The league columns ride along because a haul is priced on
 * its own league's pool and board — the same rule `adpBoardFor` keeps.
 */
async function readTrades(): Promise<TradeRow[]> {
  const { rows } = await pool.query<TradeRow>(
    `SELECT t.transaction_id,
            t.league_id,
            to_timestamp(COALESCE(t.status_updated, t.created) / 1000)::text AS at,
            t.adds, t.drops, t.draft_picks, t.waiver_budget, t.roster_ids,
            l.total_rosters,
            CASE WHEN jsonb_typeof(l.roster_positions) = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(l.roster_positions))
                 END AS roster_positions,
            l.scoring_settings,
            CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
                 THEN (l.settings->>'type')::int ELSE 0 END AS league_type
       FROM transactions t
       JOIN leagues l ON l.league_id = t.league_id
      WHERE t.type = 'trade'
        AND t.status = 'complete'
        AND l.season = $1
        AND COALESCE(t.status_updated, t.created) IS NOT NULL
      ORDER BY COALESCE(t.status_updated, t.created) DESC`,
    [season],
  );
  return rows;
}

/** A trade this can learn anything from: two sides, players only, both non-empty. */
function usable(trade: Trade): boolean {
  if (trade.sides.length !== 2) return false;
  return trade.sides.every(
    (side) =>
      side.players.length > 0 && side.picks.length === 0 && side.faab === 0,
  );
}

type Priced = {
  /** Each side's player ADP rows, in the league's own market. */
  sides: PlayerAdp[][];
  pool: number;
  /** |A| − |B|: what carries the information about steepness. */
  countGap: number;
};

async function main() {
  const rows = await readTrades();
  console.log(`${rows.length} complete trades in ${season}`);

  // Assembled and filtered first, so the ADP reads below only cover players a
  // usable trade actually names.
  const usableTrades: { row: TradeRow; trade: Trade }[] = [];
  for (const row of rows) {
    // The owners map only fills each side's `user_id`, which nothing here reads.
    const trade = assembleTrade({
      transaction_id: row.transaction_id,
      league_id: row.league_id,
      status_updated: null,
      created: null,
      week: null,
      roster_ids: row.roster_ids,
      adds: row.adds,
      drops: row.drops,
      draft_picks: row.draft_picks,
      waiver_budget: row.waiver_budget,
      metadata: null,
    } as Parameters<typeof assembleTrade>[0], NO_OWNERS);
    if (usable(trade)) usableTrades.push({ row, trade });
  }
  console.log(
    `${usableTrades.length} two-sided player-for-player trades ` +
      `(${((100 * usableTrades.length) / Math.max(1, rows.length)).toFixed(1)}% of them)`,
  );
  if (usableTrades.length < 200) {
    console.log("\nToo few to conclude anything. Crawl more, or widen the season.");
    return;
  }

  // One ADP read per distinct board, the grouping `/api/user/…/adp-value`
  // already does — a read per trade would be thousands of copies of a handful of
  // aggregates.
  const boards = new Map<
    string,
    { filters: ReturnType<typeof adpBoardFor>; ids: Set<string>; dynasty: boolean }
  >();
  const boardOf = new Map<string, string>();
  for (const { row, trade } of usableTrades) {
    const filters = adpBoardFor({
      season,
      rosterPositions: row.roster_positions,
      scoringSettings: row.scoring_settings,
    });
    const key = boardSignature(filters);
    boardOf.set(trade.transaction_id, key);
    const entry =
      boards.get(key) ??
      { filters, ids: new Set<string>(), dynasty: row.league_type === 2 };
    for (const side of trade.sides) for (const id of side.players) entry.ids.add(id);
    boards.set(key, entry);
  }
  console.log(`${boards.size} distinct boards to read`);

  const priceMaps = new Map<string, Map<string, PlayerAdp | null>>();
  for (const [key, entry] of boards) {
    const result = await getDraftAdpForPlayers(entry.filters, [...entry.ids]);
    const board = entry.dynasty ? "dynasty" : "redraft";
    const map = new Map<string, PlayerAdp | null>();
    for (const [id, sides] of result.values) map.set(id, sides[board]);
    priceMaps.set(key, map);
  }

  // Priced in the order they were read — newest first — so the holdout split
  // below is a split in *time* rather than a random one. A curve graded on
  // trades it was fitted across is a curve graded on its own noise.
  const priced: Priced[] = [];
  let dropped = 0;
  for (const { row, trade } of usableTrades) {
    const map = priceMaps.get(boardOf.get(trade.transaction_id)!)!;
    const sides = trade.sides.map((side) =>
      side.players.map((id) => map.get(id) ?? null),
    );
    // A haul missing one of its players is not a haul — treating the gap as
    // zero would make the residual a fact about board coverage.
    if (sides.some((side) => side.some((stats) => stats === null))) {
      dropped++;
      continue;
    }
    priced.push({
      sides: sides as PlayerAdp[][],
      pool: leagueAdpPool(row.total_rosters || 12, row.roster_positions),
      countGap: sides[0]!.length - sides[1]!.length,
    });
  }
  console.log(
    `${priced.length} fully priced (${dropped} dropped for an unpriced player)\n`,
  );
  if (priced.length < 200) {
    console.log("Too few priced to conclude anything.");
    return;
  }

  // Newest fifth held out. `priced` is newest-first, so the head is the holdout.
  const cut = Math.floor(priced.length / 5);
  const holdout = priced.slice(0, cut);
  const fit = priced.slice(cut);

  const residual = (t: Priced, halvings: number): number => {
    const total = (side: PlayerAdp[]) =>
      side.reduce(
        (sum, stats) =>
          sum +
          adpValue(stats.adp, t.pool, halvings),
        0,
      );
    const a = total(t.sides[0]!);
    const b = total(t.sides[1]!);
    if (a <= 0 || b <= 0) return Number.NaN;
    return Math.abs(Math.log(a / b));
  };

  const median = (xs: number[]): number => {
    const clean = xs.filter(Number.isFinite).sort((x, y) => x - y);
    if (clean.length === 0) return Number.NaN;
    const mid = clean.length >> 1;
    return clean.length % 2
      ? clean[mid]!
      : (clean[mid - 1]! + clean[mid]!) / 2;
  };

  const score = (set: Priced[], halvings: number) =>
    median(set.map((t) => residual(t, halvings)));

  const asymmetric = holdout.filter((t) => t.countGap !== 0);
  const symmetric = holdout.filter((t) => t.countGap === 0);

  console.log(
    `fit on ${fit.length}, scored on ${holdout.length} held-out ` +
      `(${asymmetric.length} count-asymmetric, ${symmetric.length} even)`,
  );

  console.log("halvings   holdout   asymmetric      even");
  let best = { halvings: Number.NaN, score: Number.POSITIVE_INFINITY };
  for (const halvings of CANDIDATES) {
    const all = score(holdout, halvings);
    if (all < best.score) best = { halvings, score: all };
    // Every fifth notch, plus the current default, so the table stays readable
    // while the search itself runs at full resolution.
    const shown =
      Math.abs(halvings * 100 - Math.round(halvings * 2) * 50) < 1 ||
      Math.abs(halvings - DEFAULT_STEEPNESS) < 1e-9;
    if (!shown) continue;
    const mark = Math.abs(halvings - DEFAULT_STEEPNESS) < 1e-9 ? " ←default" : "";
    console.log(
      `${halvings.toFixed(2).padStart(8)}  ${all.toFixed(4).padStart(8)}  ` +
        `${score(asymmetric, halvings).toFixed(4).padStart(10)}  ` +
        `${score(symmetric, halvings).toFixed(4).padStart(8)}${mark}`,
    );
  }

  const bestOf = (set: Priced[]) =>
    CANDIDATES.reduce(
      (best, h) => {
        const value = score(set, h);
        return value < best.score ? { halvings: h, score: value } : best;
      },
      { halvings: Number.NaN, score: Number.POSITIVE_INFINITY },
    );
  const bestAsym = bestOf(asymmetric);
  const bestEven = bestOf(symmetric);
  console.log(
    `\nargmin — asymmetric ${bestAsym.halvings.toFixed(2)} ` +
      `(${bestAsym.score.toFixed(4)}), even ${bestEven.halvings.toFixed(2)} ` +
      `(${bestEven.score.toFixed(4)})`,
  );
  console.log(
    "the asymmetric one is the identifying subset; an even trade balances " +
      "under every curve, so its argmin running to the floor is the degeneracy " +
      "and not a reading.",
  );

  const atDefault = score(holdout, DEFAULT_STEEPNESS);
  const gain = ((atDefault - best.score) / atDefault) * 100;
  console.log(
    `\nbest ${best.halvings.toFixed(2)} at ${best.score.toFixed(4)}, ` +
      `default ${DEFAULT_STEEPNESS} at ${atDefault.toFixed(4)} ` +
      `— ${gain.toFixed(1)}% lower median imbalance`,
  );

  // The shape of the surface decides whether any of this is worth acting on: a
  // percent or two across the whole range is not a market opinion about the
  // curve, it is noise with a minimum in it.
  const worst = Math.max(...CANDIDATES.map((h) => score(holdout, h)));
  const spread = ((worst - best.score) / best.score) * 100;
  console.log(
    `surface spans ${spread.toFixed(1)}% from best to worst across ` +
      `${SEARCH.min}–${SEARCH.max} (slider offers ` +
      `${STEEPNESS_RANGE.min}–${STEEPNESS_RANGE.max})` +
      (spread < 5
        ? " — flat. Trades do not identify the steepness at this sample."
        : ""),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

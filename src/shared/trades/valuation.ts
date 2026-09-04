import type {
  KtcFormat,
  MetricRank,
  Trade,
  TradeAssetPrice,
  TradeAssetValue,
  TradePickAsset,
  TradeValueSources,
} from "@/shared/contract";

// Every runtime import here is relative and carries its extension, because this
// module must resolve under Node's own test runner: the whole of it is
// arithmetic over numbers a caller supplies, and the decisions in it — which
// population an asset is ranked against, which absences are zeroes and which
// are not — are exactly the kind that render perfectly while being untrue.
// None of the four reaches Postgres or the network.
import { resolveKtcFormat } from "../ktc/board-choice.ts";
import { ktcPickPrice, pickTier } from "../ktc/picks.ts";
import type { KtcPickPrice, KtcPickTier } from "../ktc/picks.ts";
import { ktcBoardValue } from "../ktc/roster.ts";
import {
  DEFAULT_STEEPNESS,
  adpEntryValue,
  leagueAdpPool,
} from "../manager/adp-value.ts";
import type { AdpEntry } from "../manager/adp-value.ts";
import { scoreStatLine } from "../projections/score.ts";
import { assetKey } from "./asset-keys.ts";
import { draftOrderKey } from "./pick-slots.ts";

/**
 * What every asset on a page of trades is worth, on each of the board's three
 * bases, and where it places among the priced assets of its own league.
 *
 * **The rank is the whole reason this is a server-side module.** A value is a
 * lookup and the client could do it; a *rank* is a statement about a
 * population, and the population is the league — every player its rosters hold
 * and every cell of its pick grid — where the browser holds only the page of
 * trades it has scrolled to. Computed there, the colour on a card would say
 * "third-best asset among the fourteen currently on screen", which is a
 * different sentence and a false one.
 *
 * **One universe per league per basis, and the asset's own figure is in it.**
 * The population is the league's rostered players unioned with the players this
 * page's trades name, because a traded player may since have been dropped and
 * is still one of the things that league priced. Without the union an asset
 * could rank `of + 1` and the meter would run past its own track.
 *
 * **Three bases, and only one of them prices a pick.** Draft capital has no
 * pick ladder in this repo (`ktcPickDiscount` is unported and arrives with
 * `/api/adp`) and a pick has no rest-of-season projection because it is not a
 * player yet, so both answer null and the card draws an em dash. That is the
 * honest reading rather than a gap: a zero there would say a 2027 first is
 * worth nothing.
 *
 * **A league that cannot anchor a basis is left off it entirely rather than
 * given a degenerate one.** A league with no stored size cannot anchor the ADP
 * curve — `leagueAdpPool` would hand back a pool of zero — and a league with no
 * stored scoring cannot score a stat line, which `scoreStatLine` would answer
 * as a flat zero for every player in it. Both are the same claim in different
 * clothes, and both read here as "not priced".
 *
 * The percentile itself is deliberately **not** computed here; see
 * {@link TradeAssetPrice} for why a `{rank, of}` crosses the wire instead.
 */
export function readTradeValues(input: TradeValuationInput): {
  assetValues: Record<string, TradeAssetValue>;
  values: TradeValueSources;
} {
  const byLeague = groupAssetsByLeague(input.trades);
  const assetValues: Record<string, TradeAssetValue> = {};

  for (const [leagueId, assets] of byLeague) {
    const league = input.leagues.get(leagueId);
    // A league with no stored row prices nothing rather than being guessed at
    // as a 1QB league of unknown size — the read is cached, so a miss means the
    // league genuinely is not stored.
    if (!league) continue;

    const capital = capitalLens(league, input.adp, assets.players, input.rosters.get(leagueId));
    const ros = rosLens(league, input.projections, assets.players, input.rosters.get(leagueId));
    const ktc: Record<KtcFormat, Lens<TradePickAsset> | null> = {
      dynasty: ktcLens(
        leagueId,
        league,
        input.markets.dynasty,
        input.orders,
        assets,
        input.rosters.get(leagueId),
      ),
      redraft: ktcLens(
        leagueId,
        league,
        input.markets.redraft,
        input.orders,
        assets,
        input.rosters.get(leagueId),
      ),
    };

    for (const id of assets.players) {
      assetValues[assetKey(leagueId, id)] = {
        capital: capital?.price(id) ?? null,
        ros: ros?.price(id) ?? null,
        ktc: {
          dynasty: ktc.dynasty?.playerPrice?.(id) ?? null,
          redraft: ktc.redraft?.playerPrice?.(id) ?? null,
        },
      };
    }
    for (const pick of assets.picks.values()) {
      assetValues[assetKey(leagueId, pick)] = {
        // Named rather than silently absent: a pick is priced on KeepTradeCut
        // alone, and the two nulls are the module note's own rule.
        capital: null,
        ros: null,
        ktc: {
          dynasty: ktc.dynasty?.price(pick) ?? null,
          redraft: ktc.redraft?.price(pick) ?? null,
        },
      };
    }
  }

  return { assetValues, values: describeSources(input, byLeague) };
}

/** Everything the valuation reads, all of it already fetched by the route. */
export type TradeValuationInput = {
  trades: readonly Trade[];
  /**
   * The pricing facts for each league a page names — `getTradeLeagueMarkets`'
   * answer. A league absent from it prices nothing.
   */
  leagues: ReadonlyMap<string, TradeValuationLeague>;
  /** Each league's rostered players — `getTradeLeagueRosters`' answer. */
  rosters: ReadonlyMap<string, readonly string[]>;
  /** `draftOrderKey` → roster id → slot, from `getDraftSlots`. */
  orders: ReadonlyMap<string, ReadonlyMap<number, number>>;
  /** The season's two ADP populations, from `getSeasonDraftAdp`. */
  adp: { superflex: ReadonlyMap<string, AdpEntry>; standard: ReadonlyMap<string, AdpEntry> };
  /** The folded rest-of-season board, or empty where none could be read. */
  projections: TradeProjectionBoard;
  /** The week that board sums from; null where there is no span at all. */
  fromWeek: number | null;
  /** Both KeepTradeCut markets, each absent where it could not be read. */
  markets: Partial<Record<KtcFormat, TradeKtcMarket>>;
};

/** The pricing facts a league contributes — `TradeLeagueMarket`, structurally. */
export type TradeValuationLeague = {
  superflex: boolean;
  total_rosters: number;
  league_type: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  draft_rounds: number | null;
};

/**
 * The projections board, read structurally rather than imported — the same
 * arrangement `ktc/picks` makes of `KtcValue`, and for the same reason: the
 * wired reader of the real type reaches the network, and a type import from it
 * would be erased and still put this module on the wrong side of that line.
 *
 * `weeks` is the field that matters. **Empty means no projection at all**,
 * which is not a projected zero — the distinction the lineup solve already
 * seats by, applied here to decide whether a player is on this basis's board.
 */
export type TradeProjectionBoard = Readonly<
  Record<string, { stats: Record<string, number>; weeks: readonly number[] }>
>;

/** One KeepTradeCut market, structurally — `KtcBoards` without the `pg` import. */
export type TradeKtcMarket = {
  values: Readonly<Record<string, { sf: number | null; oneqb: number | null }>>;
  picks: Readonly<Record<string, KtcPickPrice>>;
  updated_at: string | null;
};

/** Every distinct asset one league's trades on this page name. */
type LeagueAssets = {
  players: Set<string>;
  /** Keyed by cell, so a pick traded twice on one page is one asset. */
  picks: Map<string, TradePickAsset>;
};

/** One basis, applied to one league: what an asset is worth and where it places. */
type Lens<A> = {
  price: (asset: A) => TradeAssetPrice | null;
  /** Only the KeepTradeCut lens prices both kinds; see the module note. */
  playerPrice?: (id: string) => TradeAssetPrice | null;
};

const pickCellKey = (pick: TradePickAsset): string =>
  `${pick.season}|${pick.round}|${pick.roster_id}`;

/**
 * The assets each league's trades name, deduplicated.
 *
 * Per league rather than per trade because a ranking is per league: two trades
 * in one league share a universe, and building it twice would be the same sort
 * run twice over the same numbers.
 */
function groupAssetsByLeague(
  trades: readonly Trade[],
): Map<string, LeagueAssets> {
  const out = new Map<string, LeagueAssets>();
  for (const trade of trades) {
    let assets = out.get(trade.league_id);
    if (!assets) {
      assets = { players: new Set(), picks: new Map() };
      out.set(trade.league_id, assets);
    }
    for (const side of trade.sides) {
      for (const id of side.players) assets.players.add(id);
      for (const pick of side.picks) assets.picks.set(pickCellKey(pick), pick);
    }
  }
  return out;
}

/**
 * Standard competition ranking against a fixed population: tied figures share
 * the better rank and the next distinct one skips — `MetricRank`'s own rule,
 * and the same one `placeAmong` applies client-side to a figure the server does
 * not rank.
 *
 * **Null in two cases and not one.** A population of fewer than two has no
 * spread to place anything in, and one where every figure is zero has nothing
 * to place them by: "1st of 12" among all-zero totals is a claim, which is
 * exactly why `LineupRanks` ships null for it rather than a rank. Both come
 * back null here and the card draws no colour and no meter.
 *
 * The population is sorted once and each figure binary-searched into it, so a
 * league's whole universe costs one sort rather than one scan per asset.
 */
function rankerFor(population: readonly number[]): (value: number) => MetricRank | null {
  const sorted = [...population].sort((a, b) => b - a);
  const of = sorted.length;
  const degenerate = of <= 1 || sorted.every((v) => v === 0);

  return (value) => {
    if (degenerate) return null;
    // The count of figures strictly greater, which is the rank less one.
    let lo = 0;
    let hi = of;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] > value) lo = mid + 1;
      else hi = mid;
    }
    return { rank: lo + 1, of };
  };
}

/**
 * The players a league's ranking is taken over: everyone it rosters, plus
 * everyone this page's trades name in it.
 *
 * The union is what keeps an asset inside its own population — see the module
 * note. A league with no stored rosters still ranks its traded players against
 * each other, which is thin but true, where an empty population would rank
 * nothing at all.
 */
function playerUniverse(
  traded: ReadonlySet<string>,
  rostered: readonly string[] | undefined,
): Set<string> {
  const out = new Set(traded);
  for (const id of rostered ?? []) out.add(id);
  return out;
}

/**
 * Draft capital: the ADP curve, anchored to this league's own startable pool.
 *
 * Null for a league with no stored size, because {@link leagueAdpPool} is teams
 * × starters and a pool of zero is not a curve — every player would collapse
 * onto the peak. That is the same reading `getTradeLeagueMarkets` gives a
 * `total_rosters` of 0: a row stored before the league answered, not a real
 * size.
 */
function capitalLens(
  league: TradeValuationLeague,
  adp: TradeValuationInput["adp"],
  traded: ReadonlySet<string>,
  rostered: readonly string[] | undefined,
): Lens<string> | null {
  if (league.total_rosters <= 0) return null;

  // The two populations an average can be pooled over, on the axis this league
  // reads — the same superflex predicate the KTC column is picked by.
  const board = league.superflex ? adp.superflex : adp.standard;
  const pool = leagueAdpPool(league.total_rosters, league.roster_positions);
  const priceOf = (id: string): number | null => {
    const entry = board.get(id);
    // A rookie entry is mapped onto the overall board before it is priced, so
    // one curve and one pool sit behind every figure — see `adpEntryValue`.
    return entry ? adpEntryValue(entry, pool, DEFAULT_STEEPNESS) : null;
  };

  const rank = rankerFor(
    [...playerUniverse(traded, rostered)].flatMap((id) => priceOf(id) ?? []),
  );
  return { price: (id) => priced(priceOf(id), rank) };
}

/**
 * Projected points, rest of season, under this league's own scoring.
 *
 * Null for a league with no stored scoring: `scoreStatLine` reads a null
 * scoring table as nothing scored and answers a flat zero, which would put
 * every player in that league on the same figure and rank none of them — an
 * all-zero population, which is precisely the state {@link rankerFor} refuses
 * to rank. Naming it here is the same answer arrived at honestly.
 *
 * A player the feed never mentioned, or mentioned with **no real week**, has no
 * projection rather than a zero one. That is the distinction `RosPlayerProjection`
 * documents and the solve already seats by: a projected zero is a player with a
 * game and nothing expected of him, where an empty `weeks` is a player the feed
 * has nothing to say about at all.
 */
function rosLens(
  league: TradeValuationLeague,
  projections: TradeProjectionBoard,
  traded: ReadonlySet<string>,
  rostered: readonly string[] | undefined,
): Lens<string> | null {
  const scoring = league.scoring_settings;
  if (!scoring) return null;

  const priceOf = (id: string): number | null => {
    const line = projections[id];
    if (!line || line.weeks.length === 0) return null;
    return scoreStatLine(line.stats, scoring);
  };

  const rank = rankerFor(
    [...playerUniverse(traded, rostered)].flatMap((id) => priceOf(id) ?? []),
  );
  return { price: (id) => priced(priceOf(id), rank) };
}

/**
 * KeepTradeCut, on one of its two markets: players and picks in one ranking.
 *
 * **One ranking over both**, because that is what the colour claims — where
 * this asset stands among everything the league could trade — and a pick is one
 * of those things. Splitting them would put a 2029 4th at the top of a
 * three-item pick ladder while the card beside it says it is worth 190.
 *
 * The pick population is the league's own grid rather than the picks this page
 * happens to name: every (season, round) the market prices, one entry per
 * roster, tiered by the draft order where that season's order is known and
 * untiered where it is not — which is most of them, since most picks on this
 * board are seasons out. Ownership never enters it, because who holds a cell
 * does not change what the league's picks are worth.
 *
 * Null where the market could not be read at all, which is the degradation the
 * whole board is written for: an unreadable market costs its own column and
 * never the page.
 */
function ktcLens(
  leagueId: string,
  league: TradeValuationLeague,
  market: TradeKtcMarket | undefined,
  orders: TradeValuationInput["orders"],
  assets: LeagueAssets,
  rostered: readonly string[] | undefined,
): Lens<TradePickAsset> | null {
  if (!market) return null;
  const { superflex, total_rosters } = league;

  const playerValue = (id: string): number | null =>
    ktcBoardValue(superflex, market.values[id]);

  /** The tier a roster's pick falls in, or null where the order is not set. */
  const tierFor = (season: string, rosterId: number): KtcPickTier | null => {
    const slot = orders.get(draftOrderKey(leagueId, season))?.get(rosterId);
    return slot === undefined ? null : pickTier(slot, total_rosters);
  };

  const pickValue = (pick: TradePickAsset): number | null => {
    const match = ktcPickPrice(
      market.picks,
      pick,
      tierFor(pick.season, pick.roster_id),
    );
    return match ? ktcBoardValue(superflex, match.price) : null;
  };

  const population: number[] = [];
  for (const id of playerUniverse(assets.players, rostered)) {
    const value = playerValue(id);
    if (value !== null) population.push(value);
  }
  for (const cell of pickGrid(league, market)) {
    const match = ktcPickPrice(
      market.picks,
      cell,
      tierFor(cell.season, cell.roster_id),
    );
    const value = match ? ktcBoardValue(superflex, match.price) : null;
    if (value !== null) population.push(value);
  }
  // A pick this page names in a season or round the grid does not cover — a
  // relic of a since-shrunk draft, or a market that has dropped that season
  // since the trade — still ranks against the population it is in.
  for (const pick of assets.picks.values()) {
    if (inGrid(league, market, pick)) continue;
    const value = pickValue(pick);
    if (value !== null) population.push(value);
  }

  const rank = rankerFor(population);
  return {
    price: (pick) => priced(pickValue(pick), rank),
    playerPrice: (id) => priced(playerValue(id), rank),
  };
}

/** A figure and its place, or nothing at all where there is no figure. */
function priced(
  value: number | null,
  rank: (value: number) => MetricRank | null,
): TradeAssetPrice | null {
  return value === null ? null : { value, rank: rank(value) };
}

/**
 * Every (season, round) the market prices, bounded by this league's own draft
 * depth — the seasons and rounds its pick market actually runs over.
 *
 * The depth is `settings.draft_rounds` where the league states one, because
 * future drafts are created from that setting and a market row deeper than it
 * names a pick this league will never hold. Where settings say nothing the
 * market's own depth is the bound, which is four: KTC prices no further.
 */
function marketRounds(
  league: TradeValuationLeague,
  market: TradeKtcMarket,
): { season: string; round: number }[] {
  const seen = new Set<string>();
  const out: { season: string; round: number }[] = [];
  for (const key of Object.keys(market.picks)) {
    const [season, roundText] = key.split("|");
    const round = Number(roundText);
    if (!season || !Number.isInteger(round) || round < 1) continue;
    if (league.draft_rounds !== null && round > league.draft_rounds) continue;
    const cell = `${season}|${round}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    out.push({ season, round });
  }
  return out;
}

/** The league's whole pick grid, one cell per roster per priced round. */
function pickGrid(
  league: TradeValuationLeague,
  market: TradeKtcMarket,
): { season: string; round: number; roster_id: number }[] {
  // No board to divide, and therefore no grid to lay: the same reading
  // `getTradeLeagueMarkets` gives a `total_rosters` of 0.
  if (league.total_rosters <= 0) return [];

  const out: { season: string; round: number; roster_id: number }[] = [];
  for (const { season, round } of marketRounds(league, market)) {
    for (let roster = 1; roster <= league.total_rosters; roster += 1) {
      out.push({ season, round, roster_id: roster });
    }
  }
  return out;
}

/** Whether {@link pickGrid} already holds this pick's own cell. */
function inGrid(
  league: TradeValuationLeague,
  market: TradeKtcMarket,
  pick: TradePickAsset,
): boolean {
  if (pick.roster_id < 1 || pick.roster_id > league.total_rosters) return false;
  return marketRounds(league, market).some(
    (cell) => cell.season === pick.season && cell.round === pick.round,
  );
}

/**
 * What answered on each basis, for the value panel to say so.
 *
 * `auto_board` is the one thing about KeepTradeCut this page still resolves
 * server-side, and it describes **the leagues on screen** rather than the
 * database: it moves as a reader scrolls into leagues of the other kind, which
 * is correct, because the word is a description of what the reader is looking
 * at. "mixed" is the honest name for a page no single market is true of — the
 * same word `ManagerLineupsPayload.ktc` uses for an account holding both kinds.
 */
function describeSources(
  input: TradeValuationInput,
  byLeague: ReadonlyMap<string, LeagueAssets>,
): TradeValueSources {
  const formats = new Set<KtcFormat>();
  for (const leagueId of byLeague.keys()) {
    const league = input.leagues.get(leagueId);
    if (league) formats.add(resolveKtcFormat("auto", league.league_type));
  }

  const read = input.markets.dynasty ?? input.markets.redraft;
  const players = new Set([
    ...input.adp.superflex.keys(),
    ...input.adp.standard.keys(),
  ]);

  return {
    ktc: read
      ? {
          auto_board:
            formats.size > 1 ? "mixed" : (([...formats][0] ?? "redraft") as KtcFormat),
          scraped_at: {
            dynasty: input.markets.dynasty?.updated_at ?? null,
            redraft: input.markets.redraft?.updated_at ?? null,
          },
        }
      : null,
    // Coverage follows the data, the same way the lineups route's fallback
    // board does: a season with no completed draft stored prices nobody, and
    // says so rather than shipping an empty board under a live-looking basis.
    capital: players.size > 0 ? { players: players.size } : null,
    ros: input.fromWeek === null ? null : { from_week: input.fromWeek },
  };
}

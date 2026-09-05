import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  KtcFormat,
  ManagerLineupsPayload,
} from "@/shared/contract";
import {
  getKtcBoards,
  isSuperflexLineup,
  ktcBoardValue,
  resolveKtcLineup,
} from "@/shared/ktc";
import type { KtcBoards } from "@/shared/ktc";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { AUTO_VARIANT, ktcVariantKey, parseKtcVariants } from "@/shared/ktc/columns";
import type { KtcVariant } from "@/shared/ktc/columns";
import {
  getManagerDraftAdp,
  getManagerLeagueRosters,
  solveLeagueEntry,
} from "@/shared/manager";
import type {
  KtcPricing,
  KtcVariantPricing,
  ManagerLeagueRow,
} from "@/shared/manager";
import { getRosProjections, restOfSeasonStart } from "@/shared/projections";
import type { RosProjections } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every league's rosters solved into rest-of-season lineups and the manager's
 * rank among them — one request for the whole page, like the leagues stream it
 * rides beside, because the projections span is shared across every league and
 * per-card requests would refetch nothing but re-enter everything. Every
 * stored roster is solved (a rank needs the other eleven), but only the
 * manager's lineup ships — see `manager/league-ranks`.
 *
 * The solve is projections first, draft capital second — see
 * `manager/ros-lineups` for the arithmetic. What this route decides is only
 * **which weeks are the rest of the season**, and it is deliberately
 * conservative about claiming any:
 *
 * - the page's season and Sleeper's current season agree → from the current
 *   week (floored at 1: preseason is week 0, and the season ahead is whole);
 * - the page is on an *older* season → there is no rest-of-season, and no
 *   projections are read at all;
 * - the state call failed or named some other future — week 1, the widest
 *   honest window.
 *
 * A failed projections span degrades the same way rather than failing the
 * route: `from_week: null` plus per-player null points is the fallback working,
 * and the reader can see which lens priced the page.
 *
 * **KeepTradeCut is the third valuation and the only one the reader steers**,
 * and they now steer it per column rather than per page. Every league is priced
 * on the market and QB board it reads for itself, which is what the nine base
 * ranks are computed on; `?ktc_boards=` then names the extra pricings the
 * reader's bays have *forced* — `dynasty:sf,redraft:auto` — and each becomes
 * four more ranks over the same solves, keyed by the same `lineupColumnKey` the
 * card looks them up by. Variants and not columns, because the ranks a column
 * reads are its variant's: a request naming the columns would make adding a ROS
 * tile cost a round trip.
 *
 * Every half of every token folds to `auto` when it cannot be read, on
 * `parseKtcBoardChoice`'s terms — the opposite call from `?season=`, and right
 * for the opposite reason. A failed board read degrades exactly as a failed
 * projections span does: no stamp for that market, every price on it null, and
 * its four metrics ranked null league-wide by the all-zero rule that already
 * exists.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }
  const userId = resolved.user.user_id;

  // Three states, not two, exactly as the leagues route reads it: `null` is
  // "not asked" and is the only one filled from the resolver.
  const url = new URL(request.url);
  const requested = parseRequestedSeason(url.searchParams.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const [leagues, adp] = await Promise.all([
      getManagerLeagueRosters(userId, season),
      getManagerDraftAdp(userId, season),
    ]);

    if (leagues.length === 0) {
      const empty: ManagerLineupsPayload = {
        season,
        from_week: null,
        ktc: [],
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    const fromWeek = await restOfSeasonStart(season, getNflState);
    let projections: RosProjections = {};
    let coveredFrom: number | null = null;
    if (fromWeek !== null) {
      try {
        projections = await getRosProjections(season, fromWeek);
        coveredFrom = fromWeek;
      } catch (error) {
        // The fallback's case, not the route's failure: every player prices on
        // draft capital and `from_week: null` says which lens answered.
        console.warn(`[lineups] projections unavailable for ${season}:`, error);
      }
    }

    const forced = parseKtcVariants(url.searchParams.get("ktc_boards"));
    const ktc = await readKtcMarkets(leagues, forced);

    const solved: ManagerLineupsPayload["leagues"] = {};
    for (const league of leagues) {
      // The ADP board still splits on the league's *own* lineup, and reads the
      // predicate directly rather than a column's choice: a forced QB board is
      // a KeepTradeCut reading, where draft capital is priced off the drafts
      // this league actually ran. Nothing about the seating moves when a bay is
      // switched — see the KTC columns' own note in `contract/lineups`.
      const board = isSuperflexLineup(league.roster_positions)
        ? adp.superflex
        : adp.standard;
      const entry = solveLeagueEntry(
        league,
        userId,
        season,
        projections,
        board,
        ktc.pricing(league, AUTO_VARIANT),
        forced.map(
          (variant): KtcVariantPricing => ({
            key: ktcVariantKey(variant),
            ...ktc.pricing(league, variant),
          }),
        ),
      );
      // A null entry means the store moved between the query and here — the
      // league drops out of the payload, as it always has for roster-less ones.
      if (entry) solved[league.league_id] = entry;
    }

    const payload: ManagerLineupsPayload = {
      season,
      from_week: coveredFrom,
      ktc: ktc.stamps,
      leagues: solved,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[lineups] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load lineups" };
    return NextResponse.json(payload, { status: 500 });
  }
}

/**
 * Every KeepTradeCut market this page's columns read, and the per-league
 * pricing drawn from them.
 *
 * **The formats are collected before anything is read**, so a page whose
 * columns all sit on `auto` over an all-redraft account costs one market's rows
 * rather than both. There are only ever two, so the loop is bounded by the enum
 * however many variants the reader has forced.
 *
 * The superflex axis is folded into two maps **per market rather than per
 * league**: which of KTC's two numbers a league reads is one of two answers,
 * and building a fresh map per league would be a hundred copies of the same
 * five hundred entries. A forced QB board therefore costs nothing at all — it
 * reads the other map that was already built.
 *
 * A market that fails to read is simply absent, and every league pointed at it
 * prices to null. That is the projections span's own degradation and for the
 * same reason: a valuation is an enhancement beside a list of leagues, and
 * failing the page over one would replace an answer with nothing.
 */
async function readKtcMarkets(
  leagues: readonly ManagerLeagueRow[],
  forced: readonly KtcVariant[],
): Promise<{
  stamps: ManagerLineupsPayload["ktc"];
  pricing: (league: ManagerLeagueRow, variant: KtcVariant) => KtcPricing;
}> {
  const formats = [
    ...new Set(
      leagues.flatMap((league) =>
        [AUTO_VARIANT, ...forced].map((variant) =>
          resolveKtcFormat(variant.format, league.league_type),
        ),
      ),
    ),
  ];

  const read = await Promise.all(
    formats.map(async (format) => {
      try {
        return [format, await getKtcBoards(format)] as const;
      } catch (error) {
        console.warn(`[lineups] KTC ${format} board unavailable:`, error);
        return [format, null] as const;
      }
    }),
  );

  const markets = new Map<KtcFormat, Market>();
  const stamps: { format: KtcFormat; updated_at: string | null }[] = [];
  for (const [format, boards] of read) {
    if (!boards) continue;
    markets.set(format, toMarket(boards));
    stamps.push({ format, updated_at: boards.updated_at });
  }

  return {
    stamps,
    pricing: (league, variant) => {
      const superflex = resolveKtcLineup(variant.lineup, league.roster_positions);
      const market = markets.get(
        resolveKtcFormat(variant.format, league.league_type),
      );
      if (!market) return { values: new Map(), picks: {}, superflex };
      return {
        values: superflex ? market.superflex : market.standard,
        picks: market.picks,
        superflex,
      };
    },
  };
}

/** One market, with its two QB boards already split out. */
type Market = {
  superflex: Map<string, number>;
  standard: Map<string, number>;
  picks: KtcBoards["picks"];
};

function toMarket(boards: KtcBoards): Market {
  const superflex = new Map<string, number>();
  const standard = new Map<string, number>();
  for (const [id, value] of Object.entries(boards.values)) {
    // Absent rather than zero on each board independently: KTC prices some
    // entries on one board and not the other, and a zero there would be a
    // price rather than the absence of one.
    const sf = ktcBoardValue(true, value);
    if (sf !== null) superflex.set(id, sf);
    const one = ktcBoardValue(false, value);
    if (one !== null) standard.set(id, one);
  }
  return { superflex, standard, picks: boards.picks };
}

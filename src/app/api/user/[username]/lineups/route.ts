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
import {
  AUTO_VARIANT,
  ktcVariantKey,
  parseAdpBoards,
  parseKtcVariants,
  parsePositionSets,
  parseSlotSets,
  parseTeamTotalKeys,
  qbBoardKeySuffix,
} from "@/shared/ktc/columns";
import type { KtcVariant } from "@/shared/ktc/columns";
import {
  getManagerDraftAdp,
  getManagerLeagueRosters,
  solveLeagueEntry,
} from "@/shared/manager";
import type {
  AdpVariant,
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
 *
 * **`?adp_boards=` is the same question one valuation over.** Draft capital has
 * no market — nobody publishes a second ADP — but the fold does split superflex
 * drafts from standard ones, so a capital column can force a QB board exactly
 * as a KeepTradeCut one can, and `sf,oneqb` names the boards the reader's bays
 * have forced. Boards and not columns, for `?ktc_boards=`' reason, and three
 * more ranks per board rather than a second solve: **the seating does not move
 * when a capital bay is switched**, which is the rule the KTC columns have
 * always had and the one this axis had to be held to rather than merely
 * observe — `adp_value` is a tiebreak inside the solve, so a forced board could
 * have re-seated the unprojected. The lineup on the card is the one the
 * league's own board seated, and every column ranks the manager on it.
 *
 * **`?positions=` is the third axis and travels on its own parameter** —
 * `qb+te,rb`, the distinct narrowings the reader's bays carry. Sets and not
 * columns, for `?ktc_boards=`' reason: a narrowing is a second way to *total*
 * lineups this route has already solved, so every metric of every set falls out
 * of the solves it was going to run anyway, and naming the columns instead
 * would make adding a tile cost a round trip. The two axes cross — a column can
 * force a board and narrow a position at once — and the key each rank is filed
 * under is exactly what `lineupColumnKey` writes on the card's side.
 *
 * **`?slots=` is the fourth axis and travels on its own parameter** —
 * `flex+super_flex,qb`, the distinct seat narrowings the reader's bays carry.
 * Sets and not columns for `?positions=`' reason, and crossed with them rather
 * than paired: the two are one intersection — a slot picks the seats and a
 * position picks who is sitting in them — so a column can narrow both ways at
 * once, and the key each rank is filed under is exactly what `lineupColumnKey`
 * writes on the card's side. Only a *starters* column can carry one, a seat
 * being a thing only a starting lineup has, which `column()` enforces on the
 * client and `lineupMetricTotals` answers honestly for anyway.
 *
 * **`?team_totals=` is not a fifth axis but a list of columns**, and it asks a
 * different question from the four above: those decide what the manager is
 * *ranked* on, where this decides which of the resulting columns ship a total
 * for **every roster** in the league. A rank answers a card's window and a
 * per-roster total answers a standings table, and only the second wants a
 * number per team. It names keys rather than axes precisely because it is
 * bounded by what a reader is looking at — one column, where the axes' cross
 * product across four bays is hundreds of sums a league.
 *
 * A token that cannot be read folds to the empty set and is dropped, on
 * `parsePositionSets`' terms: the column that named it loses its narrowing and
 * reads an em dash, and nothing else on the page moves. That is the same
 * degradation an unreadable `?ktc_boards=` has always had, and it is deliberate
 * that neither is a 400 — a narrowing nobody can read costs one window, where a
 * season nobody can read would put one year's page under another's heading.
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

    const forced = parseKtcVariants(url.searchParams.get("ktc_boards"));
    const narrowings = parsePositionSets(url.searchParams.get("positions"));
    const seats = parseSlotSets(url.searchParams.get("slots"));
    // **The one parameter that names columns rather than axes**, and it is a
    // different question from the four beside it: those say which pricings and
    // narrowings to *rank* the manager on, where this says which of the
    // resulting columns a caller will read across **every** roster. The teams
    // pane is what asks — its column picker offers the same six axes the card's
    // bays do, and a standings table narrowed to a seat or priced on a forced
    // market is a total per team that only this route can compute.
    //
    // It carries no axes of its own: a key names a pricing the four above must
    // already have asked for, or the route never composes it and the total is
    // simply absent. That is the client's job to keep true (see
    // `useManagerLineups`, which sends the teams column through both), and the
    // failure is an em dash on one column rather than a wrong number anywhere.
    const teamTotals = new Set(
      parseTeamTotalKeys(url.searchParams.get("team_totals")),
    );
    // The ADP aggregate is already split superflex/standard by
    // `getManagerDraftAdp`, so a forced board costs no read at all — it points
    // at the other half of one answer that was fetched before any of this.
    const adpBoards: AdpVariant[] = parseAdpBoards(
      url.searchParams.get("adp_boards"),
    ).map((lineup) => ({
      key: qbBoardKeySuffix(lineup),
      adp: lineup === "sf" ? adp.superflex : adp.standard,
    }));

    // **The two remaining reads are independent, so they run together.** Which
    // weeks are left in the season and what those weeks project is one chain —
    // the span decides the fetch — and it has nothing to do with which
    // KeepTradeCut markets this page's columns read, which is decided by the
    // leagues already in hand. Serialised, a cold request paid a Sleeper state
    // read, then a projections span, and only then went looking for the market;
    // the boards below are the same reads behind the same caches, started at
    // the same moment.
    //
    // Nothing else moves. Each branch keeps its own degradation — a failed
    // span still leaves `from_week: null` and a failed market is still simply
    // absent — and `restOfSeasonStart` still throws the route into its 500,
    // which `Promise.all` propagates exactly as the sequence did.
    const [ros, ktc] = await Promise.all([
      readRosProjections(season),
      readKtcMarkets(leagues, forced),
    ]);
    const { projections, coveredFrom } = ros;

    const solved: ManagerLineupsPayload["leagues"] = {};
    for (const league of leagues) {
      // **The solve reads the league's own board, whatever any bay has
      // forced**, and it reads the predicate directly rather than a column's
      // choice. That is what keeps a forced capital board a re-pricing rather
      // than a re-seating: `adp_value` is a tiebreak among the unprojected
      // inside `solveLeagueLineup`, so handing a forced board in here would
      // change which players a card *seats* to answer a question about what
      // they are worth. The forced boards travel separately, below.
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
        // Unresolved, and there is nothing to resolve: a position is a fact
        // about a player rather than a rule about a league, so the same set
        // means the same thing in every league on the page — which is what
        // makes one parameter answer for all hundred of them.
        narrowings,
        // Likewise page-wide, for a different reason: a forced ADP board names
        // one of the two aggregates outright, and the only league-specific part
        // of pricing off it — the pool the curve is anchored to — is computed
        // where the league is.
        adpBoards,
        // Unresolved for the position sets' reason and one grain further: a
        // slot is a seat in *this* league's own `roster_positions`, so a set
        // naming one no league on the page starts simply counts nobody there —
        // which is the honest answer and needs no rule of its own. The picker
        // never offers such a set, having built its keys from these very
        // leagues.
        seats,
        teamTotals,
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
 * The rest-of-season span and the projections that cover it.
 *
 * Extracted so it can be one arm of the `Promise.all` above rather than three
 * statements sitting in front of the market read. The two decisions inside are
 * unchanged and are the route's own: which weeks are left (see the route's
 * header for all three arms), and that a span nobody could fetch degrades to
 * `from_week: null` plus draft capital rather than failing the page.
 *
 * `restOfSeasonStart` is deliberately *not* caught — a state read that throws is
 * the route's 500, exactly as it was when this ran in sequence.
 */
async function readRosProjections(season: string): Promise<{
  projections: RosProjections;
  coveredFrom: number | null;
}> {
  const fromWeek = await restOfSeasonStart(season, getNflState);
  if (fromWeek === null) return { projections: {}, coveredFrom: null };
  try {
    return { projections: await getRosProjections(season, fromWeek), coveredFrom: fromWeek };
  } catch (error) {
    // The fallback's case, not the route's failure: every player prices on
    // draft capital and `from_week: null` says which lens answered.
    console.warn(`[lineups] projections unavailable for ${season}:`, error);
    return { projections: {}, coveredFrom: null };
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

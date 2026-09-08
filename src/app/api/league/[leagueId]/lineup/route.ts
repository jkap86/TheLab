import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  KtcBoardChoice,
  KtcBoardStamp,
  LeagueLineupPayload,
} from "@/shared/contract";
import { getKtcBoards, isSuperflexLineup, ktcBoardValue } from "@/shared/ktc";
import { parseKtcBoardChoice, resolveKtcFormat } from "@/shared/ktc/board-choice";
import {
  getLeagueLineupRow,
  lookupManagerDraftAdp,
  solveLeagueEntry,
} from "@/shared/manager";
import type { KtcPricing, ManagerLeagueRow } from "@/shared/manager";
import type { AdpEntry } from "@/shared/manager";
import { getRosProjections, restOfSeasonStart } from "@/shared/projections";
import type { RosProjections } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's rosters solved into rest-of-season lineups — the per-league
 * sibling of `/api/user/[username]/lineups`.
 *
 * **It exists because the trades board has no account to batch off.**
 * `/manager` knows whose page it is, so it asks for every league that manager
 * holds in one request and hands each card its own entry; the trades board is
 * `accountless` by construction and its leagues are whatever the loaded pages
 * mention, most of which the reader has no team in. So a trade card asks for
 * the one league it names, and only once a reader opens it — the same bargain
 * `/api/league/[leagueId]/timeline` already strikes one press further in.
 *
 * **It reads stored rows and fetches no league graph**, which keeps it inside
 * the same rule its two siblings under this prefix live by: `leagues`,
 * `rosters`, `traded_picks` and `drafts` are what the crawler and the manager
 * sync already wrote, and a league neither has reached comes back with
 * `entry: null` rather than being synced on demand. What it *does* reach
 * outward for is the three boards the lineups route reads — the projections
 * feed, the ADP the manager's drafts measure, the KTC market — every one of
 * them a cached read shared with that route rather than work of this one's.
 *
 * **The three narrowing parameters are the timeline route's, to the name.**
 * `?season=`, `?user=` and `?ktc_board=` are what decide which boards answer,
 * and a card's present priced on a different board from the past its own rail
 * scrubs to is not a comparison — it is two numbers on two rulers. A reader who
 * opens a card and drags its history is looking at one league through one lens,
 * so the two reads behind that have to be asked the same question.
 *
 * **`?user=` is optional and costs exactly the three capital metrics.** The ADP
 * fallback board is built from *that manager's* synced drafts, so a board-less
 * read ranks them null by the all-zero rule rather than pricing them off
 * nothing. It is also what decides whether any team is marked as the reader's:
 * a name that resolves to somebody holding a roster here marks it and ranks
 * them, and a name that resolves to somebody who does not — which on this board
 * is most leagues — solves every roster and marks none. See
 * `solveLeagueEntry`'s own note on why that is a solve rather than a null.
 *
 * A malformed `?season=` is a 400 on `parseRequestedSeason`'s own terms — a
 * season names *which data* this is about — while an unreadable `?ktc_board=`
 * falls back to `auto`, the opposite call for the opposite reason. An unknown
 * `?user=` is neither: the read answers without an ADP board rather than
 * failing a league over a name that is not this route's subject.
 *
 * **A league with nothing stored is not a 404.** It is a league this database
 * has not crawled, which is the `entry: null` above — the card draws "no
 * rosters read for this league yet" and the trade above it is unaffected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;
  const url = new URL(request.url);

  // Three states, not two, exactly as every other route reads it: `null` is
  // "not asked" and is the only one filled from the resolver.
  const requested = parseRequestedSeason(url.searchParams.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }

  try {
    const season = requested?.season ?? (await getActiveSeason());
    const board = parseKtcBoardChoice(url.searchParams.get("ktc_board"));
    const [league, managerUserId] = await Promise.all([
      getLeagueLineupRow(leagueId),
      resolveManager(url.searchParams.get("user")),
    ]);

    if (!league || league.rosters.length === 0) {
      const empty: LeagueLineupPayload = {
        season,
        from_week: null,
        ktc: [],
        entry: null,
      };
      return NextResponse.json(empty, { headers: CACHE });
    }

    const superflex = isSuperflexLineup(league.roster_positions);
    const [projections, adp, ktc] = await Promise.all([
      readProjections(season),
      readAdp(managerUserId, season, superflex),
      readKtc(league, board),
    ]);

    const payload: LeagueLineupPayload = {
      season,
      from_week: projections.fromWeek,
      ktc: ktc.stamp === null ? [] : [ktc.stamp],
      entry: solveLeagueEntry(
        league,
        managerUserId,
        season,
        projections.board,
        adp,
        ktc.pricing,
      ),
    };
    return NextResponse.json(payload, { headers: CACHE });
  } catch (error) {
    console.error(`[league] lineup failed for ${leagueId}:`, error);
    const body: ApiErrorPayload = { error: "Failed to load the league" };
    return NextResponse.json(body, { status: 500 });
  }
}

/**
 * The same minute the timeline route holds its own answer for, and for the same
 * reason: what a roster holds today moves as the syncs run, and the boards it is
 * priced on have TTLs of their own. A minute covers a reader closing a card and
 * opening it again.
 */
const CACHE = { "Cache-Control": "private, max-age=60" } as const;

/**
 * Whose ADP board this prices against, or null where the request named nobody
 * this app can resolve.
 *
 * **An unknown name is not an error here**, which is where this parts company
 * with every route whose *subject* is a manager — the timeline route's own rule,
 * verbatim, because this is the same question about the same league.
 */
async function resolveManager(username: string | null): Promise<string | null> {
  if (!username) return null;
  try {
    const resolved = await resolveManagerUser(username);
    return resolved.ok ? resolved.user.user_id : null;
  } catch {
    return null;
  }
}

/** The rest-of-season span, on the three readings the lineups route takes. */
async function readProjections(
  season: string,
): Promise<{ board: RosProjections; fromWeek: number | null }> {
  const fromWeek = await restOfSeasonStart(season, getNflState);
  if (fromWeek === null) return { board: {}, fromWeek: null };
  try {
    return { board: await getRosProjections(season, fromWeek), fromWeek };
  } catch (error) {
    // The fallback's case, not the route's failure: every player prices on
    // draft capital and `from_week: null` says which lens answered.
    console.warn(`[league] projections unavailable for ${season}:`, error);
    return { board: {}, fromWeek: null };
  }
}

/**
 * The manager's own ADP board, on the superflex axis this league reads.
 *
 * Empty where the request named no manager, which on this board is the ordinary
 * case rather than the edge: the board is a manager's by construction (see
 * `getManagerDraftAdp`), so there is no account-free version of it to fall back
 * to, and the three capital metrics rank null by the all-zero rule rather than
 * being priced off nothing.
 */
async function readAdp(
  managerUserId: string | null,
  season: string,
  superflex: boolean,
): Promise<ReadonlyMap<string, AdpEntry>> {
  if (managerUserId === null) return new Map();
  try {
    // The lineups route's own memo of `getManagerDraftAdp`, so a card opened
    // beside a manager page prices off the aggregate that page already ran.
    const boards = await lookupManagerDraftAdp(managerUserId, season);
    return superflex ? boards.superflex : boards.standard;
  } catch (error) {
    console.warn(`[league] ADP unavailable for ${season}:`, error);
    return new Map();
  }
}

/**
 * This league's own KeepTradeCut market and QB board, plus its rookie-pick rows.
 *
 * **One market, where the batched route collects both.** That route serves a
 * page whose four bays can force two markets deliberately; this one answers a
 * single league on the board the reader's `?ktc_board=` resolves to, so there is
 * exactly one format to read and no variants to price beside it. The card's
 * four KTC figures are printed rather than ranked against a forced board — see
 * the trade card, which resolves its own market for the *asset* values it
 * prints from the trades payload.
 *
 * A market that fails to read is simply absent and every player and pick prices
 * to null, which is the projections span's own degradation: a valuation is an
 * enhancement beside a table of rosters, and failing the read over one would
 * replace an answer with nothing.
 */
async function readKtc(
  league: ManagerLeagueRow,
  choice: KtcBoardChoice,
): Promise<{ pricing: KtcPricing; stamp: KtcBoardStamp | null }> {
  const format = resolveKtcFormat(choice, league.league_type);
  const superflex = isSuperflexLineup(league.roster_positions);

  let boards;
  try {
    boards = await getKtcBoards(format);
  } catch (error) {
    console.warn(`[league] KTC ${format} board unavailable:`, error);
    return { pricing: { values: new Map(), picks: {}, superflex }, stamp: null };
  }

  const values = new Map<string, number>();
  for (const [id, value] of Object.entries(boards.values)) {
    // Absent rather than zero: KTC prices some entries on one QB board and not
    // the other, and a zero there would be a price rather than the absence of
    // one.
    const priced = ktcBoardValue(superflex, value);
    if (priced !== null) values.set(id, priced);
  }

  return {
    pricing: { values, picks: boards.picks, superflex },
    stamp: { format, updated_at: boards.updated_at },
  };
}

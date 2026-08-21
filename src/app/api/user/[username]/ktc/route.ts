import { NextResponse } from "next/server";

import type { ManagerKtcPayload } from "@/shared/contract";
import {
  getKtcValuesBySleeperId,
  isSuperflexLineup,
  ktcBoardValue,
  rosterKtcValue,
} from "@/shared/ktc";
import {
  rankOf,
  readManagerOptimalLineups,
  readManagerSnapshot,
} from "@/shared/manager";
import { readOptional } from "@/shared/util";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerIdRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the manager's roster in each of their leagues is worth on KeepTradeCut,
 * and where its starter value ranks among their leaguemates — see
 * {@link ManagerKtcPayload}.
 *
 * One batch request rather than a value per league card, for the reason the
 * sibling `ranks` route is batched: the leagues page shows a hundred-plus
 * collapsed cards at once and a collapsed card costs no request of its own, so
 * the reads behind the chip are shared across every league instead of repeated
 * per card.
 *
 * Every team is priced and solved, not just the manager's. The card now carries
 * a starter-value *rank*, and a rank of one roster can't be known without the
 * others' starter values — so the earlier shortcut of dropping every other team
 * before the projections read is gone. It cost eleven answers nobody asked for
 * back when the card showed only the manager's own number; a rank is worth the
 * extra solve, and the aggregate lineup is the cheapest of the three batch
 * entry points — and is now solved once for the account and shared with the
 * ADP-value route beside it (see {@link readManagerOptimalLineups}).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerIdRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { username, userId, season } = resolved;

  try {
    return await ktcPayload(username, userId, season);
  } catch (error) {
    console.error("[ktc] query failed:", error);
    return readFailureResponse(error, "Failed to load KTC values");
  }
}

async function ktcPayload(username: string, userId: string, season: string) {
  // Sequential rather than parallel: which rosters to price is the answer to
  // the first read.
  //
  // Through the account's shared snapshot rather than straight at the query, so
  // this route, the ADP values and the projected ranks — the three requests a
  // default Manager load fires together — read the roster graph once between
  // them. `owned` is the `withOwn` filter this route used to apply for itself,
  // moved to where the lineups below are solved from it, so a starter value and
  // the lineup it sums cannot be computed over different populations. See
  // `shared/manager/manager-snapshot`.
  const { owned: withOwn } = await readManagerSnapshot(userId, season);

  if (withOwn.length === 0) {
    const empty: ManagerKtcPayload = {
      season,
      updated_at: null,
      weeks: [],
      // Nothing was asked of the solver and nothing failed: a manager holding no
      // roster is a real, complete answer, so this is `"ok"` rather than the
      // status of a read that never happened.
      lineups: "ok",
      leagues: {},
    };
    return NextResponse.json(empty);
  }

  // Every rostered player across every team, since every team is priced now.
  const playerIds = [
    ...new Set(
      withOwn.flatMap((league) => league.teams.flatMap((t) => t.players)),
    ),
  ].filter(Boolean);

  const [lineups, ktc] = await Promise.all([
    // The same lineup the expanded panel lists as Starters, so a chip and the
    // card it opens can't disagree about who starts. A projections read that
    // fails costs the split and the rank and not the value — pricing a roster
    // needs no projection, so the totals still answer.
    //
    // Guarded through `readOptional` rather than caught into a bare `null`: the
    // null was indistinguishable from a league with nothing left to project, so
    // the browser held a page of null splits as a fresh success for a quarter of
    // an hour. The degradation is unchanged; what is added is `lineups` on the
    // payload saying which of the two it is.
    //
    // **The identical solve the ADP-value route wants**, over the same rosters,
    // slots, scoring and horizon: a starter value is a sum over whoever starts,
    // and neither lens has any say in who that is. Two calls to
    // `getOptimalLineups` were two copies of it on the web process's own event
    // loop; the shared read is one, and the guarded failure is unchanged.
    readOptional(`[ktc] lineups for ${username}`, () =>
      readManagerOptimalLineups(userId, season),
    ),
    // Unguarded: the prices *are* this payload, so a KTC read that fails is the
    // request's failure and belongs to the route's own catch.
    getKtcValuesBySleeperId(playerIds),
  ]);

  const priced: ManagerKtcPayload["leagues"] = {};
  for (const league of withOwn) {
    const own = league.teams.find((t) => t.owner_id === userId)!;
    // Per league, because the board is: the same quarterback is worth one number
    // in a superflex league and another in a 1QB one.
    const superflex = isSuperflexLineup(league.roster_positions);

    // Every team's starter value, so the manager's can be ranked against them;
    // the manager's own full value is kept aside for the payload.
    const starterValue = new Map<number, number>();
    let ownValue = null as ReturnType<typeof rosterKtcValue> | null;
    for (const team of league.teams) {
      const values = new Map<string, number>();
      for (const id of team.players) {
        const board = ktcBoardValue(superflex, ktc.values[id]);
        if (board !== null) values.set(id, board);
      }
      const value = rosterKtcValue({
        players: team.players,
        starters:
          lineups.value?.lineups.get(league.league_id)?.get(team.roster_id) ??
          null,
        values,
      });
      if (value.split) starterValue.set(team.roster_id, value.split.starters);
      if (team.roster_id === own.roster_id) ownValue = value;
    }

    priced[league.league_id] = {
      superflex,
      ...ownValue!,
      starters_rank: rankOf(starterValue, own.roster_id),
    };
  }

  const payload: ManagerKtcPayload = {
    season,
    updated_at: ktc.updated_at,
    weeks: lineups.value?.weeks ?? [],
    lineups: lineups.status,
    leagues: priced,
  };
  return NextResponse.json(payload);
}

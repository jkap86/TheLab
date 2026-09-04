import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LineupCheckLeague,
  ManagerLineupCheckPayload,
} from "@/shared/contract";
import { getManagerWeekLineups, solveWeekLineup } from "@/shared/manager";
import {
  clampWeek,
  dayLockedPlayers,
  getWeekProjections,
  lockedPlayers,
  parseRequestedWeek,
} from "@/shared/projections";
import type { WeekProjections } from "@/shared/projections";
import { getWeekKickoffs } from "@/shared/schedule";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";
import { easternDate } from "@/shared/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One week of every league's lineup, checked — see
 * {@link ManagerLineupCheckPayload}.
 *
 * One batch request rather than one per league, for the reason the lineups
 * route beside it is batched: the projections board and the week's schedule are
 * shared across every league, so per-card requests would refetch nothing and
 * re-enter everything.
 *
 * **`?league=` is the one narrowing, and it is not a retreat from that.** It
 * exists for the re-read that follows a refresh press, where exactly one card's
 * stored lineup has changed and re-sending a hundred solved leagues to correct
 * one row is the waste the batching argument is made of, pointed the other way.
 * It narrows the *rows*, not the path: the season, the week, the board, the
 * locks and the solve are all the same code, so a narrowed answer cannot drift
 * from the batch the client merges it into.
 *
 * **The week is resolved first and alone**, and not by oversight: which week to
 * read is the answer everything below is read *for*. `?week=` is the caller's
 * answer and skips the resolve entirely — the same relationship `?season=` has
 * to `getActiveSeason` — and the week always travels back on the payload, so
 * the client reads one answer rather than assuming its own.
 *
 * **Three failures, three different answers**, which is the whole shape of this
 * handler:
 *
 * - the *database* read fails → 500. It is the list the page is made of.
 * - the *projections* read fails → `projections: "error"` and no leagues. A
 *   page of confident zeroes under a successful status is the one outcome this
 *   must not have.
 * - the *schedule* read fails → everything else answers. `getWeekKickoffs`
 *   never throws; an empty map means `kickoff_moves: null` per league and the
 *   locks fall back to the day rule, which is exactly what they degrade to.
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

  const searchParams = new URL(request.url).searchParams;

  // Three states for each, not two: `null` is "not asked" and is the only one
  // filled from a resolver. Collapsing absent and invalid is how `?week=abc`
  // quietly becomes the current week.
  const requestedSeason = parseRequestedSeason(searchParams.get("season"));
  if (requestedSeason && !requestedSeason.ok) {
    const error: ApiErrorPayload = { error: requestedSeason.error };
    return NextResponse.json(error, { status: 400 });
  }
  const requestedWeek = parseRequestedWeek(searchParams.get("week"));
  if (requestedWeek && !requestedWeek.ok) {
    const error: ApiErrorPayload = { error: requestedWeek.error };
    return NextResponse.json(error, { status: 400 });
  }
  // Not validated the way the season and week are, and it does not want to be:
  // those two are *resolved* when absent, so absent and invalid have to be told
  // apart. A league id is only ever a filter — one this manager does not play in
  // narrows to nothing and answers an empty `leagues`, which is the same answer
  // a league with no slots on file already gets.
  const requestedLeague = searchParams.get("league")?.trim() || undefined;

  const season = requestedSeason?.season ?? (await getActiveSeason());

  try {
    const week = requestedWeek?.week ?? (await currentWeek(season));
    if (week === null) {
      // `"ok"`: a season the NFL has finished with has no week to check, and no
      // read failed to say so. A real answer about the season, not a shortfall.
      const empty: ManagerLineupCheckPayload = {
        season,
        week: null,
        projections: "ok",
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    const leagues = await getManagerWeekLineups(
      userId,
      season,
      week,
      requestedLeague,
    );
    if (leagues.length === 0) {
      const empty: ManagerLineupCheckPayload = {
        season,
        week,
        projections: "ok",
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    // The schedule read cannot fail the page — it never throws, and an empty
    // map is the honest "no instants published" its readers spell for
    // themselves. The projections read can, and does.
    let board: WeekProjections;
    let kickoffs: Map<string, number>;
    try {
      [board, kickoffs] = await Promise.all([
        getWeekProjections(season, week),
        getWeekKickoffs(season, week),
      ]);
    } catch (error) {
      console.warn(
        `[lineup-check] projections unavailable for ${season} week ${week}:`,
        error,
      );
      const degraded: ManagerLineupCheckPayload = {
        season,
        week,
        projections: "error",
        leagues: {},
      };
      return NextResponse.json(degraded);
    }

    // One clock read and one day for the whole request, so every league judges
    // the same instant — the reason `lockedPlayers` takes `now` as an argument.
    // The population is the account's whole roster union rather than the rows
    // that came back: a player with no projection row is still a candidate for
    // a kickoff-accurate lock.
    const playerIds = [
      ...new Set(leagues.flatMap((l) => [...(l.players ?? []), ...(l.starters ?? [])])),
    ].filter((id) => id && id !== "0");
    const teams = Object.fromEntries(
      playerIds.map((id) => [id, board[id]?.team ?? null]),
    );
    const dayLocked = dayLockedPlayers(board, easternDate());
    // The fold only ever locks *earlier*, so no schedule at all degrades to
    // exactly the day rule rather than to nothing.
    const locked =
      kickoffs.size > 0
        ? lockedPlayers({ playerIds, dayLocked, teams, kickoffs, now: Date.now() })
        : dayLocked;
    const instants = kickoffs.size > 0 ? kickoffs : null;

    const solved: Record<string, LineupCheckLeague> = {};
    for (const league of leagues) {
      const entry = solveWeekLineup(league, board, locked, instants);
      // Null means the league has no slots on file — nothing to compare a
      // lineup against — so it drops out rather than reporting a zero gap.
      if (entry) solved[league.league_id] = entry;
    }

    const payload: ManagerLineupCheckPayload = {
      season,
      week,
      projections: "ok",
      leagues: solved,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[lineup-check] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load lineups" };
    return NextResponse.json(payload, { status: 500 });
  }
}

/**
 * The week this page checks when the caller named none, or null when the season
 * has none to check.
 *
 * `display_week` rather than `week`: Sleeper advances it to the week whose games
 * are *next* once the current week's have been played, which is the week
 * somebody setting a lineup is asking about. A season Sleeper has moved past
 * has no lineup left to set, and a state call that fails answers week 1 — the
 * widest honest window, the same fallback the lineups route takes.
 */
async function currentWeek(season: string): Promise<number | null> {
  const state = await getNflState().catch(() => null);
  if (!state) return 1;

  if (state.season === season) {
    return clampWeek(state.display_week || state.week);
  }
  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested < current) {
    return null;
  }
  return 1;
}

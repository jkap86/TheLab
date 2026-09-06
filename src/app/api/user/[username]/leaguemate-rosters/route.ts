import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeagueRosterEntry,
  ManagerLeaguemateRostersPayload,
  PlayerSummary,
} from "@/shared/contract";
import { getLeagueRosters } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every roster in the manager's leagues this season — theirs and everybody
 * else's — plus a name for every id on one.
 *
 * The third of the shares reads, and the sibling of the two beside it in every
 * respect: membership rather than a count, Postgres only, folded on the client
 * so the counting respects the page's league filters. See
 * `ManagerLeaguemateRostersPayload` for the shape and for why a roster carries
 * its owner rather than being keyed by one.
 *
 * **It is the heaviest of the three by an order of magnitude** — every roster
 * of every league rather than one per league — which is why the client keeps it
 * behind the drawer's `opened` latch. Nothing here caps or pages it: a cap
 * would be a silently short answer to "does anybody hold him", and the two
 * questions this feeds (what a leaguemate rosters, and whether a player is
 * unrostered) are both false when the population is trimmed.
 *
 * **Postgres only — it never reaches Sleeper**, on the players route's terms: a
 * drawer that could trigger a sync would put an ~11-request-per-league fan-out
 * behind a key press that reads as a panel opening.
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

  // Three states, not two, as everywhere: `null` is "not asked" and is the only
  // one the resolver fills. Collapsing absent and invalid is how `?season=abc`
  // quietly becomes the current season.
  const requested = parseRequestedSeason(
    new URL(request.url).searchParams.get("season"),
  );
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const stored = await getLeagueRosters(resolved.user.user_id, season);

    const rosters: Record<string, LeagueRosterEntry[]> = {};
    const ids = new Set<string>();
    for (const [leagueId, rows] of Object.entries(stored)) {
      rosters[leagueId] = rows.map((row) => {
        // The column is nullable and untyped — null is Sleeper's own spelling
        // of an empty roster, and a non-array must read as "no players" rather
        // than throw halfway through the fold.
        const players = Array.isArray(row.players) ? row.players : [];
        for (const id of players) {
          // Sleeper's slot padding. Not players, so not looked up; the folds
          // drop them again, and this only keeps the query's parameter array
          // honest.
          if (id && id !== "0") ids.add(id);
        }
        return { roster_id: row.roster_id, user_id: row.owner_id, players };
      });
    }

    const players: Record<string, PlayerSummary> = await getPlayersByIds([
      ...ids,
    ]);

    const payload: ManagerLeaguemateRostersPayload = {
      season,
      rosters,
      players,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(
      `[leaguemate-rosters] failed for ${username} ${season}:`,
      error,
    );
    const payload: ApiErrorPayload = {
      error: "Failed to load league rosters",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

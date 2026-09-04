import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerPlayersPayload } from "@/shared/contract";
import { getManagerRosters } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every roster the manager holds this season, plus a name for every player on
 * one — the player shares drawer's whole input.
 *
 * **It ships membership and never a count.** A share is folded on the client,
 * because the manager page narrows its league list five ways and a share has to
 * be counted over the leagues left; a `GROUP BY` here would answer a different
 * question and could not be re-asked without a round trip per filter press. See
 * `ManagerPlayersPayload`.
 *
 * **Postgres only — it never reaches Sleeper for a roster.** The leagues stream
 * is the one thing that fills this data, and a drawer that could trigger a sync
 * would put an ~11-request-per-league fan-out behind a key press that reads as
 * a panel opening. A manager with nothing stored gets an empty map, which the
 * drawer says in words.
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
    const rosters = await getManagerRosters(resolved.user.user_id, season);

    // Deduped across leagues before the lookup: a player held in forty of them
    // is one row to fetch and one entry to send.
    const ids = [
      ...new Set(
        Object.values(rosters)
          .flat()
          // Sleeper pads roster slots with these; they are not players and must
          // not be looked up. The fold drops them again — this is only to keep
          // the query's parameter array honest.
          .filter((id) => id && id !== "0"),
      ),
    ];
    const players = await getPlayersByIds(ids);

    const payload: ManagerPlayersPayload = { season, rosters, players };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[players] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load rosters" };
    return NextResponse.json(payload, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { getCompsPools, isCompsPosition } from "@/shared/comps";

import { readFailureResponse } from "../../read-failure";

import type { CompsPlayersPayload, CompsPlayerOptionPayload } from "@/shared/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The comps picker's list: every player with stored stats at a supported
 * position, with the seasons each has stats in.
 *
 * Folded from the same cached pools the comps read runs over, so the picker
 * and the answer cannot disagree about who has stats — and filtered to
 * `COMPS_POSITIONS`, which is what keeps an unsupported subject a
 * hand-built-URL case rather than something the UI can produce. Pools come
 * newest season first, so the first sighting of a player carries his newest
 * stored name and team. The client ranks by typed name (`rankByName`); this
 * answers alphabetically for a stable payload.
 */
export async function GET() {
  try {
    const pools = await getCompsPools();

    const byPlayer = new Map<string, CompsPlayerOptionPayload>();
    for (const pool of pools) {
      for (const row of pool.rows) {
        if (row.position === null || !isCompsPosition(row.position)) continue;
        const seen = byPlayer.get(row.player_id);
        if (seen) {
          seen.seasons.push(pool.season);
        } else {
          byPlayer.set(row.player_id, {
            player_id: row.player_id,
            name: row.name,
            position: row.position,
            team: row.team,
            seasons: [pool.season],
          });
        }
      }
    }

    const players = [...byPlayer.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const payload: CompsPlayersPayload = {
      players,
      seasons: pools.map((pool) => pool.season),
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[comps] players list failed:", error);
    return readFailureResponse(error, "Failed to list comps players");
  }
}

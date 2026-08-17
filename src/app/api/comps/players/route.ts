import { NextResponse } from "next/server";

import { getCompsPlayerIndex, getCompsSeasons } from "@/shared/comps";

import { readFailureResponse } from "../../read-failure";

import type { CompsPlayersPayload } from "@/shared/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The comps picker's list: every player with stored stats at a supported
 * position, with the seasons each has stats in.
 *
 * **It is not the comps corpus, and used not to be either.** This was folded
 * from the same cached pools `/api/comps` runs over, which meant opening the
 * picker assembled every stored season's stat lines into rows and joined a KTC
 * snapshot, a KTC history aggregate, an ADP average and the NFL draft crosswalk
 * onto each one — to print a name, a position and a team, none of which come
 * from any of that. `getCompsPlayerIndex` answers the same list from the two
 * reads that can: the stored `(player, season)` pairs and the players cache.
 *
 * What that costs is one guarantee, and it is a guarantee about a different
 * table than the one it looked like: the picker and the comps answer now agree
 * because both read `player_week_stats` for who has stats, rather than because
 * one was folded from the other. The position filter is still
 * `COMPS_POSITIONS`, which is what keeps an unsupported subject a
 * hand-built-URL case rather than something the UI can produce.
 */
export async function GET() {
  try {
    // Independent reads: the index answers who, the season list answers the
    // corpus's own depth (which the picker prints as the range on offer). Both
    // are cached, and neither is fatal to the other — but a list of players
    // with no seasons is not a picker, so a failure of either is the route's.
    const [players, seasons] = await Promise.all([
      getCompsPlayerIndex(),
      getCompsSeasons(),
    ]);

    const payload: CompsPlayersPayload = {
      // Copied out of the frozen cached answer, because the payload's arrays
      // belong to the caller: a shared answer is frozen precisely so nobody
      // edits it, and `players` is what every reader inside the TTL holds.
      players: players.map((player) => ({
        ...player,
        seasons: [...player.seasons],
      })),
      seasons: [...seasons],
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[comps] players list failed:", error);
    return readFailureResponse(error, "Failed to list comps players");
  }
}

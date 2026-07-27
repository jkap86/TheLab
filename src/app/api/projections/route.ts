import { NextResponse } from "next/server";

import type { ApiErrorPayload, ProjectionPlayerPayload, ProjectionsPayload } from "@/shared/manager";
import { getPlayerIdsByPosition, getPlayersByIds } from "@/shared/players";
import {
  getLatestStoredWeek,
  listWeekProjections,
  parseProjectionFilters,
} from "@/shared/projections";
import { DEFAULT_SEASON } from "@/shared/sleeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sleeper's weekly player projections, as stored by the background sync — ranked
 * by the requested scoring.
 *
 *   GET /api/projections?week=1&scoring=half_ppr&position=WR,TE&limit=25
 *
 * `season` defaults to the current one, `week` to the newest week on file, and
 * `scoring` to `ppr`. `position` filters against the players cache; `player_id`
 * narrows to specific players (a roster, say). `stats=1` adds the full projected
 * stat line per player, which is what a league with custom scoring needs.
 *
 * Reads only. Nothing here calls Sleeper, so a week that hasn't been synced comes
 * back empty rather than fetched on demand — `/api/projections/sync` is the way to
 * pull one in.
 */
export async function GET(request: Request) {
  const parsed = parseProjectionFilters(new URL(request.url).searchParams, DEFAULT_SEASON);
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const filters = parsed.filters;

  try {
    const week = filters.week ?? (await getLatestStoredWeek(filters.season));

    // Nothing stored for the season at all: an empty result, not an error — the
    // sync may simply not have run yet. `week` stays null so a client can tell
    // this apart from a week that has rows but matched no filters.
    if (week === null) {
      const payload: ProjectionsPayload = {
        filters: { ...filters, week: null },
        updated_at: null,
        player_count: 0,
        players: [],
      };
      return NextResponse.json(payload);
    }

    // `projections` stores no position, and the module doesn't own `players` —
    // so positions resolve to ids there and come back as an id filter. Position
    // and player_id intersect when both are given.
    let playerIds = filters.player_ids;
    if (filters.positions) {
      const byPosition = new Set(await getPlayerIdsByPosition(filters.positions));
      playerIds = playerIds
        ? playerIds.filter((id) => byPosition.has(id))
        : [...byPosition];
    }

    const result = await listWeekProjections({
      season: filters.season,
      week,
      scoring: filters.scoring,
      playerIds,
      includeStats: filters.include_stats,
      limit: filters.limit,
      offset: filters.offset,
    });

    const players = await getPlayersByIds(result.rows.map((r) => r.player_id));

    const payload: ProjectionsPayload = {
      filters: { ...filters, week },
      updated_at: result.updated_at,
      player_count: result.player_count,
      players: result.rows.map((row, index): ProjectionPlayerPayload => {
        const player = players[row.player_id];
        return {
          rank: filters.offset + index + 1,
          player_id: row.player_id,
          name: player?.name ?? row.player_id,
          position: player?.position ?? null,
          team: row.team,
          opponent: row.opponent,
          game_date: row.game_date,
          points: row.points,
          ...(filters.include_stats ? { stats: row.stats } : {}),
        };
      }),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[proj] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to read projections" };
    return NextResponse.json(payload, { status: 500 });
  }
}

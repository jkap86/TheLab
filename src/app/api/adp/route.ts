import { NextResponse } from "next/server";

import type { AdpPayload, AdpPlayerPayload, ApiErrorPayload } from "@/shared/contract";
import { getDraftAdp, parseAdpFilters } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { DEFAULT_SEASON } from "@/shared/sleeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Average draft position over the drafts this app has crawled, narrowed by
 * draft and league attributes so the population being averaged is comparable.
 *
 *   GET /api/adp?league_type=dynasty&superflex=true&teams_min=12&scoring=ppr
 *
 * Draft filters: `season` (4-digit year, repeatable/comma-separated, or `all`),
 * `start_after`/`start_before` (`YYYY-MM-DD`, read in ET, both ends inclusive),
 * `draft_type` (snake|linear|auction), `draft_status`
 * (complete|drafting|paused|pre_draft), `rounds_min`, `rounds_max`.
 *
 * `season` and the date range are different cuts, not two spellings of one: a
 * season is what a draft is *for*, the range is when it *happened*, and a
 * league's rookie draft and its startup share the former while sitting months
 * apart in the latter. Either bounds the board; giving neither falls back to
 * `DEFAULT_SEASON` so a bare request can't scan every draft on file.
 *
 * League filters: `league_id`, `league_type` (redraft|keeper|dynasty),
 * `scoring` (std|half_ppr|ppr), `best_ball`, `superflex`, `teams_min`,
 * `teams_max`.
 *
 * Result shaping: `min_picks` (drop players taken in fewer drafts than this),
 * `limit`, `offset`.
 *
 * `rounds_min`/`rounds_max` matter more than they look: a dynasty league's
 * 4-round rookie draft and its 25-round startup are both drafts, and pick 1 of
 * one is nothing like pick 1 of the other. Bound the rounds to compare like
 * with like. `ADP_FILTER_DEFAULTS` in `@/shared/manager` documents what applies
 * when a filter is left out; the response echoes the filters it used, so those
 * defaults stay visible to the caller.
 */
export async function GET(request: Request) {
  const parsed = parseAdpFilters(new URL(request.url).searchParams, DEFAULT_SEASON);
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const filters = parsed.filters;

  try {
    const result = await getDraftAdp(filters);
    const players = await getPlayersByIds(result.rows.map((r) => r.player_id));

    const payload: AdpPayload = {
      filters,
      draft_count: result.draft_count,
      player_count: result.player_count,
      players: result.rows.map((row, index): AdpPlayerPayload => {
        const player = players[row.player_id];
        return {
          rank: filters.offset + index + 1,
          player_id: row.player_id,
          name: player?.name ?? row.player_id,
          position: player?.position ?? null,
          team: player?.team ?? null,
          adp: row.adp,
          min_pick: row.min_pick,
          max_pick: row.max_pick,
          stdev: row.stdev,
          picks: row.picks,
        };
      }),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[adp] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to compute ADP" };
    return NextResponse.json(payload, { status: 500 });
  }
}

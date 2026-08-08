import { NextResponse } from "next/server";

import type { AdpPayload, AdpPlayerPayload, ApiErrorPayload } from "@/shared/contract";
import { getKtcPickBoard } from "@/shared/ktc";
import { getDraftAdp, parseAdpFilters, usesDefaultSeason } from "@/shared/manager";
import { getPlayersByIds, getRookieClassIds } from "@/shared/players";
import { getActiveSeason } from "@/shared/season";

import { readLeagueScope } from "../league-scope";
import { readFailureResponse } from "../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Average draft position over the drafts this app has crawled, narrowed by
 * draft and league attributes so the population being averaged is comparable —
 * and always averaged twice, once per league-type board.
 *
 *   GET /api/adp?superflex=true&teams_min=12&scoring=ppr
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
 * League filters: `league_id`, `xleague_id`, `scoring` (std|half_ppr|ppr),
 * `best_ball`, `superflex`, `teams_min`, `teams_max`. The league type is
 * deliberately *not* one of them: a dynasty startup and a redraft are different
 * markets, so every response carries each player's redraft and dynasty averages
 * side by side — with the drafts split the same way
 * (`redraft_drafts`/`dynasty_drafts`) — and the display chooses which to show
 * rather than the fetch choosing for it.
 *
 * **The two id lists are how the drawer's own filters arrive now.** Its scoring,
 * superflex, best-ball and size chips were replaced by the shared league-filters
 * dialog, whose rules are a browser-side engine over Sleeper's blobs (see
 * `/api/adp/leagues`); what crosses the wire is their answer, as whichever of
 * "these leagues" and "every league but these" is the shorter list. The chips'
 * own parameters stay, because `/api/user/[username]/adp-value` still matches
 * `scoring` and `superflex` *per league* — those are facts about the roster
 * being priced rather than choices about the market.
 *
 * Result shaping: `min_picks` (drop players taken in fewer drafts than this,
 * applied per board), `limit`, `offset`.
 *
 * `rounds_min`/`rounds_max` matter more than they look: a dynasty league's
 * 4-round rookie draft and its 25-round startup are both drafts, and pick 1 of
 * one is nothing like pick 1 of the other. Bound the rounds to compare like
 * with like. `ADP_FILTER_DEFAULTS` in `@/shared/manager` documents what applies
 * when a filter is left out; the response echoes the filters it used, so those
 * defaults stay visible to the caller.
 */
export async function GET(request: Request) {
  return board(request);
}

/**
 * The same board, with a league scope too long for a request line.
 *
 * **GET and POST differ in where the league ids were read from and in nothing
 * else** — the query string is identical, this handler is the same handler, and
 * the parser folds a body list into exactly the field the query-string one would
 * have filled. That is what keeps a large scope from being a second code path
 * with its own bugs, and it is `/api/trades`' own arrangement.
 */
export async function POST(request: Request) {
  return board(request);
}

async function board(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = await readLeagueScope(request);
  // The resolver is consulted only where the parser will read its answer.
  // `getActiveSeason` asks Sleeper when its cache is cold, and a board the
  // caller has already bounded — `?season=2024`, or a date window — has no use
  // for the answer: awaiting it there made a historical read wait on an upstream
  // it does not depend on, which is the house rule about explicitly requested
  // seasons broken by evaluation order rather than by intent. The predicate is
  // the parser's own branch, exported, so the two cannot drift.
  const parsed = parseAdpFilters(
    params,
    usesDefaultSeason(params) ? await getActiveSeason() : null,
    scope,
  );
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const filters = parsed.filters;

  try {
    const result = await getDraftAdp(filters);
    const ids = result.rows.map((r) => r.player_id);
    // Three reads beside the aggregate that has already done the expensive work,
    // none of which waits on another. The second is what makes a pick column
    // possible at all — the *current* class through the rookie-class seam (see
    // `shared/players/rookie-class` for what keeps historical classes out),
    // since ranking the rookies on this board *is* the pick ladder. The third
    // is the only thing KTC is asked for: what waiting costs, which ADP cannot
    // answer for a pick whose class nobody can name yet. It is a few dozen rows
    // off a 500-row table, and it is read whole because the anchor the discount
    // is measured against is a fact about the board rather than about any pick
    // — see `AdpPayload.pick_ktc`.
    const [players, rookies, pickKtc] = await Promise.all([
      getPlayersByIds(ids),
      getRookieClassIds(ids),
      getKtcPickBoard(),
    ]);

    const payload: AdpPayload = {
      filters,
      draft_count: result.draft_count,
      redraft_drafts: result.redraft_drafts,
      dynasty_drafts: result.dynasty_drafts,
      player_count: result.player_count,
      players: result.rows.map((row): AdpPlayerPayload => {
        const player = players[row.player_id];
        return {
          player_id: row.player_id,
          name: player?.name ?? row.player_id,
          position: player?.position ?? null,
          team: player?.team ?? null,
          rookie: rookies.has(row.player_id),
          redraft: row.redraft,
          dynasty: row.dynasty,
        };
      }),
      pick_ktc: pickKtc,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[adp] query failed:", error);
    return readFailureResponse(error, "Failed to compute ADP");
  }
}

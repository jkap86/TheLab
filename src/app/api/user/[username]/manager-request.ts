import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { resolveManagerUser } from "@/shared/manager";
import { isSeason } from "@/shared/query";
import type { SleeperUser } from "@/shared/sleeper";
import { getActiveSeason } from "@/shared/season";

/**
 * The opening every route under `/api/user/[username]` shares: await the route
 * params, resolve the searched username, and read the season off the query
 * string.
 *
 * It lives here rather than in `shared/manager` beside `resolveManagerUser`
 * because the one thing it adds is the `NextResponse` — turning that function's
 * `{ status, error }` into an HTTP answer is route plumbing, and domain code has
 * no business constructing responses. What it is *not* is business logic, which
 * is why a shared module in `src/app` doesn't breach the layering rule: every
 * decision it makes (which status a bad username gets, what the default season
 * is) already belongs to a module it calls.
 *
 * `season` is parsed for all of them, including the base route that ignores it.
 * It is the same query parameter everywhere and reading one string a request is
 * cheaper than two entry points here.
 */
export type ManagerRequest = {
  ok: true;
  /** As spelled in the URL — Sleeper resolves a user id as readily as a name, so
   *  this is what to put in a log line, not the resolved username. */
  username: string;
  user: SleeperUser;
  userId: string;
  season: string;
  searchParams: URLSearchParams;
};

export type ManagerRequestResult =
  | ManagerRequest
  | { ok: false; response: NextResponse };

export async function resolveManagerRequest(
  request: Request,
  params: Promise<{ username: string }>,
): Promise<ManagerRequestResult> {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return {
      ok: false,
      response: NextResponse.json(error, { status: resolved.status }),
    };
  }

  const searchParams = new URL(request.url).searchParams;

  // Rejected rather than passed through: a junk season would reach Sleeper,
  // sync nothing, and stamp a `manager_syncs` row keyed to it — the caller
  // would see an indistinguishable "manager has no leagues" instead of a 400.
  const season = searchParams.get("season")?.trim();
  if (season && !isSeason(season)) {
    const error: ApiErrorPayload = {
      error: `Invalid season: ${season}. Expected a 4-digit year.`,
    };
    return { ok: false, response: NextResponse.json(error, { status: 400 }) };
  }

  return {
    ok: true,
    username,
    user: resolved.user,
    userId: resolved.user.user_id,
    // Only the blank is filled from the resolver — an explicitly requested
    // season is the caller's answer and stays exactly what they asked for.
    season: season || (await getActiveSeason()),
    searchParams,
  };
}

import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { getActiveSeason, isPlausibleSeason } from "@/shared/season";
import type { SleeperUser } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/util/user";

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

  // Rejected rather than passed through: a junk season would reach Sleeper and
  // sync nothing, and the caller would see an indistinguishable "manager has no
  // leagues" instead of a 400.
  //
  // Validated with the resolver's own predicate rather than a bare 4-digit test,
  // so the season a caller may *ask* for and the season the resolver will
  // *accept* from Sleeper are one rule. Two spellings of "looks like a season"
  // is how `?season=0000` becomes a 200 with nothing in it.
  const season = searchParams.get("season")?.trim();
  if (season && !isPlausibleSeason(season)) {
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

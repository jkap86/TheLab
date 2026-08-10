import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerRanksPayload } from "@/shared/contract";
import { parseManagerRanksOptions, readManagerRanks } from "@/shared/manager";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerIdRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the manager's roster sits in each of their leagues — by record, by
 * points for, and by projected points — read from cache and nothing else; see
 * {@link ManagerRanksPayload}.
 *
 * One batch request rather than a rank per league card because the leagues page
 * shows a hundred-plus collapsed cards at once, and a collapsed card costs no
 * request of its own; the batch read shares the projection queries across every
 * league where a per-league loop would repeat them. The record and points ranks
 * ride along for free — the rosters read already fetched every team's standings
 * figures — so only the projected rank pays for a projection.
 *
 * **`?projections=0` asks for the payload without that half.** The projected
 * ranks are the whole cost of this route (a lineup solve per team per remaining
 * week, per league), and the four columns that read them are four of a
 * thirteen-metric catalogue a reader aims freely — the `Value` and `Market`
 * presets are one press and name none of them. Omitted, the parameter reads as
 * *on*, so nothing that has ever called this route sees a different answer.
 *
 * Everything above the response is {@link readManagerRanks}, which is also where
 * the answer is cached and concurrent callers are coalesced.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerIdRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, username, season, searchParams } = resolved;

  const options = parseManagerRanksOptions(searchParams);
  if (!options.ok) {
    const error: ApiErrorPayload = { error: options.error };
    return NextResponse.json(error, { status: 400 });
  }

  try {
    const payload: ManagerRanksPayload = await readManagerRanks(
      userId,
      season,
      options.options,
      username,
    );
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[ranks] query failed:", error);
    return readFailureResponse(error, "Failed to load ranks");
  }
}

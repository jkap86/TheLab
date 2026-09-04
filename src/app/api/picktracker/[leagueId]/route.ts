import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { toPicktrackerPayload, trackPlaceholderDraft } from "@/shared/picktracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's placeholder-pick board, read from Sleeper right now.
 *
 * **A deliberate exception to "a cache-backed route reads and nothing else".**
 * The tool follows a draft *while it happens*, for any league id whether a sync
 * has ever seen it or not, and a copy from the stored graph would be behind the
 * room by up to the crawler's fifteen minutes — which is most of a draft. It
 * joins the manager routes and `POST /api/league/[leagueId]/sync` on that list.
 *
 * **It takes no `season`, and that is not an omission.** A league id names the
 * league and the draft names its own season, so there is nothing here for
 * `parseRequestedSeason` to validate and nothing a `?season=` could mean. Do
 * not "fix" this by adding one.
 *
 * This is the snapshot half: the manual refresh key's endpoint, and the
 * fallback wherever the stream beside it cannot get through. The live half is
 * `./stream`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  const result = await trackPlaceholderDraft(leagueId);
  if (!result.ok) {
    const error: ApiErrorPayload = { error: result.error };
    return NextResponse.json(error, { status: result.status });
  }

  return NextResponse.json(toPicktrackerPayload(result), {
    headers: { "Cache-Control": "no-store" },
  });
}

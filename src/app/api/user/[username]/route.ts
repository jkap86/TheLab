import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { resolveManagerUser, toUserInfo } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Sleeper username (or user id) to the app's user shape, avatar URL
 * included. 400 for a blank name, 404 for one Sleeper doesn't know, 502 when
 * Sleeper is unreachable — the ladder itself lives in `resolveManagerUser`, and
 * all this does is spell it as a response.
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

  return NextResponse.json(toUserInfo(resolved.user));
}

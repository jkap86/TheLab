import { NextResponse } from "next/server";

import { toUserInfo } from "@/shared/manager";

import { resolveManagerRequest } from "./manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Sleeper username (or user id) to the app's user shape, avatar URL
 * included. 400 for a blank name, 404 for one Sleeper doesn't know, 502 when
 * Sleeper is unreachable.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;

  return NextResponse.json(toUserInfo(resolved.user));
}

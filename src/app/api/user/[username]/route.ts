import { NextResponse } from "next/server";

import { resolveManagerUser, toUserInfo } from "@/shared/sleeper";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  return NextResponse.json(toUserInfo(resolved.user));
}

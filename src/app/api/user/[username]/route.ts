import { NextResponse } from "next/server";

import { getSleeperUser, sleeperAvatarUrl } from "@/shared/sleeper";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  if (!username?.trim()) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 },
    );
  }

  let user;
  try {
    user = await getSleeperUser(username);
  } catch {
    return NextResponse.json(
      { error: "Failed to reach Sleeper" },
      { status: 502 },
    );
  }

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar,
    avatar_url: sleeperAvatarUrl(user.avatar),
  });
}

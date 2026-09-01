import type { UserInfo } from "@/shared/contract";
import { sleeperAvatarUrl, type SleeperUser } from "@/shared/sleeper";

export function toUserInfo(user: SleeperUser): UserInfo {
  return {
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar,
    avatar_url: sleeperAvatarUrl(user.avatar),
  };
}

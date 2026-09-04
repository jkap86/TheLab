/**
 * The one transformation between the domain and the wire: Sleeper avatar ids
 * become CDN URLs.
 *
 * It lives apart from both routes because both build it — the snapshot route
 * and the live room — and a second spelling is how the manual refresh key would
 * come to disagree with the stream it sits beside.
 */
import { sleeperAvatarUrl } from "@/shared/sleeper";
import type { PicktrackerPayload } from "@/shared/contract";

import type { PicktrackerResult } from "./track";

/** A successful result as the board's payload. */
export function toPicktrackerPayload(
  result: Extract<PicktrackerResult, { ok: true }>,
): PicktrackerPayload {
  const { league } = result.context;
  return {
    league: {
      league_id: league.league_id,
      name: league.name,
      // Full size for the league's own mark, which the plate lights in a bezel;
      // thumbs for the managers, who are 20px in a row.
      avatar_url: sleeperAvatarUrl(league.avatar),
    },
    draft_id: result.context.draft_id,
    draft_status: result.draft_status,
    teams: result.context.teams,
    picks: result.picks.map((pick) => ({
      pick: pick.pick,
      player_id: pick.player_id,
      player_name: pick.player_name,
      picked_by: pick.picked_by
        ? {
            user_id: pick.picked_by.user_id,
            display_name: pick.picked_by.display_name,
            avatar_url: sleeperAvatarUrl(pick.picked_by.avatar, "thumb"),
          }
        : null,
    })),
    next_pick: result.next_pick,
  };
}

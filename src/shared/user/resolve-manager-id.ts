import { isAdmissionRefusal } from "@/shared/sleeper";
import type { SleeperUser } from "@/shared/sleeper";

export type ManagerLookup = (
  usernameOrId: string,
) => Promise<SleeperUser | null>;

export type ResolvedManagerId =
  | { ok: true; userId: string; user: SleeperUser }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * Resolve a name someone typed to a Sleeper user, mapping every way it can fail
 * to the status that failure deserves.
 *
 * The three are genuinely different and a caller acts on each differently: 400
 * is a request that never should have been sent, 404 is a name Sleeper does not
 * know, and 502 is Sleeper being unreachable — which is the one that must not be
 * reported as "no such user", because a retry would have worked.
 *
 * A fourth way it can end is not mapped at all: see the `catch` below.
 *
 * `lookup` arrives as an argument rather than being imported so the ladder can
 * be exercised without a network behind it.
 */
export async function resolveManagerId(
  username: string,
  lookup: ManagerLookup,
): Promise<ResolvedManagerId> {
  if (!username?.trim()) {
    return { ok: false, status: 400, error: "Username is required" };
  }

  let user: SleeperUser | null;
  try {
    user = await lookup(username);
  } catch (error) {
    // **An overload is not a failed lookup, so it is not this ladder's to
    // classify.** A refused admission or a spent request budget means the
    // process declined to ask Sleeper, which is a fourth thing beside the three
    // below and deserves a 503 with a `Retry-After` rather than a 502 saying
    // Sleeper could not be reached. It is rethrown rather than mapped here so
    // there stays exactly one place that decides that status and that header —
    // `shared/api`, which every route's own scope goes through.
    if (isAdmissionRefusal(error)) throw error;
    return { ok: false, status: 502, error: "Failed to reach Sleeper" };
  }
  if (!user) return { ok: false, status: 404, error: "User not found" };
  return { ok: true, userId: user.user_id, user };
}

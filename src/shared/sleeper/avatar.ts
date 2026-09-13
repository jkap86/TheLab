/**
 * Sleeper's CDN, and the one spelling of an avatar URL on it.
 *
 * **Its own module, with no imports, so a pure one can build a URL.**
 * `client.ts` reaches `@/shared/http` through the alias, which Node's own test
 * runner cannot resolve — so `manager/league-teams.ts`, which names a
 * standings team's avatar and is tested under that runner, would stop loading
 * the moment it imported the client for one string template. The client
 * re-exports both, so every existing caller is unchanged.
 */

export const SLEEPER_CDN_BASE = "https://sleepercdn.com";

/** Build a full avatar URL from a Sleeper avatar id, or null when there is none. */
export function sleeperAvatarUrl(
  avatar: string | null | undefined,
  size: "full" | "thumb" = "full",
): string | null {
  if (!avatar) return null;
  const path = size === "thumb" ? "avatars/thumbs" : "avatars";
  return `${SLEEPER_CDN_BASE}/${path}/${avatar}`;
}

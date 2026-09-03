/**
 * The env switch in front of a background loop, in the one spelling all of them
 * share.
 *
 * Pure, and shaped to spread straight into {@link startBackgroundLoop}'s
 * `enabled`/`disabledReason` — which is what keeps the *reason* a loop is not
 * running attached to the loop that isn't running, rather than to a `return`
 * three files away.
 */

/** What a switch answers, spread into a loop's options. */
export type LoopSwitch = { enabled: boolean; disabledReason?: string };

/**
 * Whether the loop guarded by `variable` may start.
 *
 * **Only the exact word `off` disables it**, case- and whitespace-insensitive;
 * anything else runs. That asymmetry is deliberate and predates this file: a
 * typo in an env var that silently stops the database being filled is invisible
 * for hours, where a typo that fails to stop a loop is visible in the first log
 * line it prints.
 */
export function loopSwitch(
  variable: string,
  env: Record<string, string | undefined> = process.env,
): LoopSwitch {
  if (env[variable]?.trim().toLowerCase() === "off") {
    return { enabled: false, disabledReason: `${variable}=off` };
  }
  return { enabled: true };
}

/**
 * Where the lineup checker's reads are filed.
 *
 * **It is in `features/shared` because a shared part invalidates them**, which is
 * the mover's rule arrived at from the far end: the league detail panel's sync
 * key re-reads one league from Sleeper, and the numbers that go stale when it
 * does are not only the panel's own — the card the panel opened out of prints
 * that league's shortfall off `/api/user/[username]/matchups`, which is this
 * table's one entry. A shared module reaching into a feature for the key would
 * be the cross-feature import this codebase does not make, and a second spelling
 * of the key here would be two entries for one question.
 *
 * `features/lineupchecker/query-keys.ts` re-exports it under the usual habit, so
 * the tool's own hooks keep one import and there is still exactly one definition.
 *
 * **Outside the manager prefix**, though it asks about an account. The manager
 * tabs key on the name *searched* in the URL and invalidate the lot when that
 * manager's leagues change; this tool has no searched name — it reads the stored
 * account's `user_id` — and nothing here rides on the leagues stream, so a
 * manager-wide invalidation has no business throwing it away.
 *
 * Pure, and imported relatively with a `.ts` extension by anything that hashes
 * these keys.
 */
export const lineupQueryKeys = {
  all: ["lineupchecker"] as const,
  /**
   * One week's matchups for one account. Lower-cased for the reason the manager
   * keys are: Sleeper resolves an id or a name to one account, so two spellings
   * of the same subject must not become two entries.
   *
   * `week` is null while the reader has stepped nowhere and the route is
   * resolving it — a real state rather than a missing one, so it is spelled out
   * as a segment instead of dropped. Dropping it would collide the resolved week
   * with whichever week the reader first steps to, and stepping *back* onto the
   * resolved week would then read a stale entry filed under a different question.
   */
  matchups: (userId: string, week: number | null = null) =>
    ["lineupchecker", "matchups", userId.toLowerCase(), week ?? "upcoming"] as const,
};

/**
 * How long a set of matchups is worth reusing in the browser.
 *
 * Five minutes, against the league crawler's own fifteen in season: the pairing
 * for a week is fixed once the league has scheduled it, and what actually moves
 * within a week is the lineups either side of it. Short enough that a reader who
 * comes back mid-Sunday is not reading a pairing from Thursday, long enough that
 * a trip out to another tool and back is free.
 *
 * It travels **with the key** rather than staying in the hook, the arrangement
 * `LEAGUE_DETAIL_STALE_TIME` and `MANAGER_STALE_TIMES` already keep: how long an
 * entry is worth reusing is a fact about the entry, and the tests that reason
 * about these windows — `cache-layering.test.ts`, `degraded-cache.test.ts` — are
 * shared modules that cannot import a feature to find one. The tool re-exports
 * it under the name its own consumers already read it by.
 *
 * **It is a ceiling rather than the whole policy.** A payload whose week could
 * not be solved is worth none of it — see `degradedStaleTime`.
 */
export const MATCHUPS_STALE_TIME = 5 * 60 * 1000;

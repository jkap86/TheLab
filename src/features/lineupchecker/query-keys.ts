/**
 * The keys this tool's reads are cached under.
 *
 * Built here rather than at the call site, the rule `managerQueryKeys` exists
 * for: a key that differs by a stray segment is not a shared cache entry, it is a
 * second request that looks like a hit in the code and a miss in the network
 * panel.
 *
 * **Outside the manager prefix**, though it asks about an account. The manager
 * tabs key on the name *searched* in the URL and invalidate the lot when that
 * manager's leagues change; this page has no searched name — it reads the stored
 * account's `user_id` — and nothing here rides on the leagues stream, so a
 * manager-wide invalidation has no business throwing it away.
 */
export const lineupQueryKeys = {
  all: ["lineupchecker"] as const,
  /**
   * This week's matchups for one account. Lower-cased for the reason the manager
   * keys are: Sleeper resolves an id or a name to one account, so two spellings
   * of the same subject must not become two entries.
   */
  matchups: (userId: string) =>
    ["lineupchecker", "matchups", userId.toLowerCase()] as const,
};

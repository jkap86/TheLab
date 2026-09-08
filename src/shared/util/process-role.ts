/**
 * Which job this process is doing: serving requests, running the background
 * loops, or both.
 *
 * **The loops and the requests were competing for one process, and only one of
 * them is what a reader is waiting on.** A crawl tick is a Sleeper fan-out
 * across a batch of leagues holding a pooled connection for the length of it; a
 * players refresh is a ~5MB download and twelve thousand upserts in one
 * transaction; a comps load is eighteen weeks of Sleeper per season. Every one
 * of those is correct where it stands and every one of them is scheduled work
 * that does not care which second it runs in — where a manager page's lineups
 * read very much does.
 *
 * So a deployment can put them on a dyno of their own. `APP_PROCESS_ROLE=web`
 * serves and starts nothing; `APP_PROCESS_ROLE=worker` starts the loops; `all`
 * — the default — does both, which is what a single-instance deployment and a
 * developer's laptop both want and is exactly the behaviour this app had before
 * the switch existed.
 *
 * **Nothing about the loops' own protections changes**, and that is the point
 * of leaving them where they are: each still takes its Postgres advisory lock
 * per tick, so two workers against one database stand down rather than crawling
 * the same rows twice, and each still reads its own `LOOP=off` switch. This
 * decides *which process* runs them, which is the one thing an advisory lock
 * cannot say — a lock makes a second instance correct, and correct is not the
 * same as out of the way.
 *
 * Pure, with the environment as an argument, on `db/config`'s and
 * `loopSwitch`'s terms: the rule is the kind that is silent when wrong (a
 * typo'd role that quietly starts nothing on the only worker), so it is read by
 * a test rather than by a deployment.
 */

/** What a process may be told to be. */
export type ProcessRole = "web" | "worker" | "all";

/** The variable a deployment sets. One spelling, read in two places. */
export const PROCESS_ROLE_VAR = "APP_PROCESS_ROLE";

/**
 * The role this environment names, or `all` where it names none.
 *
 * **An unreadable value is `all`, not a refusal**, which is the opposite call
 * from `parseRequestedSeason` and right for the opposite reason. A season names
 * *which data* a page is about, so an unreadable one has to fail or a reader is
 * shown one year under another's heading. This names which of two jobs a
 * process does, and the honest fallback for "we could not tell" is the
 * behaviour the app had before anybody asked — a process that both serves and
 * maintains. A typo that silently stopped the crawler is a database going quiet
 * for hours with nothing on screen saying so; a typo that starts it on a web
 * dyno is a log line on boot.
 *
 * Case- and whitespace-insensitive, on `loopSwitch`'s terms.
 */
export function processRole(
  env: Record<string, string | undefined> = process.env,
): ProcessRole {
  const raw = env[PROCESS_ROLE_VAR]?.trim().toLowerCase();
  if (raw === "web" || raw === "worker" || raw === "all") return raw;
  return "all";
}

/**
 * Whether this process should start the background loops.
 *
 * The one reader is `instrumentation.ts`. It is a function rather than a
 * comparison at the call site so the *reason* a loop is not running stays
 * attached to the rule that decided it — {@link backgroundJobsSkipReason} is
 * the other half, and the two are always read together.
 */
export function runsBackgroundJobs(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return processRole(env) !== "web";
}

/**
 * What to print where the loops are not started, or null where they are.
 *
 * A boot that starts nothing must say why: a worker whose role was misspelled
 * and a web dyno doing exactly what it was told look identical from the outside
 * — no ticks, no errors — and the difference is a database that stops being
 * refreshed.
 */
export function backgroundJobsSkipReason(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return runsBackgroundJobs(env) ? null : `${PROCESS_ROLE_VAR}=web`;
}

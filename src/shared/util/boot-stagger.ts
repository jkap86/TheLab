/**
 * When each background loop takes its *first* tick, so a cold boot does not run
 * all four at once.
 *
 * **The problem is a boot, not a cadence.** `instrumentation.ts` (and
 * `scripts/worker.ts`) start four loops in one pass and every one of them fired
 * immediately, so a fresh dyno's first seconds were a KeepTradeCut scrape, a
 * ~5MB Sleeper players download and twelve thousand upserts, a crawl tick's
 * fan-out across a batch of leagues, and a comps corpus probe — concurrently,
 * against the same pool and the same Sleeper limiter, beside the first requests
 * the process is also trying to serve. On a 512 MB Heroku Basic dyno running
 * `APP_PROCESS_ROLE=all` that is the one moment the crawler's own RSS guard is
 * least able to help: it reads memory *the crawler* is making and stands the
 * crawler down, where the spike here is three other loops' as well.
 *
 * **What is staggered is the first tick and nothing else.** Every recurring gap
 * is still each loop's own `intervalMs` — see
 * {@link import("./background-loop").BackgroundLoop.initialDelayMs}, where the
 * interval is armed by the delayed boot tick rather than at start, so the
 * cadence is unchanged and never doubles up. After the first minute the four
 * clocks (15m, daily, 60s, daily) have nothing keeping them in phase anyway.
 *
 * **It is not a throttle, and it must not become one.** The real defence
 * against needless boot work is each loop's own freshness check, and those are
 * unchanged and still primary: a restart inside KTC's TTL re-scrapes nothing, a
 * players map less than a day old is skipped, and the comps corpus loads only
 * seasons the metadata row says are missing — so the *usual* boot is four cheap
 * questions whatever order they are asked in. What these delays buy is the boot
 * where the answers are yes, which is the first boot of a deployment and the
 * one after a season ends. They are seconds, not minutes: every loop still
 * takes its first tick inside a minute and a half of boot.
 *
 * ## The order is the dependencies, not a preference
 *
 * 1. **players** — first, and immediate, because two of the other three read
 *    what it writes. The KTC matcher resolves `sleeper_id` against the stored
 *    players map (`lazyMatchIndex` calls `ensurePlayersFresh` itself), and the
 *    comps loader joins every season row to it for age, experience and draft
 *    capital — a load against an empty map skips every row and says so. On a
 *    first boot this is the one that has to go first or the other two do less
 *    than they could.
 * 2. **ktc** — next, once the map it matches against is in flight. Its own
 *    `ensurePlayersFresh` is what makes this safe rather than fragile: it takes
 *    the same advisory lock and the same freshness check, so it stands down
 *    behind the players loop rather than downloading 5MB beside it.
 * 3. **crawl** — after both. It depends on neither, and it is the loop with the
 *    most memory in flight at once (a batch of league graphs, rosters,
 *    transactions and matchups, all parsed), so it is the one worth starting
 *    into a settled process. It also ticks every 60s, so a 45s first tick costs
 *    a corpus at most one rotation.
 * 4. **comps** — last, because its boot tick is the heaviest thing here on the
 *    boot where it does anything at all (eighteen weeks of Sleeper per missing
 *    season) and because it reads the players map the first loop is writing.
 *    On every other boot it is two cheap reads and a skip, and 90 seconds late
 *    to a question asked once a year costs nothing.
 *
 * A plain table rather than a scheduler: the loops are started by two files and
 * a number that differed between them would be a stagger nobody could read off
 * either. It is exported as a `const` object so a reader sees the whole shape
 * at once, which is the argument for the order being here rather than four
 * numbers in four schedulers.
 */
export const BOOT_STAGGER_MS = {
  /** Immediate: the map the KTC matcher and the comps loader both read. */
  players: 0,
  /** 15s: after the players refresh it would otherwise trigger itself. */
  ktc: 15_000,
  /** 45s: no dependency, the largest resident set, and a 60s cadence. */
  crawl: 45_000,
  /** 90s: the heaviest first boot, and it reads the players map. */
  comps: 90_000,
} as const;

/** The loops {@link BOOT_STAGGER_MS} names. */
export type StaggeredLoop = keyof typeof BOOT_STAGGER_MS;

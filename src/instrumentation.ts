/**
 * Next.js instrumentation hook.
 *
 * `register` runs once when a server instance boots and must complete before
 * the server handles requests, which makes it the place to apply pending
 * database migrations automatically on boot.
 *
 * Migrations use `pg`/`node-pg-migrate`, which are Node.js-only, so the import
 * is guarded to the Node.js runtime and loaded dynamically — this keeps the DB
 * code out of any non-Node bundle entirely.
 *
 * The background loops start here too, once migrations have applied — KTC
 * values, the Sleeper players map, the league crawl, and the comps corpus.
 * Each is started and not awaited, and each guards its own ticks; a failure
 * reaching one of these catch blocks means the module itself failed to load.
 * Further loops add their own block below.
 *
 * **Whether they start at all is `APP_PROCESS_ROLE`'s**, and that is the one
 * thing this file gained that is not about a loop. Every one of those four is
 * scheduled maintenance — a Sleeper fan-out holding a pooled connection, a ~5MB
 * download, twelve thousand upserts in a transaction — and every one of them
 * was competing for the same process as the request a reader is waiting on. A
 * deployment can now put them on a worker dyno: `web` serves and starts none of
 * them, `worker` starts them, and the default `all` is both, which is what a
 * single instance and a laptop want and is exactly what this file did before.
 * Migrations run under every role, because a process must not serve *or*
 * maintain against a schema it cannot vouch for. See `util/process-role`.
 *
 * **The shipped deployment is `all` on one dyno**, which is the arrangement the
 * crawler's own RSS guard was written for: on a 512 MB Heroku Basic dyno the
 * loops below and the request handlers share a process, and the crawler is the
 * one workload there that can be told to wait (`manager/crawl-pressure`). The
 * split — `web` here, `worker` on a dyno of its own — is one config var away and
 * changes nothing about the loops themselves; see `Procfile` and the Deploying
 * section of README.md.
 *
 * **They no longer all start at the same instant.** Each carries a
 * `BOOT_STAGGER_MS` entry, so the first tick of the four is spread over ninety
 * seconds in dependency order — the players map first, because the KTC matcher
 * and the comps loader both read what it writes. Their cadences are untouched;
 * see `util/boot-stagger`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/shared/db");

  try {
    await runMigrations();
  } catch (error) {
    // Either the database was never configured (fatal in production — see
    // `shared/db/config`) or migrations failed. Both throw, and throwing from
    // `register` is what stops the server before it serves a request against a
    // schema it can't vouch for.
    console.error("[db] Failed to initialise the database on boot:", error);
    throw error;
  }

  // **A boot that starts nothing says why.** A web dyno doing exactly what it
  // was told and a worker whose role was misspelled look identical from the
  // outside — no ticks, no errors — and the difference is a database that stops
  // being refreshed. An unreadable value reads as `all` rather than as a
  // refusal, on the same argument: see `processRole`.
  const { backgroundJobsSkipReason, PROCESS_ROLE_VAR, processRole } = await import(
    "@/shared/util"
  );
  const skip = backgroundJobsSkipReason();
  if (skip !== null) {
    console.log(`[jobs] Background loops not started on this process (${skip}).`);
    return;
  }
  // **And a boot that starts them says so too**, naming the role it read. Under
  // the single-dyno `all` — the default, and what the `Procfile`'s web line runs
  // as until a config var says otherwise — the loops are sharing this process
  // with the requests it is serving, which is a deliberate arrangement rather
  // than an accident and is worth one line at the top of a dyno's log.
  console.log(
    `[jobs] Starting background loops (${PROCESS_ROLE_VAR}=${processRole()}).`,
  );

  // Started, not awaited: the boot tick can run half an hour of history
  // backfill and `register()` gates request serving. And unlike migrations, a
  // failure here is logged rather than rethrown — a KTC outage is not a reason
  // to refuse to serve the leagues route. The scheduler guards its own ticks,
  // so reaching this catch means the module itself failed to load.
  try {
    const { startKtcScheduler } = await import("@/shared/ktc");
    startKtcScheduler();
  } catch (error) {
    console.error("[ktc] Failed to start the KTC scheduler:", error);
  }

  // The same terms: a ~5MB download queued behind the Sleeper limiter must not
  // gate request serving, and a failed one costs the trades board its names
  // rather than the server its boot.
  try {
    const { startPlayersScheduler } = await import("@/shared/players");
    startPlayersScheduler();
  } catch (error) {
    console.error("[players] Failed to start the players scheduler:", error);
  }

  // The same terms again, and this is the loop those terms were written for: a
  // tick is a Sleeper fan-out across a batch of leagues, and it holds a pool
  // connection for the length of it. It takes a Postgres advisory lock per
  // tick, so a second instance against the same database stands down rather
  // than crawling the same rows twice. `LEAGUE_CRAWLER=off` disables it.
  try {
    const { startLeagueCrawler } = await import("@/shared/manager");
    startLeagueCrawler();
  } catch (error) {
    console.error("[crawl] Failed to start the league crawler:", error);
  }

  // The comps corpus, on the same terms once more — and this is the one of the
  // four whose *ordinary* tick does nothing at all. A historical corpus changes
  // when a season ends and at no other time, so the loop checks (one `count(*)`
  // and one Sleeper state read) and loads only the seasons the stored corpus is
  // actually missing; every boot after the first is a skip and a log line. The
  // first boot against an empty database is the exception and is the reason
  // this is here: `/comps` had no corpus until somebody remembered to run
  // `npm run comps:load-corpus`, and a page that renders "no corpus loaded" is
  // not a thing to leave to a deploy checklist. `COMPS_CORPUS_LOAD=off`
  // disables it, on `KTC_SYNC`'s exact terms.
  try {
    const { startCompsCorpusScheduler } = await import("@/shared/player-seasons");
    startCompsCorpusScheduler();
  } catch (error) {
    console.error("[comps] Failed to start the corpus loader:", error);
  }
}

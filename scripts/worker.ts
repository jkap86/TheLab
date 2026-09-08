/**
 * The background worker: migrations, then the four loops, then nothing.
 *
 * **It exists so a web dyno can stop doing this.** Every loop it starts is
 * scheduled maintenance that holds a pooled connection and a Sleeper permit for
 * as long as it takes — a crawl tick's fan-out across a batch of leagues, a
 * ~5MB players download and twelve thousand upserts in one transaction, a comps
 * load of eighteen weeks per uncovered season — and none of them cares which
 * second it runs in, where the manager page's lineups read very much does. On a
 * single instance they still share a process and always did; this is what a
 * deployment reaches for when they should not.
 *
 * **It is the same code path `instrumentation.ts` takes, not a second one.**
 * The schedulers, their `LOOP=off` switches, their `globalThis` singleton
 * guards, their non-overlapping tick guards and their Postgres advisory locks
 * are all exactly what they were: this file starts them and holds the process
 * open. Two workers against one database therefore stand down for each other
 * per tick, as they already did for a second web instance.
 *
 * Run it with `npm run worker`, and see `Procfile`.
 */

import {
  backgroundJobsSkipReason,
  PROCESS_ROLE_VAR,
  processRole,
} from "@/shared/util";

async function main(): Promise<void> {
  // **The role is read rather than assumed**, so a Procfile line that forgot
  // `APP_PROCESS_ROLE=worker` is a message rather than a dyno that quietly does
  // nothing. `all` runs the loops too, which is the default and is what a
  // developer running this by hand gets.
  const role = processRole();
  const skip = backgroundJobsSkipReason();
  if (skip !== null) {
    console.error(
      `[worker] Refusing to start: ${PROCESS_ROLE_VAR} is "web". ` +
        `Set ${PROCESS_ROLE_VAR}=worker on this process.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[worker] Starting background loops (${PROCESS_ROLE_VAR}=${role}).`);

  // The same order and the same reasoning as `instrumentation.ts`: a process
  // must not maintain a schema it cannot vouch for, so migrations first and a
  // failure here is fatal.
  const { runMigrations } = await import("@/shared/db");
  await runMigrations();

  const { startKtcScheduler } = await import("@/shared/ktc");
  const { startPlayersScheduler } = await import("@/shared/players");
  const { startLeagueCrawler } = await import("@/shared/manager");
  const { startCompsCorpusScheduler } = await import("@/shared/player-seasons");

  startKtcScheduler();
  startPlayersScheduler();
  startLeagueCrawler();
  startCompsCorpusScheduler();

  // **The loops `unref` their timers**, which is what keeps a web server from
  // being held open by one — and is exactly wrong here, where the timers are
  // the whole job. One `ref`'d interval that does nothing is what holds this
  // process open; a signal handler is what lets a dyno restart cleanly.
  const keepAlive = setInterval(() => {}, 1 << 30);
  const stop = (signal: string) => {
    console.log(`[worker] ${signal} — stopping.`);
    clearInterval(keepAlive);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

void main().catch((error: unknown) => {
  console.error("[worker] Failed to start:", error);
  process.exitCode = 1;
});

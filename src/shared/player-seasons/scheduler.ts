import { errorMessage, loopSwitch, startBackgroundLoop } from "@/shared/util";
import type { BackgroundLoopHandle } from "@/shared/util";
import { getNflState } from "@/shared/sleeper";

import { probeCorpus } from "./queries";
import {
  LOADER_VERSION,
  corpusRefresh,
  latestCompleteSeason,
  loadCompsCorpus,
} from "./loader";
import type {
  CompsLoadReport,
  CorpusRefreshDecision,
  NflSeasonState,
} from "./loader";

/**
 * The comps corpus on boot: load the seasons the stored corpus is missing, and
 * on every ordinary boot, load nothing.
 *
 * Started from `instrumentation.ts` after migrations and *not awaited* there —
 * a first load is eighteen weeks of Sleeper per season behind the process-wide
 * limiter, and `register()` gates request serving. Every page but `/comps`
 * ignores this table entirely, and `/comps` itself says in its own words that
 * no corpus is loaded, so a load in flight costs one page a sentence rather
 * than the server its boot.
 *
 * **`./loader/load`'s own header says this is "a script rather than a sync
 * loop", and the reason it gives still holds: "the corpus changes once a year,
 * when a season ends, so a background tick would be a loop that does nothing
 * for eleven months and then does something nobody is watching." That is an
 * argument against a loop that *loads* on a clock, and this is not one.** What
 * ticks here is the question — one metadata read and one NFL state read — and
 * the load happens only where the answer says a season is genuinely absent.
 * The eleven months of nothing are two cheap reads a day, and the something in
 * the twelfth is the one an operator would otherwise have had to remember. The
 * script stays, and stays the way to load a *chosen* span; this is the way the
 * default span keeps up with the calendar on its own.
 *
 * **The gate is `./loader/refresh` and it is what makes this a boot task
 * rather than a boot cost.** Without it every deploy would re-fetch every
 * season the corpus already holds — minutes of upstream traffic to rewrite
 * rows that have not changed — which is the failure a boot hook running a
 * whole-span loader has by default.
 *
 * **`firstRun` is deliberately unused, which is the one thing that differs
 * from the other three loops.** KTC, the players map and the crawl all read it
 * because their freshness is a TTL and the interval *is* the TTL: an unforced
 * interval tick would find the rows a moment short of stale and skip for ever,
 * so the boot tick declines to force and the interval ticks force. Freshness
 * here is not a clock at all — it is whether the corpus covers the seasons that
 * have finished — so the boot tick and an interval tick ask the identical
 * question and there is nothing for the distinction to decide.
 *
 * The load takes its advisory lock in the try/skip form, so a second instance
 * booting against the same database stands down rather than fetching the same
 * seasons beside the first.
 */

/** Set to `off` (case-insensitive) to disable the loop. */
export const COMPS_CORPUS_LOAD_VAR = "COMPS_CORPUS_LOAD";

/**
 * How often the corpus is re-checked.
 *
 * Daily, and it is a *check* interval rather than a TTL: what it bounds is how
 * long a server already up when a season finishes waits before noticing, which
 * is the one thing a boot-only hook cannot answer. There is nothing to gain
 * from asking more often — a season finishes once a year — and the cost of
 * asking is one `count(*)` and one Sleeper state read.
 */
export const COMPS_CORPUS_CHECK_MS = 24 * 60 * 60 * 1000;

export function startCompsCorpusScheduler(): BackgroundLoopHandle {
  return startBackgroundLoop({
    name: "comps",
    intervalMs: COMPS_CORPUS_CHECK_MS,
    guardKey: "comps-corpus",
    ...loopSwitch(COMPS_CORPUS_LOAD_VAR),
    cadence: "daily",
    tick,
  });
}

async function tick(): Promise<void> {
  try {
    // Both halves are needed either way — "does the corpus cover every
    // finished season" has no answer without both — and the probe goes first
    // because it is a `count(*)` where the other is a request.
    const probe = await probeCorpus();
    // Read once and used twice, which is the point: the seasons the loader
    // plans are checked against the identical answer the decision was made
    // from, rather than against a second reading taken a fan-out later.
    const state = await readState();
    const decision = corpusRefresh(probe, {
      latestComplete: latestCompleteSeason(state),
      loaderVersion: LOADER_VERSION,
    });

    if (!decision.due) {
      console.log(`[comps] Corpus up to date (${decision.reason}), skipped.`);
      return;
    }

    console.log(
      `[comps] Loading ${decision.seasons.join(", ")} on ${decision.scoring} — ${decision.reason}.`,
    );
    report(
      await loadCompsCorpus({
        from: null,
        to: null,
        seasons: decision.seasons,
        scoring: decision.scoring,
        state,
      }),
      decision,
    );
  } catch (error) {
    // Logged, never thrown: an unloadable corpus costs `/comps` its board, and
    // `startBackgroundLoop` would swallow this anyway. Naming the loop here is
    // what tells the four apart on the console.
    console.error("[comps] Corpus check failed:", errorMessage(error));
  }
}

/**
 * Sleeper's state, or the empty one — never a throw.
 *
 * `getWeekKickoffs`' rule, and it is what decides how a Sleeper outage reads
 * on a corpus that is already current. Left to throw, the commonest tick there
 * is — nothing to do, upstream down — would print an error against a corpus in
 * perfectly good order. Folded to the empty state it becomes
 * `latestCompleteSeason`'s 0, which `corpusRefresh` answers as a skip naming
 * the unreadable state, and the next tick asks again. On an *empty* corpus the
 * same fold is the same right answer: a state nobody could read is not a
 * licence to fetch seasons nobody has finished playing.
 *
 * Memoised nowhere on purpose — it is two reads a day.
 */
async function readState(): Promise<NflSeasonState> {
  try {
    return (await getNflState()) ?? EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

const EMPTY_STATE: NflSeasonState = { season: "", season_type: "" };

function report(
  result: CompsLoadReport,
  decision: Extract<CorpusRefreshDecision, { due: true }>,
): void {
  if (result.locked) {
    console.log("[comps] Corpus load running elsewhere; stood down.");
    return;
  }

  for (const refusal of result.plan.refused) {
    console.log(`[comps] Refusing ${refusal.season}: ${refusal.reason}`);
  }
  for (const failure of result.errors) {
    console.error(`[comps] ${failure.season} failed: ${failure.message}`);
  }

  if (result.seasons.length === 0) {
    console.warn(
      `[comps] Corpus load wrote nothing (asked for ${decision.seasons.join(", ")}).`,
    );
    return;
  }

  console.log(
    `[comps] Corpus loaded: ${result.inserted} new and ${result.updated} updated rows ` +
      `over ${result.seasons.join(", ")}; ${result.meta?.players ?? 0} players on file.`,
  );
}

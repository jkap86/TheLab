import {
  AdvisoryLockTimeoutError,
  leagueSyncLockKey,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { getLeague } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { markLeaguesGone } from "./crawl-queue";
import { leagueRefreshAdmission } from "./league-refresh-admission";
import { getLeagueChain } from "./queries";
import { getSyncClock, refreshedLeagues, syncLeagueGraphs } from "./sync";

/**
 * Growing a league's stored history by one earlier season, because a reader
 * asked for it.
 *
 * **This is the one path in the app that adds a league nobody has enumerated.**
 * Everything else that fills the corpus works from a *list*: the manager sync
 * asks Sleeper which leagues an account holds in a season, and the crawler
 * discovers through `league_users`. Both are season-scoped, so an earlier season
 * of a league somebody is looking at is in the database only by the accident of
 * that year having been visited by name — which is why the timeline's rail used
 * to stop at one year even though `previous_league_id` was sitting in the row
 * all along.
 *
 * **The bound that keeps it from being an open write endpoint is the chain
 * itself.** `refreshLeague` states the rule this has to answer to: "a route that
 * fetched arbitrary league ids into the database on request is an open write
 * endpoint wearing a refresh button". The id fetched here is never the caller's
 * — it is read out of a league *already stored*, from the column Sleeper wrote.
 * So the corpus can only ever grow backwards along chains rooted in leagues it
 * already holds, which is a set no request can widen.
 *
 * **There is no cooldown, and that is a decision rather than an omission.** A
 * finished season is immutable: once stored it never needs fetching again, so
 * "is it already here" is a gate that closes permanently and a throttle behind
 * it would only ever govern retries of a fetch that *failed* — which is a press
 * a reader is entitled to make again. What bounds the failing case instead is
 * the pair every press goes through: a process-wide permit and a per-league
 * lock, so however many times a key is pressed there is one fan-out in flight
 * for one league.
 *
 * It **throws only on a database failure**. Everything Sleeper can do comes back
 * as a status, which is what lets the route answer 200 to all of them — the same
 * arrangement `refreshLeague` makes, and for the same reason: a chain that has
 * genuinely ended is an outcome rather than an error.
 */
export type LeagueHistoryResult =
  /** The earlier season was fetched from Sleeper and written. */
  | { status: "added"; leagueId: string }
  /**
   * It was already stored when the lock opened — another tab, or another
   * instance, got there first. A success rather than a refusal: the data the
   * press wanted is there, which is `refreshLeague`'s own `raced` reading.
   */
  | { status: "fresh"; leagueId: string }
  /** Sleeper names no season before the oldest one stored. The chain has ended. */
  | { status: "none" }
  /** Nothing stored under the id asked for. The route answers 404. */
  | { status: "unknown" }
  /** Sleeper no longer serves that earlier league; it has been tombstoned. */
  | { status: "gone"; leagueId: string }
  /** No permit, or the lock wait ran out. Somebody is doing this work. */
  | { status: "locked" }
  /** Sleeper was reached and the graph did not come back whole. */
  | { status: "failed"; leagueId: string };

/**
 * Store the season before the oldest one this database holds for a league.
 *
 * The league asked for is the one the card is showing — the head of the chain —
 * and the walk to its far end happens here rather than on the client. That is
 * deliberate: the client would have to pass the *oldest stored* league id, which
 * it learns from a payload that may be a minute old, and a stale one would name
 * a season somebody else has since loaded. Asking the database where the chain
 * currently ends is one query and cannot be stale.
 */
export async function extendLeagueHistory(
  leagueId: string,
): Promise<LeagueHistoryResult> {
  // Asked before the permit so a press at an id we hold nothing for cannot spend
  // one, and so the 404 costs nothing but an indexed lookup — `refreshLeague`'s
  // own ordering.
  const chain = await getLeagueChain(leagueId);
  if (chain.links.length === 0) return { status: "unknown" };
  if (chain.earlier_league_id === null) return { status: "none" };

  const target = chain.earlier_league_id;

  // **The same admission as a manual refresh, not one of its own.** The weight
  // is identical — one league graph, ~11 Sleeper requests — and both are a
  // reader holding a response open, so they should compete for one budget
  // rather than each having their own and jointly overrunning it. `tryAcquire`
  // for `sync-admission`'s reason: a refused press must be told so rather than
  // parked behind a queue nobody can see.
  const permit = leagueRefreshAdmission.tryAcquire();
  if (!permit) {
    console.warn(
      `[league-history] ${target} shed; ` +
        `${leagueRefreshAdmission.stats().active} league reads already running.`,
    );
    return { status: "locked" };
  }

  try {
    return await withBlockingAdvisoryLock(leagueSyncLockKey(target), () =>
      loadEarlierSeason(leagueId, target),
    );
  } catch (error) {
    if (!(error instanceof AdvisoryLockTimeoutError)) throw error;
    console.warn(`[league-history] ${target} is already loading elsewhere.`);
    return { status: "locked" };
  } finally {
    permit();
  }
}

/**
 * The body of a press, with the lock held.
 *
 * **The chain is re-read inside the lock**, and that is the whole of what the
 * lock buys: the question is not what the far end was when the press arrived but
 * what it is now that this caller has the floor. Two tabs pressing together both
 * queue here, and the second finds the season already stored and reports `fresh`
 * rather than spending a second fan-out on it.
 */
async function loadEarlierSeason(
  headLeagueId: string,
  target: string,
): Promise<LeagueHistoryResult> {
  const chain = await getLeagueChain(headLeagueId);
  if (chain.links.length === 0) return { status: "unknown" };
  if (chain.earlier_league_id === null) {
    // Either somebody stored it while this press waited, or Sleeper's chain
    // genuinely ended. Both are "there is nothing here to fetch", and the one
    // that means the reader's rail just got longer is the one the client will
    // see on its re-read.
    return { status: "fresh", leagueId: target };
  }
  if (chain.earlier_league_id !== target) {
    // The far end moved while this press waited — another tab loaded a season
    // and the chain now ends somewhere else. Reporting the work as done is
    // right: the reader's next read is longer than the one they pressed on.
    return { status: "fresh", leagueId: chain.earlier_league_id };
  }

  let league;
  try {
    // Doubles as the "does Sleeper still serve it" probe, which is the same fold
    // `refreshLeague` relies on and the reason this is not folded into
    // `syncLeagueGraphs`: that function takes leagues, and finding out whether
    // there is one is a different question.
    league = await getLeague(target);
  } catch (error) {
    console.warn(
      `[league-history] could not read league ${target}:`,
      errorMessage(error),
    );
    return { status: "failed", leagueId: target };
  }

  if (!league) {
    // Tombstoned, so the crawler's queue stops claiming it and so this league's
    // own rail stops offering it: `getLeagueChain` reads `gone_at`, so the next
    // read comes back with no earlier season rather than with a key that fails
    // every time it is pressed.
    await markLeaguesGone([target]);
    return { status: "gone", leagueId: target };
  }

  const result = await syncLeagueGraphs([league], await getSyncClock(), {
    concurrency: 1,
  });

  // **Persisted is not refreshed**, the distinction `refreshLeague` draws: a
  // graph missing a mandatory collection kept whatever was stored rather than
  // being wiped, which for a league that had nothing stored is nothing at all.
  // Reporting that as a season added would put a rail on screen with no rosters
  // behind it.
  if (refreshedLeagues(result) !== 1) {
    return { status: "failed", leagueId: target };
  }

  console.info(
    `[league-history] ${target} (${league.season}) loaded behind ${headLeagueId} ` +
      `(${result.counts.rosters} rosters, ${result.counts.transactions} transactions)`,
  );
  return { status: "added", leagueId: target };
}

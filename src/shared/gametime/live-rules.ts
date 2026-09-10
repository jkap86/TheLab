/**
 * The decisions a gametime room makes on every tick, kept pure so a test can
 * drive them without a Sleeper behind them — `./live` holds the timers and the
 * subscriber sets, which cannot be. `picktracker/live-rules`' arrangement.
 */

import type { GametimeFeedStatus } from "../contract/gametime.ts";
import type { GamePhase } from "../schedule/game-clock.ts";

/** How often the feeds are re-read while any game on the board is running. */
export const LIVE_INTERVAL_MS = 20_000;

/**
 * How often they are re-read while games are still to kick off and none is
 * running — the floor of the wait, and the whole wait where no kickoff is
 * known. Once a minute is cheap (two requests) and is what bounds how late a
 * kickoff is noticed.
 */
export const WAITING_INTERVAL_MS = 60_000;

/**
 * The most a room will sleep between ticks while waiting on a kickoff.
 *
 * A room parked on a Saturday could sleep until Sunday's first game, and
 * thelab2026's playoff room does exactly that; here the wait is capped so a
 * reschedule, a flexed game or a clock this process misread costs at most ten
 * minutes rather than a day.
 */
export const MAX_WAIT_MS = 10 * 60_000;

/**
 * How long before a kickoff a room starts ticking at the live cadence, so the
 * first snap is not noticed a minute late.
 */
export const KICKOFF_LEAD_MS = 60_000;

/** After a failed tick — longer than either healthy cadence, for the picktracker's reason. */
export const FAILURE_INTERVAL_MS = 30_000;

/** Consecutive failures before the readers are told the board stopped moving. */
export const STALE_AFTER_FAILURES = 3;

/**
 * How long a subscriber's stored lineups answer for before the room re-reads
 * them from Postgres.
 *
 * A lineup changes until its players lock, and the manager sync is what writes
 * the change; three minutes is how late such a change is reflected on a page
 * that was already open, against a Postgres read per subscriber per interval.
 * Nothing on this page re-reads a league by hand, so this is the only thing
 * that reflects a change made elsewhere.
 */
export const LEAGUES_TTL_MS = 3 * 60_000;

/**
 * How much of a random extra wait rides on top of that interval, per reader.
 *
 * **Kickoff is when everybody joins.** A room opened at one o'clock seats
 * every reader of that week within a minute or two of each other, and a fixed
 * TTL then lands all of their re-reads on the same tick for the rest of the
 * afternoon — one tick a minute doing nothing and one doing a hundred Postgres
 * reads. A minute of jitter is a fifth of a whole period, which is enough to
 * spread a kickoff crowd over three ticks without letting anyone's lineup go
 * meaningfully staler than the interval already allows.
 */
export const LEAGUES_TTL_JITTER_MS = 60_000;

/**
 * How many of those re-reads a tick runs at once.
 *
 * The loop was serial, which on a kickoff crowd whose TTLs had converged made
 * one tick a queue of a hundred round trips before a single frame went out;
 * `Promise.all` over the same list is the other failure — a fan-out whose
 * width is the room's popularity, each branch holding a pool connection. Four
 * is the pool's own arithmetic: `DEFAULT_POOL_MAX` is ten and a live room is
 * not the only thing on the dyno.
 */
export const ROW_REFRESH_CONCURRENCY = 4;

/**
 * When a reader's stored lineups are next due, given the instant they were
 * read and a `Math.random()` draw.
 *
 * Pure so the spread can be tested rather than eyeballed: the answer is always
 * at least the interval and never more than the interval plus the jitter, so a
 * lineup is never held longer than the policy above says.
 */
export function rowsDueAt(readAt: number, random: number): number {
  const draw = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0;
  return readAt + LEAGUES_TTL_MS + Math.round(draw * LEAGUES_TTL_JITTER_MS);
}

/**
 * How long a room keeps polling after its last reader leaves — the
 * picktracker's own linger, for its reasons (StrictMode, in-app navigation).
 */
export const LINGER_MS = 30_000;

/**
 * How long between ticks, given where the week's games are.
 *
 * **Null when nothing is left to happen** — every game final and none to come
 * — which is the whole point of the function: a finished week is a fact, not
 * a feed, and a room polling it forever is the picktracker's complete-draft
 * waste wearing a scoreboard. The stream stays open holding the final numbers.
 *
 * A game in progress is the live cadence. Games still to come are the waiting
 * cadence, shortened to the time until the next kickoff (less a lead) where
 * one is known, and never shorter than the floor nor longer than the cap: a
 * kickoff already past that the scoreboard has not moved on is the floor.
 *
 * An empty board — a week this process could not read — is the waiting
 * cadence, so a scoreboard that comes back is noticed within a minute.
 */
export function pollIntervalMs(input: {
  games: Record<GamePhase, number>;
  /** The earliest kickoff still ahead, epoch ms, or null where none is known. */
  nextKickoff: number | null;
  now: number;
}): number | null {
  const { games, nextKickoff, now } = input;
  if (games.live > 0) return LIVE_INTERVAL_MS;
  if (games.pre === 0) {
    return games.final > 0 ? null : WAITING_INTERVAL_MS;
  }
  if (nextKickoff === null) return WAITING_INTERVAL_MS;
  const until = nextKickoff - KICKOFF_LEAD_MS - now;
  if (until <= 0) return LIVE_INTERVAL_MS;
  return Math.min(MAX_WAIT_MS, Math.max(WAITING_INTERVAL_MS, until));
}

/**
 * The cheapest honest signal that the week's feeds moved: the stats feed's own
 * stamp beside the scoreboard's. Two ticks that would price every lineup
 * identically compare equal, and nothing is sent.
 */
export function feedSignature(input: { stats: string; clocks: string }): string {
  return `${input.stats}|${input.clocks}`;
}

/**
 * What a tick compares against the tick before it — the whole of what can make
 * a reader's answer different, named field by field.
 *
 * A structural subset of `WeekFeeds` rather than that type, so this module
 * stays free of the runtime imports the feed reader carries and its rules keep
 * testing under Node's own runner.
 */
export type FeedState = {
  /** {@link feedSignature} — the stat lines and the clocks. */
  signature: string;
  /**
   * The folded projections board, compared by **identity**: it is cached whole
   * and handed out by reference, so a new object is a new read and the same
   * object is the same board.
   */
  projections: object | null;
  statuses: Record<"projections" | "stats" | "scores", GametimeFeedStatus>;
};

/**
 * Whether a tick's feeds would price, or *caption*, a reader's week differently
 * from the last one.
 *
 * **The statuses count, and that is the whole of why this is a function rather
 * than the two comparisons it grew out of.** A feed's health is on the wire —
 * it decides which note the page prints, and since the scoreboard's own read is
 * what says whether a clock may be trusted for pricing, it decides the numbers
 * too. Read off the values alone, both transitions are invisible in exactly the
 * case they matter most: a scoreboard request that starts failing serves the
 * *same cached clocks*, so the signature does not move, and the reader is never
 * told that what they are looking at has stopped being current. Recovery is the
 * same fault pointed the other way — the values come back identical, nothing is
 * sent, and a warning nobody can clear stands on a healthy page.
 */
export function feedsMoved(previous: FeedState, next: FeedState): boolean {
  return (
    next.signature !== previous.signature ||
    next.projections !== previous.projections ||
    next.statuses.projections !== previous.statuses.projections ||
    next.statuses.stats !== previous.statuses.stats ||
    next.statuses.scores !== previous.statuses.scores
  );
}

/**
 * Which leagues of an answer moved since the last one sent, by comparing each
 * league's own serialisation — the delta a tick pushes rather than the whole
 * page.
 *
 * Returns the changed leagues serialised (so a room writes each once), the ids
 * that left, and the new map to hold for the next tick. A league is *changed*
 * where its JSON differs, which is the cheapest honest test: two solves that
 * print identically are one answer, whatever produced them.
 */
export function diffLeagues<T>(
  held: ReadonlyMap<string, string>,
  next: Readonly<Record<string, T>>,
): { changed: string[]; removed: string[]; serialised: Map<string, string> } {
  const serialised = new Map<string, string>();
  const changed: string[] = [];
  for (const [id, league] of Object.entries(next)) {
    const json = JSON.stringify(league);
    serialised.set(id, json);
    if (held.get(id) !== json) changed.push(id);
  }
  const removed = [...held.keys()].filter((id) => !(id in next));
  return { changed, removed, serialised };
}

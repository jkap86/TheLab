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
 * How often the feeds are re-read once the scoreboard reads the whole week
 * final, while the room is still **settling** — see {@link tickIntervalMs}.
 *
 * Slower than the live cadence, because nothing on the board can move any
 * more except a stat line catching up; faster than the failure cadence,
 * because the reads it makes are the ones that decide whether the numbers on
 * screen are the week's final ones.
 */
export const FINAL_SETTLE_INTERVAL_MS = 60_000;

/**
 * How long a room keeps reading after the scoreboard first reads all-final
 * with every feed healthy, before it stops for good.
 *
 * **The stats feed and the scoreboard are two requests on two caches**, so the
 * tick that first sees every game final may well be carrying stat lines read
 * a few seconds before the last play was filed — a successful stats response
 * says nothing about whether it is synchronised with the scoreboard beside
 * it. Ten minutes at the settling cadence is about ten more reads, which is
 * what lets the last plays of the late game land; it is also the whole of
 * what this catches. Sleeper's official stat corrections arrive hours or days
 * later and are deliberately outside it: a room that polled a finished week
 * for days to catch them is the picktracker's complete-draft waste wearing a
 * scoreboard, and a reload is what asks again.
 */
export const FINAL_SETTLE_WINDOW_MS = 10 * 60_000;

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

/** Every game on the board is over: nothing left to happen, only to settle. */
export function weekFinal(games: Record<GamePhase, number>): boolean {
  return games.live === 0 && games.pre === 0 && games.final > 0;
}

/**
 * How long between ticks, given where the week's games are — the **healthy**
 * cadence, and nothing else.
 *
 * **Null when nothing is left to happen** — every game final and none to come
 * — which is the whole point of the function: a finished week is a fact, not
 * a feed, and a room polling it forever is the picktracker's complete-draft
 * waste wearing a scoreboard. The stream stays open holding the final numbers.
 * What null does *not* decide is whether the room may stop yet: that is
 * {@link tickIntervalMs}'s, which reads this first and then asks whether the
 * numbers behind an all-final board are trustworthy and settled.
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
    return weekFinal(games) ? null : WAITING_INTERVAL_MS;
  }
  if (nextKickoff === null) return WAITING_INTERVAL_MS;
  const until = nextKickoff - KICKOFF_LEAD_MS - now;
  if (until <= 0) return LIVE_INTERVAL_MS;
  return Math.min(MAX_WAIT_MS, Math.max(WAITING_INTERVAL_MS, until));
}

/** The health of the three feeds a tick reads, as the wire spells it. */
export type FeedStatuses = Record<"projections" | "stats" | "scores", GametimeFeedStatus>;

/**
 * Both feeds a tick reads for itself failed — the projections board is cached
 * apart. This is the **stale-note** policy's own predicate: it counts a run of
 * these, and tells the readers at {@link STALE_AFTER_FAILURES}. It says
 * nothing about whether a tick's answer is one the room may stop on.
 */
export function feedsFailed(statuses: FeedStatuses): boolean {
  return statuses.stats === "error" && statuses.scores === "error";
}

/**
 * A feed the answer *needs* failed on this read — the **retry** policy's own
 * predicate, and deliberately a different question from {@link feedsFailed}.
 *
 * A tick with the scoreboard reading every game final and the stats feed
 * refusing prices the whole week as a projection under a `Final` caption; one
 * with the stats feed answering and the scoreboard refusing prices every
 * player with a line as half played. Both are ordinary Sundays to look at and
 * both are wrong, and the old rule — which read the pair as healthy unless
 * *both* had failed — let either become the room's last word: `pollIntervalMs`
 * answered null for the final board, the timer was never armed again, and a
 * page said `Final` over numbers nobody had finished reading. A failed
 * projections read counts too, since nothing can be seated without one.
 */
export function feedsIncomplete(statuses: FeedStatuses): boolean {
  return (
    statuses.projections === "error" ||
    statuses.stats === "error" ||
    statuses.scores === "error"
  );
}

/**
 * When the current unbroken run of **healthy, all-final** reads began, or
 * null where there is no such run — the whole of a room's settlement state,
 * folded one read at a time.
 *
 * The run starts on the first read that sees every game final with every feed
 * answering, holds across later reads that see the same, and is **broken by
 * any read that does not** — a game still to come (a flexed kickoff, a
 * scoreboard that un-finalled a game), or a feed that failed. Measured from
 * the first healthy read rather than from the first all-final observation, so
 * a feed that was down through the whole window and then answered once cannot
 * settle the room on that one answer: the clock starts when the numbers start
 * being trustworthy, not when the games stopped.
 */
export function settledSince(
  previous: number | null,
  input: { games: Record<GamePhase, number>; incomplete: boolean; now: number },
): number | null {
  if (!weekFinal(input.games) || input.incomplete) return null;
  return previous ?? input.now;
}

/**
 * How long between ticks once the scoreboard reads every game final, or null
 * once the room may stop — the **finalization policy**, named so it can be
 * argued with in one place.
 *
 * Three answers, in order:
 *
 * - **A read that could not be trusted keeps retrying at the failure
 *   cadence**, however final the board reads. A week whose stats feed is down
 *   is not finished, it is unread; the readers already see `stats: "error"` on
 *   every frame, and a room that stopped here would freeze that caption over
 *   projections for as long as the tab was open. The retry is bounded by the
 *   readers rather than by a count: a room with nobody in it closes after its
 *   linger, and one with somebody in it keeps asking every half minute, which
 *   is the same cost a failing live week already carries. There is no terminal
 *   `failed` state for the week, deliberately — the statuses on the wire *are*
 *   the explicit degraded state, per feed, and a healthy read is what clears
 *   them.
 * - **A healthy read inside the window keeps settling** at
 *   {@link FINAL_SETTLE_INTERVAL_MS}, so the stat lines have a bounded number
 *   of reads in which to catch the scoreboard up.
 * - **A healthy read past the window is the last one.** The window is measured
 *   from {@link settledSince}, so it is a run of trustworthy reads and not
 *   merely time since the games ended.
 *
 * The first healthy all-final read never settles the room, by construction:
 * the run began on that read, so nothing of the window has elapsed. A room
 * opened on a Tuesday, long after the week ended, therefore still spends the
 * window settling — about ten more reads — which is the price of one rule
 * rather than two and is modest against a reader who has the page open.
 */
export function finalizationIntervalMs(input: {
  incomplete: boolean;
  settledSince: number | null;
  now: number;
}): number | null {
  if (input.incomplete) return FAILURE_INTERVAL_MS;
  if (input.settledSince === null) return FINAL_SETTLE_INTERVAL_MS;
  return input.now - input.settledSince >= FINAL_SETTLE_WINDOW_MS
    ? null
    : FINAL_SETTLE_INTERVAL_MS;
}

/**
 * The one cadence decision a room makes after every read, healthy or not.
 *
 * A run of wholly failed reads is the failure cadence (the stale-note policy's
 * own count decides that, and nothing here second-guesses it). Otherwise the
 * healthy cadence answers wherever a game is still to be played, and where it
 * has nothing left to say — every game final — the finalization policy above
 * decides whether the room may stop. **Null is the only way a room stops**,
 * and it is reachable only through that last arm.
 */
export function tickIntervalMs(input: {
  /** Consecutive reads on which both live feeds failed — `feedsFailed`'s count. */
  failures: number;
  games: Record<GamePhase, number>;
  nextKickoff: number | null;
  now: number;
  /** `feedsIncomplete` of the latest read. */
  incomplete: boolean;
  /** `settledSince`, folded through the latest read. */
  settledSince: number | null;
}): number | null {
  if (input.failures > 0) return FAILURE_INTERVAL_MS;
  const healthy = pollIntervalMs(input);
  if (healthy !== null) return healthy;
  return finalizationIntervalMs(input);
}

/**
 * The earliest kickoff among games that have not started, epoch ms, or null
 * where none is known.
 *
 * **One spelling for the room and the page.** The room's cadence waits on it
 * (`pollIntervalMs` above) and the gametime page's status pill counts down to
 * it, so the two agree about which kickoff is next by construction. A pill
 * counting to one game while the room slept until another would be a countdown
 * that reached zero and then sat there, with nothing polling for the snap it
 * had just promised.
 *
 * **A kickoff already past is still the next one while its game reads `pre`.**
 * The scoreboard flips a game to live a tick or two after it starts, and a
 * weather delay holds it there longer. Filtering to the future would have the
 * pill count down to the four o'clock window while the one o'clock games were
 * lining up — and have the room sleep through their snap. Past is imminent,
 * which is exactly how `pollIntervalMs` already reads it.
 *
 * Generic over anything carrying a phase and a kickoff, so the server's clock
 * map and the wire's board are both its input without either being converted.
 */
export function nextKickoff(
  games: Iterable<{ phase: GamePhase; kickoff: number | null }>,
): number | null {
  let earliest: number | null = null;
  for (const game of games) {
    if (game.phase !== "pre" || game.kickoff === null) continue;
    if (earliest === null || game.kickoff < earliest) earliest = game.kickoff;
  }
  return earliest;
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

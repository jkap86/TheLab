/**
 * The decisions a gametime room makes on every tick, kept pure so a test can
 * drive them without a Sleeper behind them — `./live` holds the timers and the
 * subscriber sets, which cannot be. `picktracker/live-rules`' arrangement.
 */

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
 * A lineup changes until its players lock, and the manager sync or a Sync key
 * press is what writes the change; three minutes is how late such a change is
 * reflected on a page that was already open, against a Postgres read per
 * subscriber per interval. A press on the page's own Sync key re-reads its
 * league at once through the plain route, so this bounds only the change made
 * elsewhere.
 */
export const LEAGUES_TTL_MS = 3 * 60_000;

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

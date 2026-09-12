import { awaitShared, getNflWeekScores, withBackgroundSleeper } from "@/shared/sleeper";

import { gameClocks } from "./game-clock";
import type { GameClock } from "./game-clock";

/**
 * How long a week's game clocks answer for.
 *
 * **Twenty seconds against `./kickoff`'s twelve hours**, and they read the
 * same feed: a schedule barely moves and a clock moves every play. Two caches
 * over one fetch rather than one cache with a short TTL, because the kickoff
 * reader is on the lineup checker's request path a hundred times a page and
 * has no use for a clock — refetching the scoreboard every twenty seconds for
 * it would be the cost this cache exists to avoid, paid by a reader who never
 * asked. Twenty is the gametime room's own tick, so the room and the plain
 * route share one fetch per tick.
 */
export const LIVE_SCORES_TTL_MS = 20 * 1000;

/**
 * One week's clocks, and whether the scoreboard could be read for them.
 *
 * `ok: false` is a stale answer, or none: the last fetch failed and what is
 * here is whatever the previous one said, which for a reader deciding how much
 * of a game is left is a claim about twenty seconds ago at best. The payload
 * carries it as `scores: "error"`, and the solve prices every projection
 * whole rather than against a clock it cannot trust.
 */
export type WeekClocksRead = {
  clocks: Map<string, GameClock>;
  ok: boolean;
  /** When these clocks were read, epoch ms. */
  at: number;
};

type CacheEntry = {
  /** The last successful read, if any. */
  held: WeekClocksRead | null;
  /** The fetch in flight, so concurrent callers share one. */
  inflight: Promise<WeekClocksRead> | null;
};

const CACHE_KEY = Symbol.for("thelab.schedule.clocks");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<string, CacheEntry>;
};
const cache = (globalScope[CACHE_KEY] ??= new Map<string, CacheEntry>());

/** Weeks kept at once — a stepper's working set, `week-read`'s own bound. */
const MAX_CACHED_WEEKS = 4;

/**
 * Team → game clock for one week, read from the live scoreboard.
 *
 * `./kickoff`'s three rules, on a clock that is seconds rather than hours:
 * a failed fetch stores nothing and serves the stale entry marked `ok: false`;
 * concurrent callers share one fetch; and **it never throws** — everything read
 * off this sits on top of a week's lineups rather than under them, so the
 * degraded answer is "no clocks", which the solve spells for itself.
 *
 * A week Sleeper has not scheduled answers an empty map with `ok: true`, which
 * is a true answer about the week rather than a failure, and is cached for the
 * TTL like any other.
 */
export async function getWeekGameClocks(
  season: string,
  week: number,
): Promise<WeekClocksRead> {
  const key = `${season}:${week}`;
  const entry = cache.get(key) ?? { held: null, inflight: null };
  if (!cache.has(key)) {
    cache.set(key, entry);
    while (cache.size > MAX_CACHED_WEEKS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  if (entry.held && Date.now() - entry.held.at < LIVE_SCORES_TTL_MS) {
    return entry.held;
  }
  if (entry.inflight) return join(entry, entry.inflight);

  // **Background, though a reader is often what asks first** — `shared-wait`'s
  // producer half. One scoreboard read serves every reader of the week and
  // every twenty-second tick of the room they are watching, so the class of
  // whoever arrived first must not be the class it runs under; and a reader's
  // disconnect must not reject the clocks the room is about to price a whole
  // week against.
  entry.inflight = withBackgroundSleeper(async () => {
    try {
      const clocks = gameClocks(await getNflWeekScores(season, week));
      const read: WeekClocksRead = { clocks, ok: true, at: Date.now() };
      entry.held = read;
      return read;
    } catch {
      // Stale rather than nothing, and marked: the previous answer is worth
      // more than an empty map to a reader mid-game, and worth exactly as much
      // as its own age says.
      return degraded(entry);
    } finally {
      entry.inflight = null;
    }
  });

  return join(entry, entry.inflight);
}

/**
 * Wait on the read in flight for no longer than this caller's own request has
 * left — and answer the degraded read rather than throwing when it runs out.
 *
 * **The waiter half, kept inside this module's own promise never to throw.**
 * Everything read off these clocks sits on *top* of a week's lineups rather
 * than under them, so a caller whose budget expires mid-fetch wants the same
 * answer a failed fetch gives it: whatever was last read, marked `ok: false`,
 * which the payload carries as `scores: "error"` and the solve prices every
 * projection whole against. The fetch itself is untouched and lands for the
 * next reader.
 */
function join(entry: CacheEntry, inflight: Promise<WeekClocksRead>) {
  return awaitShared(inflight, { label: "the live scoreboard" }).catch(() =>
    degraded(entry),
  );
}

/** The last successful read if there is one, marked as not current. */
function degraded(entry: CacheEntry): WeekClocksRead {
  return {
    clocks: entry.held?.clocks ?? new Map<string, GameClock>(),
    ok: false,
    at: entry.held?.at ?? Date.now(),
  };
}

/**
 * The two decisions a draft room makes on every tick, kept pure so they can be
 * driven by a test without a Sleeper behind them — `live.ts` holds the timers
 * and the subscriber set, which cannot be.
 */

/** How often a room polls a draft that is being made. */
export const DRAFTING_INTERVAL_MS = 15_000;

/**
 * How often a room polls a draft that has not started.
 *
 * Four times slower, because nothing is happening: the room is waiting for a
 * commissioner to start the draft, which is a thing that happens on a schedule
 * rather than every few seconds. A room parked on a `pre_draft` league
 * overnight is the case this bound exists for.
 */
export const PRE_DRAFT_INTERVAL_MS = 60_000;

/**
 * How often a room polls after a tick failed.
 *
 * Deliberately longer than either healthy cadence: a failing Sleeper is not a
 * thing to ask harder, and the reader has already been told the board stopped
 * moving. The same reasoning the crawler's two-column throttle is built on —
 * "how often may this be asked for" is a different question from "is work
 * needed".
 */
export const FAILURE_INTERVAL_MS = 30_000;

/**
 * How many consecutive failures before the room says so.
 *
 * One failed tick is a blip and saying so would make the board cry wolf every
 * time a request times out; three in a row is a minute and a half of a board
 * that has silently stopped moving, which a reader setting a lineup against it
 * needs to know.
 */
export const STALE_AFTER_FAILURES = 3;

/**
 * How long a room polls with nobody watching before it gives up.
 *
 * Zero — the room is torn down by its last subscriber leaving. Named here so
 * the invariant is written down rather than merely implemented: a poller that
 * outlives its subscribers is a Sleeper request every fifteen seconds, forever,
 * for a draft nobody is reading, and nothing on any screen would ever say so.
 */
export const EMPTY_ROOM_GRACE_MS = 0;

/**
 * How long between ticks, given the draft's own status.
 *
 * **`complete` answers null, and that is the whole point of the function.** A
 * finished draft is a fact rather than a feed: the room pushes one last board
 * and clears its timer, and the stream stays open holding something that will
 * not change. Polling a complete draft forever is the same waste as a room
 * with no subscribers, wearing a status that says it is fine.
 *
 * An unrecognised status falls to the *drafting* cadence rather than the slow
 * one. Sleeper's vocabulary is not exhaustively documented, and the honest
 * failure is an extra request — the rule `crawl-ttl` already applies to an
 * unparseable date.
 */
export function pollIntervalMs(draftStatus: string): number | null {
  if (draftStatus === "complete") return null;
  if (draftStatus === "pre_draft") return PRE_DRAFT_INTERVAL_MS;
  return DRAFTING_INTERVAL_MS;
}

/**
 * The cheapest honest signal that a board has changed.
 *
 * `last_picked` is Sleeper's own epoch-ms stamp of the most recent pick, which
 * is exactly this question while a draft runs — the "running edge" this repo's
 * `SleeperDraft` doc warns against reading as an *end*, used for the one thing
 * it is right for. It is paired with the kicker count rather than trusted
 * alone, because a pick of a non-kicker moves `last_picked` and changes nothing
 * on this board, and with the status so that a draft *completing* is a change
 * even though its last pick is not new.
 *
 * A null `last_picked` is a draft nobody has picked in and is spelled rather
 * than coerced: `0` is a real epoch and "unknown" is not a time.
 */
export function boardSignature(input: {
  draft_status: string;
  last_picked: number | null;
  pickCount: number;
}): string {
  const edge = input.last_picked === null ? "none" : String(input.last_picked);
  return `${input.draft_status}:${edge}:${input.pickCount}`;
}

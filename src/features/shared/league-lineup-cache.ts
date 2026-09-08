"use client";

import type { LeagueLineupPayload } from "@/shared/contract";

/**
 * One shared, bounded store of per-league lineup answers, keyed by the whole
 * question that produced each.
 *
 * **It exists because the manager page stopped batching them.** That page used
 * to receive every league's teams in one response and hand each card its own;
 * it now receives ranks alone and a card reads its league when a reader opens
 * it (see `LeagueLineupSummary`). Three things follow from that, and none of
 * them is served by a hook holding its own state:
 *
 * - **Two cards must not ask the same question twice.** A trade card and a
 *   manager card can name one league, and a page can mount a card twice across
 *   a re-render. One entry per key, one request behind it, every reader served
 *   from it.
 * - **Closing a card must not throw its answer away**, and re-opening it must
 *   not pay again. The answer outlives the component that asked for it.
 * - **And it must not outlive it for ever.** A reader who opens forty cards
 *   would otherwise retain forty twelve-team solves — which is the batched
 *   payload's own failure, arrived at one press at a time. {@link MAX_ENTRIES}
 *   is the bound, and it is enforced against *unsubscribed* entries only: an
 *   answer being rendered is never evicted out from under its card.
 *
 * **A stale response cannot overwrite a current one, by construction.** The key
 * is the whole question — league, season, manager, column, narrowing — so a
 * response for the previous manager resolves into the previous manager's entry
 * and no reader of the current key ever looks at it. That is the same
 * protection `request-guard` gives a hook that owns its own state, obtained
 * here from the shape of the store rather than from a ticket.
 *
 * **An in-flight read is aborted when its last reader goes**, and a resolved
 * one is kept. A partial answer is worth nothing to anybody, where a complete
 * one is worth exactly what re-opening a card costs.
 */

/**
 * How many league answers are held at once.
 *
 * A twelve-team entry is tens of kilobytes parsed — the batched payload's ~5MB
 * was a hundred of them — so a handful is a bound a phone can carry and enough
 * that walking back through the cards a reader has been comparing costs
 * nothing. Entries with a live subscriber are never counted out; this bounds
 * what is kept *for later*.
 */
export const MAX_ENTRIES = 8;

/** What a reader of one key sees. */
export type LeagueLineupState = {
  payload: LeagueLineupPayload | null;
  loading: boolean;
  error: string | null;
};

/** The state of a key nothing has asked about yet. */
const IDLE: LeagueLineupState = { payload: null, loading: false, error: null };
const LOADING: LeagueLineupState = { payload: null, loading: true, error: null };

type Listener = () => void;

type Entry = {
  state: LeagueLineupState;
  listeners: Set<Listener>;
  controller: AbortController | null;
  /**
   * How this key is answered, kept so an invalidation can ask again.
   *
   * The loader is the *reader's* — it closes over the route, the season and the
   * column — and every reader of one key sends the identical request by
   * construction, since all of that is in the key. The most recent subscriber's
   * is what an invalidation re-runs.
   */
  load: LeagueLineupLoader | null;
  /** Bumped by {@link invalidateLeagueLineups}; a response for an older run is dropped. */
  run: number;
  /** Last read or write, for the eviction order. */
  at: number;
};

/**
 * On `globalThis`, for the reason the server's own memos are: Next can hand a
 * route's client bundle and a shared chunk two module instances in development,
 * and two stores would be two requests for one league with neither able to see
 * the other's answer.
 */
const STORE_KEY = Symbol.for("thelab.leagueLineupCache");
const scope = globalThis as typeof globalThis & {
  [STORE_KEY]?: Map<string, Entry>;
};
const entries = (): Map<string, Entry> => (scope[STORE_KEY] ??= new Map());

/** What a key reads right now — {@link IDLE} for one nothing has asked about. */
export function peekLeagueLineup(key: string): LeagueLineupState {
  return entries().get(key)?.state ?? IDLE;
}

function publish(entry: Entry, state: LeagueLineupState): void {
  entry.state = state;
  entry.at = Date.now();
  for (const listener of [...entry.listeners]) listener();
}

/**
 * Evict resolved entries nothing is reading, oldest first, until the store is
 * inside its bound.
 *
 * **Subscribed entries are skipped rather than counted**: they are on screen,
 * and dropping one would blank a card that is being looked at and re-fetch it
 * on the next render. So the bound is a bound on what is kept *for later*, and
 * a reader with more cards open than {@link MAX_ENTRIES} simply holds them all
 * — which is a page they can see rather than a cache they cannot.
 */
function trim(): void {
  const map = entries();
  if (map.size <= MAX_ENTRIES) return;
  const droppable = [...map.entries()]
    .filter(([, entry]) => entry.listeners.size === 0)
    .sort((a, b) => a[1].at - b[1].at);
  let over = map.size - MAX_ENTRIES;
  for (const [key] of droppable) {
    if (over <= 0) break;
    map.delete(key);
    over -= 1;
  }
}

function start(key: string, entry: Entry, load: LeagueLineupLoader): void {
  const controller = new AbortController();
  const run = entry.run;
  entry.controller = controller;
  publish(entry, LOADING);

  // A run past the first is an invalidation's — see {@link LeagueLineupLoader}.
  void load(controller.signal, { reload: run > 0 }).then(
    (payload) => {
      // Neither our own run nor our own entry: an invalidation, or a release
      // that dropped this key and a fresh reader that re-created it.
      if (entries().get(key) !== entry || entry.run !== run) return;
      entry.controller = null;
      publish(entry, { payload, loading: false, error: null });
      trim();
    },
    (error: unknown) => {
      if (entries().get(key) !== entry || entry.run !== run) return;
      if (controller.signal.aborted) return;
      entry.controller = null;
      publish(entry, {
        payload: null,
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to load the league",
      });
    },
  );
}

/**
 * How a key is answered, given the store's own signal for this attempt.
 *
 * `reload` is true for an attempt {@link invalidateLeagueLineups} asked for,
 * and it is not a nicety: the route answers `Cache-Control: private,
 * max-age=60`, which is what makes a card closed and re-opened free — and is
 * exactly wrong for the one case an invalidation exists for, a sync having just
 * rewritten the rosters. A loader that reaches the network must honour it.
 */
export type LeagueLineupLoader = (
  signal: AbortSignal,
  options: { reload: boolean },
) => Promise<LeagueLineupPayload>;

/**
 * Read `key`, starting the request if nothing has, and be told when it moves.
 *
 * Returns the release function the caller must run on unmount or on a key
 * change. Releasing the **last** reader of an in-flight request aborts it and
 * drops the entry — a half-read answer is worth nothing and the next reader
 * would rather start clean; releasing the last reader of a *resolved* one
 * leaves it for {@link trim} to decide.
 */
export function acquireLeagueLineup(
  key: string,
  load: LeagueLineupLoader,
  onChange: Listener,
): () => void {
  const map = entries();
  let entry = map.get(key);
  if (!entry) {
    entry = {
      state: IDLE,
      listeners: new Set(),
      controller: null,
      load: null,
      run: 0,
      at: Date.now(),
    };
    map.set(key, entry);
  }
  const held = entry;
  held.listeners.add(onChange);
  held.load = load;
  held.at = Date.now();

  // Nothing has answered and nothing is asking. A *failed* entry is
  // deliberately not retried here: the two hooks that read this latch `enabled`
  // one-way, so a second subscriber is a second card rather than a fresh
  // attempt, and re-issuing on every mount would turn a failing league into a
  // request per render. {@link invalidateLeagueLineups} is the way back.
  if (held.state === IDLE) start(key, held, load);

  return () => {
    held.listeners.delete(onChange);
    if (held.listeners.size > 0) return;
    if (held.controller) {
      held.controller.abort();
      held.controller = null;
      map.delete(key);
      return;
    }
    trim();
  };
}

/**
 * Ask again for the keys `matches` accepts — every key when it is omitted.
 *
 * **What this is for is a sync landing.** A league's stored rosters move when
 * the manager sync or the crawler writes them, and an entry read before that
 * write is an answer that was true. A key still being read is re-fetched in
 * place (its card shows its loading line and then the new numbers); a key
 * nothing is reading is simply dropped, which is the same thing one press
 * later.
 *
 * Answers already in flight are aborted and their runs invalidated, so a
 * response that predates the invalidation cannot land after the one that
 * replaces it.
 */
export function invalidateLeagueLineups(
  matches: (key: string) => boolean = () => true,
): number {
  const map = entries();
  let dropped = 0;
  for (const [key, entry] of [...map]) {
    if (!matches(key)) continue;
    dropped += 1;
    entry.run += 1;
    entry.controller?.abort();
    entry.controller = null;
    if (entry.listeners.size === 0 || entry.load === null) {
      map.delete(key);
      continue;
    }
    // **Asked again here rather than by the reader**, and that is the half this
    // would be silently missing without: a hook's effect depends on the key,
    // which an invalidation does not change, so nothing on the far side would
    // ever re-run. The card holding this key shows its loading line and then
    // the new numbers.
    start(key, entry, entry.load);
  }
  return dropped;
}

/** For tests. */
export function clearLeagueLineups(): void {
  for (const entry of entries().values()) entry.controller?.abort();
  entries().clear();
}

/** For tests and diagnostics. */
export function leagueLineupCacheSize(): number {
  return entries().size;
}

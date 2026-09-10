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
 *   is the bound, and it is enforced *over* the unsubscribed entries rather
 *   than over the store: an answer being rendered is never evicted out from
 *   under its card, and never counted against the cache either.
 *
 * **A stale response cannot overwrite a current one, by construction.** The key
 * is the whole question — league, season, manager, column, narrowing — so a
 * response for the previous manager resolves into the previous manager's entry
 * and no reader of the current key ever looks at it. That is the same
 * protection `request-guard` gives a hook that owns its own state, obtained
 * here from the shape of the store rather than from a ticket.
 *
 * **An entry is kept only for what it can serve, and that is one rule rather
 * than three.** A resolved answer is worth exactly what re-opening a card
 * costs, so it is kept when its last reader goes; an in-flight read is aborted
 * and dropped, because a partial answer is worth nothing to anybody; and a
 * *failed* one is dropped for the same reason — there is nothing behind it to
 * hand the next reader. See {@link acquireLeagueLineup}'s release, which is
 * where the three meet, and the note there on the retry that used to be
 * unreachable.
 */

/**
 * How many league answers are held at once.
 *
 * A twelve-team entry is tens of kilobytes parsed — the batched payload's ~5MB
 * was a hundred of them — so a handful is a bound a phone can carry and enough
 * that walking back through the cards a reader has been comparing costs
 * nothing.
 *
 * **It counts the entries nothing is reading**, which is the unit {@link trim}
 * enforces it in: an entry with a live subscriber is a card on screen rather
 * than a cache, so it is neither evicted nor counted against this. The store
 * therefore holds up to this many *plus* whatever is open, and an open card
 * costs the cache nothing.
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
  /**
   * When this entry was last created, written or read — as a sequence number
   * rather than a clock. It is the eviction order and nothing else.
   *
   * **A counter, because ties are the common case and a clock has none of the
   * resolution to break them.** Several cards mount in one frame and settle in
   * one microtask drain, so a millisecond timestamp hands a whole batch the
   * same key and the order among them falls to whatever the sort does with
   * equal ones. A sequence number is exactly what a least-recently-used order
   * needs, and it cannot go backwards.
   */
  at: number;
};

/**
 * On `globalThis`, for the reason the server's own memos are: Next can hand a
 * route's client bundle and a shared chunk two module instances in development,
 * and two stores would be two requests for one league with neither able to see
 * the other's answer.
 */
const STORE_KEY = Symbol.for("thelab.leagueLineupCache");
const CLOCK_KEY = Symbol.for("thelab.leagueLineupCache.clock");
const scope = globalThis as typeof globalThis & {
  [STORE_KEY]?: Map<string, Entry>;
  [CLOCK_KEY]?: number;
};
const entries = (): Map<string, Entry> => (scope[STORE_KEY] ??= new Map());

/** The next {@link Entry.at}. On `globalThis` for the store's own reason. */
const touch = (): number => (scope[CLOCK_KEY] = (scope[CLOCK_KEY] ?? 0) + 1);

/** What a key reads right now — {@link IDLE} for one nothing has asked about. */
export function peekLeagueLineup(key: string): LeagueLineupState {
  return entries().get(key)?.state ?? IDLE;
}

function publish(entry: Entry, state: LeagueLineupState): void {
  entry.state = state;
  entry.at = touch();
  for (const listener of [...entry.listeners]) listener();
}

/**
 * Evict resolved entries nothing is reading, oldest first, until at most
 * {@link MAX_ENTRIES} of them are kept.
 *
 * **Subscribed entries are skipped rather than counted**: they are on screen,
 * and dropping one would blank a card that is being looked at and re-fetch it
 * on the next render. So the bound is a bound on what is kept *for later*, and
 * a reader with more cards open than {@link MAX_ENTRIES} simply holds them all
 * — which is a page they can see rather than a cache they cannot.
 *
 * **The overflow is counted over the droppable entries, not over the map**, and
 * that is the one line here that is silent when wrong. Counted over the map, a
 * card left open pays for itself twice: it is exempt from eviction *and* it
 * takes one of the eight slots, so one open league and eight closed ones evict
 * a closed one to reach a total of nine — a reader who opened a card is handed
 * a smaller cache than a reader who did not. Every card open takes another,
 * until a page with eight cards open caches nothing at all and every re-open
 * pays a round trip. Counted over the droppable set, an open card costs the
 * cache nothing and the bound means what {@link MAX_ENTRIES} says it means.
 *
 * The ceiling is still finite, and it is `MAX_ENTRIES + the cards on screen`:
 * subscribed entries can push the map past the bound while they are being read
 * and every one of them is released by the component that holds it, at which
 * point it joins the droppable set and this trims for it. That is the same
 * trade the paragraph above makes — a bound on what is kept for later, never on
 * what a reader is looking at.
 */
function trim(): void {
  const map = entries();
  if (map.size <= MAX_ENTRIES) return;
  const droppable = [...map.entries()]
    .filter(([, entry]) => entry.listeners.size === 0)
    .sort((a, b) => a[1].at - b[1].at);
  let over = droppable.length - MAX_ENTRIES;
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
      at: touch(),
    };
    map.set(key, entry);
  }
  const held = entry;
  held.listeners.add(onChange);
  held.load = load;
  held.at = touch();

  // Nothing has answered and nothing is asking. A *failed* entry that still has
  // a reader is deliberately not retried here — a second card on the same
  // league is a second card, not a fresh attempt, and re-issuing per subscriber
  // is the request-per-render this store exists to avoid. What makes that safe
  // is that a failed entry with **no** reader is dropped on its way out, so the
  // reader who comes back finds nothing and starts clean. See the release.
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
    // **A failed entry goes with its last reader, and that is a retry bug
    // rather than a tidy-up.** It used to stay, and `acquire` starts a request
    // only for a key in {@link IDLE} — so a card whose read failed, was closed
    // and was opened again found the entry still there, still holding the old
    // message, and asked for nothing. The only ways out were a global
    // invalidation (a sync landing, which a reader cannot cause) or eviction
    // (which skips entries nothing is reading and so could not reach it):
    // opening the card again, which is the one thing anybody would try, was a
    // no-op for the life of the page.
    //
    // Dropped, the next reader creates a fresh entry and starts clean, which is
    // the in-flight rule one state over — an entry with no payload has nothing
    // to serve, so keeping it buys nobody anything and costs the retry. It is
    // the *release* rather than the acquire because that is what tells a second
    // card apart from a second visit: while the failed card stays open the
    // entry stands and every subscriber reads the message, so nothing here can
    // become a request per mount.
    //
    // No cooldown, deliberately: a re-acquire is a card being opened, and the
    // effect that acquires depends on the key and the disclosure rather than on
    // a render, so there is no churn for one to damp. A clock here would be a
    // second staleness policy answering a question nothing asks.
    if (held.state.payload === null) {
      map.delete(key);
      return;
    }
    // **Touched on the way out, because it was in use until this instant.**
    // `at` is otherwise the last *write*, so an entry read for ten minutes and
    // one written ten minutes ago and never looked at again sort identically —
    // and the card a reader has just closed, being the one most likely to be
    // re-opened, is then the first thing evicted. A subscribed entry is being
    // read for as long as it is subscribed; this is where that ends.
    held.at = touch();
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

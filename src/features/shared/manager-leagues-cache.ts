"use client";

import type { ManagerLeague, SyncProgress, UserInfo } from "@/shared/contract";

/**
 * One shared store of manager league lists, keyed by the whole question that
 * produced each — so the read happens when a reader arrives on the *site*
 * rather than when they arrive on a *tool*.
 *
 * **Three tools read one stream.** `/manager`, `/lineupchecker` and `/gametime`
 * all mount `useManagerLeagues` over the same account and the same season, and
 * every one of them used to open its own `GET /api/user/[username]/leagues`: a
 * Postgres read of the whole graph, ~519KB of NDJSON on a 113-league account, a
 * progress bar back on screen, and — once the route's own TTL had elapsed — a
 * Sleeper fan-out. Walking between three tools that list the same leagues paid
 * for that list three times, and what a reader saw for it was the page they had
 * just been looking at going blank and filling in again.
 *
 * So the answer outlives the component that asked for it, and the module scope
 * holding it outlives every client-side navigation between tools. What resets
 * it is a fresh document: a reload, a typed URL, a first visit.
 *
 * **An in-flight stream is kept when its last reader leaves**, which is the one
 * rule this store does not share with `league-lineup-cache` and the one that
 * makes the whole thing work during a cold sync. Three reasons, and the third
 * is decisive:
 *
 * - The sync on the other end is *already* not cancelled by a disconnect — see
 *   the route's `closed` — so aborting buys the server nothing and costs the
 *   next tool the entire stream again.
 * - A cold sync is minutes rather than milliseconds, so a half-read leagues
 *   stream is not the worthless thing a half-read league answer is: by the time
 *   a reader navigates it has usually served cache, or progress lines, or both.
 * - **A navigation has a beat with no subscriber.** The old page's cleanup runs
 *   before the new page's effect, so a store that dropped in-flight entries at
 *   zero readers would restart the stream on every tool change — which is
 *   exactly the case this exists to remove, reintroduced by its own eviction
 *   rule.
 *
 * What that costs is one connection left open for a reader who has walked away
 * from all three tools, and it ends when the server closes the stream.
 *
 * **There is no TTL here, deliberately.** Freshness is the route's policy —
 * `SYNC_TTL_MS`, the crawler's seasonal tiers, and the `stale` flag it answers
 * with, which the page draws as a readout beside the list. A clock in this
 * store would be a second staleness policy answering a question the route
 * already answers, and what it would buy is the progress bar coming back
 * mid-session, which is the thing being removed.
 *
 * **A stale response cannot overwrite a current one, by construction.** The key
 * is the whole question — the manager and the season — so a message from the
 * previous manager's stream resolves into the previous manager's entry, which
 * nothing is reading. That is the protection `request-guard` gives a hook that
 * owns its own state, obtained here from the shape of the store, which is why
 * the hook no longer takes a ticket.
 *
 * It stays out of `features/shared/index.ts` on `local-store.ts`'s rule: only
 * this folder's own `use-manager-leagues` builds on it.
 */

/**
 * How many league lists are held for a reader who is not looking at them.
 *
 * **Two, where `league-lineup-cache` holds eight, and the unit is why.** An
 * entry there is one league's twelve solved rosters; an entry here is a whole
 * account's league list — the largest single thing this app parses in a browser
 * — so the bound is what a phone can carry rather than what is convenient. Two
 * is the account being read plus the one before it, which is what makes looking
 * somebody else up and coming back free.
 *
 * **It counts the entries nothing is reading**, which is the unit {@link trim}
 * enforces it in and for `MAX_ENTRIES`' own reason one store over: an entry
 * with a live subscriber is a page on screen rather than a cache, so it is
 * neither evicted nor counted against this.
 */
export const MAX_ENTRIES = 2;

export type ManagerLeaguesState = {
  user: UserInfo | null;
  season: string | null;
  leagues: ManagerLeague[];
  /**
   * The leagues shown are not known-current.
   *
   * Three things set it and the page treats them alike: the route saying so on
   * a `result`, a refresh that failed behind the list, and a stream that ended
   * without ever closing. The last is why it is not simply "a refresh is
   * coming" — a refresh that never arrives leaves the data exactly as stale as
   * one that was never attempted, and the page has to be able to say so. Read
   * with `refreshing` false, it means "this is cache and the refresh did not
   * complete".
   */
  stale: boolean;
  /** A sync is running and a second result is expected on this stream. */
  refreshing: boolean;
  /** Per-league progress while a sync runs, or null between them. */
  progress: SyncProgress | null;
  /** Nothing could be shown at all. */
  error: string | null;
  /**
   * A refresh failed *behind* leagues already on screen.
   *
   * Separate from `error` because the two want opposite treatments: this one
   * sits beside a usable list as a note, where `error` replaces the page. The
   * distinction is the whole point of sending cache first.
   */
  refreshError: string | null;
};

/** Nothing in flight and nothing to show — the shape every failure resets to. */
export const EMPTY: ManagerLeaguesState = {
  user: null,
  season: null,
  leagues: [],
  stale: false,
  refreshing: false,
  progress: null,
  error: null,
  refreshError: null,
};

/**
 * A request is out and the stream has said nothing yet.
 *
 * **`refreshing` is true here because "no leagues" and "no answer yet" are
 * different claims and only one of them is true at mount.** Starting from
 * {@link EMPTY} renders the empty state — a page reading "No leagues found" —
 * for the whole round trip, which on a cold manager is the entire sync and is
 * exactly wrong: it says a manager has no leagues at the moment we are busy
 * fetching them.
 *
 * It is also what {@link peekManagerLeagues} answers for a key nothing has
 * asked about, which is the same claim one beat earlier: the effect that is
 * about to run will ask.
 */
export const PENDING: ManagerLeaguesState = { ...EMPTY, refreshing: true };

/** How the store hands a running stream its state. */
export type ManagerLeaguesCommit = (
  next:
    | ManagerLeaguesState
    | ((state: ManagerLeaguesState) => ManagerLeaguesState),
) => void;

/**
 * How a key is answered.
 *
 * It is a *sequence* of states rather than a value that resolves once, which is
 * the shape of the route it reads: cache, then a progress line per league, then
 * a closing result. So the runner commits as it goes and its promise settles
 * when the stream ends, however it ended — the runner catches its own failures
 * and turns them into a committed state, so a settled promise here means only
 * that the entry has stopped moving.
 */
export type ManagerLeaguesStream = (
  signal: AbortSignal,
  commit: ManagerLeaguesCommit,
) => Promise<void>;

type Listener = () => void;

type Entry = {
  state: ManagerLeaguesState;
  listeners: Set<Listener>;
  /** Non-null while the stream is open — see the release, which keeps it. */
  controller: AbortController | null;
  /**
   * When this entry was last created, written or read — a sequence number
   * rather than a clock, for `league-lineup-cache`'s reason: ties are the
   * common case and a millisecond has none of the resolution to break them.
   */
  at: number;
};

/**
 * On `globalThis`, for the reason the server's own memos are: Next can hand a
 * route's client bundle and a shared chunk two module instances in development,
 * and two stores would be two streams for one account with neither able to see
 * the other's answer.
 */
const STORE_KEY = Symbol.for("thelab.managerLeaguesCache");
const CLOCK_KEY = Symbol.for("thelab.managerLeaguesCache.clock");
const scope = globalThis as typeof globalThis & {
  [STORE_KEY]?: Map<string, Entry>;
  [CLOCK_KEY]?: number;
};
const entries = (): Map<string, Entry> => (scope[STORE_KEY] ??= new Map());

/** The next {@link Entry.at}. On `globalThis` for the store's own reason. */
const touch = (): number => (scope[CLOCK_KEY] = (scope[CLOCK_KEY] ?? 0) + 1);

/**
 * The whole question one account is asked, as one string.
 *
 * The separator is a NUL because neither a Sleeper username nor a season can
 * contain one, so no two subjects can spell the same key. It is written as an
 * escape rather than as a literal byte so this module stays text to `grep` —
 * the hook's own copy of this line was not, which is how it hid from a search
 * for its own name.
 */
export function managerLeaguesKey(username: string, season?: string): string {
  return `${username}\u0000${season ?? ""}`;
}

/** What a key reads right now — {@link PENDING} for one nothing has asked about. */
export function peekManagerLeagues(key: string): ManagerLeaguesState {
  return entries().get(key)?.state ?? PENDING;
}

function publish(entry: Entry, state: ManagerLeaguesState): void {
  entry.state = state;
  entry.at = touch();
  for (const listener of [...entry.listeners]) listener();
}

/**
 * Evict entries nothing is reading, oldest first, until at most
 * {@link MAX_ENTRIES} of them are kept.
 *
 * **Subscribed entries are skipped rather than counted**, and the overflow is
 * counted over the droppable set rather than over the map — both for
 * `league-lineup-cache`'s reasons, which are stated at length there: an entry
 * being read is a page on screen, and counting it would hand a reader who has a
 * page open a smaller cache than one who does not.
 *
 * **Evicting an in-flight entry aborts it**, which is the only thing that ever
 * aborts one of these streams. The release deliberately does not — see the
 * store's own note — so this is what bounds how many abandoned streams a reader
 * walking between several accounts can leave open.
 */
function trim(): void {
  const map = entries();
  if (map.size <= MAX_ENTRIES) return;
  const droppable = [...map.entries()]
    .filter(([, entry]) => entry.listeners.size === 0)
    .sort((a, b) => a[1].at - b[1].at);
  let over = droppable.length - MAX_ENTRIES;
  for (const [key, entry] of droppable) {
    if (over <= 0) break;
    entry.controller?.abort();
    map.delete(key);
    over -= 1;
  }
}

function start(key: string, entry: Entry, run: ManagerLeaguesStream): void {
  const controller = new AbortController();
  entry.controller = controller;
  // Nothing is published here: an entry is born {@link PENDING} and this is the
  // only thing that ever creates one, so a publish would be the state it
  // already holds — one notification per reader, per mount, for no transition.

  const commit: ManagerLeaguesCommit = (next) => {
    // Not our own entry any more: evicted by `trim`, or dropped by a release
    // and re-created by a fresh reader. Its messages are about a question
    // nobody is asking.
    if (entries().get(key) !== entry) return;
    publish(entry, typeof next === "function" ? next(entry.state) : next);
  };

  const done = () => {
    if (entries().get(key) !== entry) return;
    entry.controller = null;
    // The entry may have been left unsubscribed while the stream ran — see the
    // release — so this is the first moment it can be counted against the
    // bound.
    trim();
  };
  void run(controller.signal, commit).then(done, done);
}

/**
 * Read `key`, starting the stream if nothing has, and be told when it moves.
 *
 * Returns the release function the caller must run on unmount or on a key
 * change. **Releasing the last reader keeps the entry** — running or resolved —
 * which is the whole of what this store is for; the one exception is an entry
 * that failed with nothing to show, which is dropped so the next reader retries
 * rather than finding a dead message. A *second* reader of a failed entry that
 * is still held deliberately does not restart it: a second tool is a second
 * reader, not a fresh attempt, and re-issuing per subscriber is the
 * request-per-mount this store exists to avoid.
 */
export function acquireManagerLeagues(
  key: string,
  run: ManagerLeaguesStream,
  onChange: Listener,
): () => void {
  const map = entries();
  const existing = map.get(key);
  // An entry exists if and only if something has asked, which is what makes a
  // second reader free and needs no idle sentinel to say so.
  const entry: Entry = existing ?? {
    state: PENDING,
    listeners: new Set(),
    controller: null,
    at: touch(),
  };
  entry.listeners.add(onChange);
  entry.at = touch();
  if (!existing) {
    map.set(key, entry);
    start(key, entry, run);
  }

  return () => {
    entry.listeners.delete(onChange);
    if (entry.listeners.size > 0) return;
    if (map.get(key) !== entry) return;
    // Nothing ran and nothing is running: there is nothing behind this entry to
    // hand the next reader, so keeping it would make the one thing anybody
    // would try — opening the tool again — a no-op for the life of the page. It
    // is the release rather than the acquire because that is what tells a
    // second tool apart from a second visit.
    if (entry.controller === null && entry.state.error !== null) {
      map.delete(key);
      return;
    }
    // **Touched on the way out, because it was in use until this instant.**
    // `at` is otherwise the last *write*, so the account a reader has just
    // navigated away from — the one most likely to be wanted again — would sort
    // as the oldest thing in the store.
    entry.at = touch();
    trim();
  };
}

/** For tests. */
export function clearManagerLeagues(): void {
  for (const entry of entries().values()) entry.controller?.abort();
  entries().clear();
}

/** For tests and diagnostics. */
export function managerLeaguesCacheSize(): number {
  return entries().size;
}

import type { DraftAdpBoards, ManagerLeagueRow } from "./queries";

/**
 * In-process memos in front of the manager's two heaviest reads, and the two
 * memo shapes they — and the trades board's season-wide reads — are built from.
 *
 * **This reverses a decision CLAUDE.md records.** The league-graph port left
 * TheLabX's in-process read caches deliberately unported, on the grounds that
 * nothing read the graph often enough to earn one. Three reads since have:
 * `getManagerDraftAdp` is a window-function aggregate over a manager's whole
 * draft corpus and was run fresh by the lineups route, the per-league lineup
 * route and the timeline's pricing; `getManagerLeagueRosters` is the
 * four-correlated-`jsonb_agg` read the lineups route makes on every request;
 * and `getSeasonDraftAdp`, one folder over, was being evicted by every league
 * the crawler persists. The caches are here now, and what makes them safe is
 * what was missing when they were left out: `invalidateTradeCaches` runs after
 * every league persist and names the league's members, so a memo is dropped by
 * the write that changes its answer rather than by a clock alone.
 *
 * **Two shapes, and each takes its reader as an argument.** The rules in them
 * are the kind that render perfectly while being wrong — a rejection that
 * stays cached, a rebuild that runs twice, a stale mark lost to a rebuild that
 * predates it — so they run under Node's own runner with an injected clock, on
 * `memoize-manager-lookup`'s terms. Not {@link BoundedCache}: its clock is
 * `Date.now()` and its lifetime is fixed at insertion, where these hold
 * *promises* whose rejection has to un-store them. They are generic and would
 * move to `shared/util` beside that class the day a third concern reads them.
 *
 * The wired lookups at the foot are the only thing here that reaches Postgres,
 * and they reach it through a lazy import of `./queries` — see the note there.
 */

/** How the two manager memos are keyed: a Sleeper user id carries no colon. */
export const managerReadKey = (userId: string, season: string): string =>
  `${userId}:${season}`;

export type ReadMemoOptions<V = unknown> = {
  /** How long an answer is served before the next read replaces it. */
  ttlMs: number;
  /** How many keys are held; past it the least recently written goes. */
  max: number;
  now?: () => number;
  /**
   * The most total weight held, in {@link weigh}'s own unit.
   *
   * **An entry count alone is not a bound on memory here**, and these two memos
   * are exactly why: one manager's league rows are a dozen leagues and
   * another's are a hundred and thirteen, each carrying every roster, every
   * member and every draft of its league. Two hundred of the first is nothing
   * and two hundred of the second is the process. So a memo whose answers vary
   * that way states a weight budget beside the count and is trimmed to whichever
   * bites first.
   */
  maxWeight?: number;
  /**
   * How heavy one *resolved* answer is, in a unit of the caller's own choosing
   * — rows, ids, entries. Never bytes, and deliberately never a
   * `JSON.stringify().length`: measuring a value by serialising it costs more
   * than the query it stands in front of.
   *
   * It runs when the promise resolves rather than when it is stored, which is
   * the one thing this cannot share with {@link BoundedCache}: what is held
   * here is a promise, and its weight is not knowable until it settles. Until
   * then the entry weighs nothing, which is right — an in-flight read is a
   * promise and a closure, not an answer.
   */
  weigh?: (value: V) => number;
};

/**
 * A bounded, TTL'd promise memo: one read per key per TTL, shared by everyone
 * who asks while it is in flight.
 */
export type ReadMemo<V> = {
  read(key: string, load: () => Promise<V>): Promise<V>;
  /** Drop every key `matches` accepts, and answer how many went. */
  forget(matches: (key: string) => boolean): number;
  clear(): void;
  readonly size: number;
  /** Total weight of the answers that have resolved. For tests and diagnostics. */
  readonly weight: number;
};

type MemoEntry<V> = { at: number; value: Promise<V>; weight: number };

export function createReadMemo<V>(options: ReadMemoOptions<V>): ReadMemo<V> {
  const {
    ttlMs,
    max,
    now = Date.now,
    maxWeight = Infinity,
    weigh,
  } = options;
  const entries = new Map<string, MemoEntry<V>>();
  let weight = 0;

  const drop = (key: string): boolean => {
    const entry = entries.get(key);
    if (!entry) return false;
    weight -= entry.weight;
    entries.delete(key);
    return true;
  };

  /**
   * Trim to both bounds, oldest first.
   *
   * `size > 1` on the weight arm for {@link BoundedCache}'s reason: an answer
   * heavier than the whole budget cannot be evicted *to*, so trimming to it
   * would empty the memo and still be over. The oversized entry is dropped
   * where it is written instead — see the resolution handler.
   */
  const trim = (): void => {
    while (entries.size > max || (weight > maxWeight && entries.size > 1)) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      drop(oldest.value);
    }
  };

  return {
    read(key, load) {
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;

      const at = now();
      // Every entry is written at the end with the clock's current reading, so
      // insertion order *is* age order and the expired ones are a prefix: they
      // are dropped here, on the write, rather than lingering until the bound
      // pushes them out — a memo whose keys stop being asked for would
      // otherwise hold up to `max` answers nobody can be served.
      for (const [stale, entry] of entries) {
        if (at - entry.at < ttlMs) break;
        drop(stale);
      }

      const entry: MemoEntry<V> = { at, value: load(), weight: 0 };
      // Delete-then-set so a refreshed key is the youngest.
      drop(key);
      entries.set(key, entry);
      // A rejection un-stores *this* entry only — a newer read may already be
      // underway — which is what makes a database blip immediately retryable
      // rather than remembered for the TTL.
      entry.value.then(
        (value) => {
          // **Weighed on resolution, which is the only moment it can be.** An
          // entry that has been replaced or forgotten in the meantime is not
          // this one, and adding its weight to the running total would leave a
          // figure describing entries the map no longer holds.
          if (weigh === undefined || entries.get(key) !== entry) return;
          entry.weight = weigh(value);
          weight += entry.weight;
          // One answer bigger than the whole budget is not held: trimming
          // cannot reach it, and exempting it is the unbounded map both bounds
          // exist to prevent. Everyone already awaiting it is still served —
          // the promise is theirs — and the next reader pays a query.
          if (entry.weight > maxWeight) drop(key);
          else trim();
        },
        () => {
          if (entries.get(key) === entry) drop(key);
        },
      );

      trim();
      return entry.value;
    },
    forget(matches) {
      let dropped = 0;
      for (const key of [...entries.keys()]) {
        if (!matches(key)) continue;
        drop(key);
        dropped += 1;
      }
      return dropped;
    },
    clear() {
      entries.clear();
      weight = 0;
    },
    get size() {
      return entries.size;
    },
    get weight() {
      return weight;
    },
  };
}

export type StaleWhileRevalidateOptions = {
  /** Past this age an answer is still served, while a rebuild runs behind it. */
  ttlMs: number;
  /**
   * The least time between two reads of one key, whatever marks it stale in
   * between — the throttle that keeps a write landing every few seconds from
   * being a rebuild every few seconds.
   */
  revalidateMs: number;
  now?: () => number;
  /** A rebuild rejected; the previous answer stays and this is the only trace. */
  onRebuildError?: (key: string, error: unknown) => void;
};

/**
 * A promise memo that keeps answering after its answer is stale.
 *
 * Marking a key stale (or its TTL running out) starts **one** rebuild behind
 * the value still being served, at most once per `revalidateMs`; a rebuild
 * that resolves replaces the value, and one that rejects leaves it in place
 * and caches nothing. Only a *cold* read that rejects is evicted, since there
 * is nothing older to keep.
 */
export type StaleWhileRevalidateMemo<V> = {
  read(key: string, load: () => Promise<V>): Promise<V>;
  /** Say the data behind `key` moved; true if there was an entry to mark. */
  markStale(key: string): boolean;
  /** Drop everything, and answer how many entries went. */
  clear(): number;
  readonly size: number;
};

type StaleEntry<V> = {
  value: Promise<V>;
  /** When the read behind `value` began — what the TTL is measured from. */
  at: number;
  /** Stale marks received, and how many the served value was read after. */
  marked: number;
  built: number;
  /** When a read of this key last began: the reference `revalidateMs` counts from. */
  attemptedAt: number;
  rebuilding: boolean;
};

export function createStaleWhileRevalidateMemo<V>(
  options: StaleWhileRevalidateOptions,
): StaleWhileRevalidateMemo<V> {
  const { ttlMs, revalidateMs, now = Date.now, onRebuildError } = options;
  const entries = new Map<string, StaleEntry<V>>();

  return {
    read(key, load) {
      const at = now();
      const entry = entries.get(key);

      if (!entry) {
        const fresh: StaleEntry<V> = {
          value: load(),
          at,
          marked: 0,
          built: 0,
          attemptedAt: at,
          rebuilding: false,
        };
        entries.set(key, fresh);
        fresh.value.catch(() => {
          if (entries.get(key) === fresh) entries.delete(key);
        });
        return fresh.value;
      }

      const due = entry.marked > entry.built || at - entry.at >= ttlMs;
      if (due && !entry.rebuilding && at - entry.attemptedAt >= revalidateMs) {
        entry.rebuilding = true;
        entry.attemptedAt = at;
        // Captured before the read: a mark that lands *during* the rebuild
        // describes a write the rebuild may not have seen, and clearing it
        // would make the next read believe an answer that predates the data.
        const marks = entry.marked;
        void load()
          .then(
            (value) => {
              // Only our own entry — a `clear()` mid-rebuild has replaced it.
              if (entries.get(key) !== entry) return;
              entry.value = Promise.resolve(value);
              entry.at = at;
              entry.built = marks;
            },
            (error) => onRebuildError?.(key, error),
          )
          .finally(() => {
            entry.rebuilding = false;
          });
      }
      return entry.value;
    },
    markStale(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      entry.marked += 1;
      return true;
    },
    clear() {
      const size = entries.size;
      entries.clear();
      return size;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * The predicate {@link forgetManagerReads} drops keys by: these users, in this
 * season or — for a caller that cannot name one — in every season.
 */
export function managerReadMatcher(
  userIds: readonly string[],
  season: string | null,
): (key: string) => boolean {
  const users = new Set(userIds);
  return (key) => {
    const at = key.indexOf(":");
    if (at === -1 || !users.has(key.slice(0, at))) return false;
    return season === null || key.slice(at + 1) === season;
  };
}

/**
 * How long a manager's draft-capital boards are reused. The population is
 * completed drafts, which arrive a handful at a time over a preseason, and a
 * draft finishing is a league persist — which evicts this. The clock only
 * covers what no persist names.
 */
export const MANAGER_DRAFT_ADP_TTL_MS = 15 * 60 * 1000;

/**
 * How long a manager's league rows are reused — a minute, because a roster
 * moves on the sync's clock and this stands in front of the page that shows
 * it. Every write that changes a row evicts it first; the minute is for the
 * writes that name no members (a tombstone, a parked league) and for the
 * scope, which the manager sync replaces before it persists a graph.
 */
export const MANAGER_LEAGUE_ROWS_TTL_MS = 60 * 1000;

/**
 * How many managers' answers each memo holds, and how much of each.
 *
 * **Two bounds because these two answers are not the same size as each
 * other, and neither is the same size from one manager to the next.** Two
 * hundred was the count both memos shared, and it is a reasonable *count* — the
 * managers a process is asked about inside one TTL, with room. What it is not
 * is a bound on memory: one league row carries every roster of its league, with
 * every player id on each, plus its members, its drafts and its traded picks,
 * and a 113-league account's rows are two orders of magnitude heavier than a
 * six-league account's. Two hundred of the heavy kind is a heap this process
 * cannot afford; two hundred of the light kind is nothing, and a count low
 * enough for the first would throw the second away for no reason.
 *
 * So each memo states what it is measured in, and the count survives as the
 * bound on *keys*. Whichever bites first is what trims.
 */
const MANAGER_READ_MAX = 200;

/**
 * The league-rows budget, in **rostered player ids** — the thing that actually
 * varies, and the one figure in a row that a `length` reaches without walking
 * anything.
 *
 * A twelve-team league of 25-man rosters is ~300; a 113-league account is
 * ~34,000. 400,000 is therefore about a dozen such accounts, or a great many
 * ordinary ones, and it is the number to lower if a box ever runs tight. An
 * account past it on its own is not held at all — see {@link createReadMemo} —
 * which costs that reader a query per request and everyone else their cache.
 */
const MANAGER_LEAGUE_ROWS_MAX_WEIGHT = 400_000;

/**
 * The draft-capital budget, in **priced player ids** across both boards.
 *
 * An entry is two maps of id → `AdpEntry`, so its weight is what those maps
 * hold: a few hundred for one league's rookie draft, a few thousand for a
 * manager whose account spans a corpus of full drafts. 200,000 is generous
 * against either and is a real ceiling rather than a count that says nothing.
 */
const MANAGER_DRAFT_ADP_MAX_WEIGHT = 200_000;

/**
 * How heavy one manager's league rows are: the ids their rosters hold.
 *
 * **Cheap and deterministic**, which is what {@link ReadMemoOptions.weigh}
 * requires: two nested `length` reads per league and no allocation. It is not
 * the whole of what a row weighs — the users, drafts and traded picks are
 * there too — and it does not need to be, because it is the term that varies
 * by two orders of magnitude between accounts. A weight function is a bound's
 * unit, not an estimate of bytes.
 */
export function weighManagerLeagueRows(rows: readonly ManagerLeagueRow[]): number {
  let weight = 0;
  for (const league of rows) {
    weight += 1;
    for (const roster of league.rosters) weight += roster.players.length;
  }
  return weight;
}

/** How heavy one manager's draft-capital boards are: the ids they price. */
export function weighDraftAdpBoards(boards: DraftAdpBoards): number {
  return boards.superflex.size + boards.standard.size;
}

/**
 * On `globalThis`, for `board-read`'s and `ros-read`'s reason: a per-bundle
 * copy would run each aggregate once per route rather than once per process,
 * and three routes share these two.
 */
const DRAFT_ADP_KEY = Symbol.for("thelab.manager.draftAdp");
const LEAGUE_ROWS_KEY = Symbol.for("thelab.manager.leagueRows");
const globalScope = globalThis as typeof globalThis & {
  [DRAFT_ADP_KEY]?: ReadMemo<DraftAdpBoards>;
  [LEAGUE_ROWS_KEY]?: ReadMemo<ManagerLeagueRow[]>;
};

const draftAdpMemo = (): ReadMemo<DraftAdpBoards> =>
  (globalScope[DRAFT_ADP_KEY] ??= createReadMemo<DraftAdpBoards>({
    max: MANAGER_READ_MAX,
    ttlMs: MANAGER_DRAFT_ADP_TTL_MS,
    maxWeight: MANAGER_DRAFT_ADP_MAX_WEIGHT,
    weigh: weighDraftAdpBoards,
  }));

const leagueRowsMemo = (): ReadMemo<ManagerLeagueRow[]> =>
  (globalScope[LEAGUE_ROWS_KEY] ??= createReadMemo<ManagerLeagueRow[]>({
    max: MANAGER_READ_MAX,
    ttlMs: MANAGER_LEAGUE_ROWS_TTL_MS,
    maxWeight: MANAGER_LEAGUE_ROWS_MAX_WEIGHT,
    weigh: weighManagerLeagueRows,
  }));

/**
 * `./queries` reaches `pg` through the `@/shared/db` alias, which Node's own
 * runner cannot resolve — so a static import here would take this module, memo
 * rules and all, out of `npm test`. The readers are resolved on first use
 * instead, the shape `instrumentation.ts` uses to keep a dependency out of a
 * module's import-time graph. Past the first miss the module is in the loader's
 * cache and this is a settled promise.
 */
const queries = () => import("./queries");

/** {@link getManagerDraftAdp}, once per manager and season per TTL. */
export function lookupManagerDraftAdp(
  userId: string,
  season: string,
): Promise<DraftAdpBoards> {
  return draftAdpMemo().read(managerReadKey(userId, season), () =>
    queries().then((q) => q.getManagerDraftAdp(userId, season)),
  );
}

/**
 * {@link getManagerLeagueRosters}, once per manager and season per minute.
 *
 * The rows are shared between every caller inside the minute, and the solve
 * chain treats them as read-only — it copies before it sorts — which is what
 * makes handing one array to concurrent requests safe.
 */
export function lookupManagerLeagueRows(
  userId: string,
  season: string,
): Promise<ManagerLeagueRow[]> {
  return leagueRowsMemo().read(managerReadKey(userId, season), () =>
    queries().then((q) => q.getManagerLeagueRosters(userId, season)),
  );
}

/**
 * Forget what these managers' pages read, because a league they are in has
 * just been written: its rosters are their rows, and its drafts are in their
 * capital corpus. Called from `invalidateTradeCaches` with the league's stored
 * membership, which is the set the write moved.
 */
export function forgetManagerReads(
  userIds: readonly string[],
  season: string | null,
): number {
  if (userIds.length === 0) return 0;
  const matches = managerReadMatcher(userIds, season);
  return draftAdpMemo().forget(matches) + leagueRowsMemo().forget(matches);
}

/**
 * Where a manager's cached reads are filed, how long a browser may reuse them,
 * and the fetch behind the ones that are a plain read of what the leagues sync
 * wrote.
 *
 * It was `features/manager/{query-keys,query-config}.ts` and the resource half of
 * that tool's `query-fns`. It is here for the reason `league-query.ts` and
 * `schedule-query.ts` are: a second tool reads these entries. The lineup
 * checker draws the manager tool's subject rail and both of its shares sheets,
 * which means it asks `/api/user/[username]/{players,leaguemates}` — and it has
 * to ask under *exactly* the same keys, or the two tools are two caches and a
 * reader crossing between them pays for the same rosters twice.
 *
 * That is also why the whole table moves rather than the two entries the rail
 * reads. `managerQueryKeys.manager()` is the prefix every one of them hangs off
 * and `dependentManagerQueryKeys` spans the lot, so a split would leave the
 * manager tool building its own keys onto a root it no longer owns — two
 * spellings of one prefix, which is the drift this module exists to stop.
 * `features/manager` re-exports each half under the name its own consumers,
 * their tests among them, already read it by.
 *
 * Pure apart from {@link fetchManagerResource}, whose only dependency is this
 * app's own `fetch` wrapper — so the tests that hash these keys still run under
 * Node's runner with a relative `.ts` import and nothing behind it.
 *
 * Two conventions worth keeping:
 *
 * - **Everything manager-scoped hangs off `manager(searched)`**, whose first act
 *   is to lower-case the searched name. Sleeper resolves `Jkap` and `jkap` to
 *   the same account, and two cache entries for one manager is the duplicate
 *   request this module exists to remove. It is also what lets the lineup
 *   checker key on the *username* off the stored account rather than on the
 *   `user_id` it holds beside it: one manager, one spelling, one entry.
 * - **`season` is always in the key, `"default"` when the caller doesn't name
 *   one.** The routes default it server-side, so an omitted season is a real
 *   selection — but it is a *different* selection from an explicit season, and a
 *   key that dropped the segment would let one overwrite the other.
 */

import { fetchJson, fetchScoped } from "./api.ts";
import { normalizeAdpQuery } from "./adp-query.ts";

/** A season segment, with the caller's omission spelled out rather than dropped. */
const seasonKey = (season?: string): string => season ?? "default";

/** The manager as the cache spells them — see the lower-casing note above. */
const managerKey = (searched: string): string => searched.toLowerCase();

export const managerQueryKeys = {
  /** Every manager-scoped entry, for a blunt "drop it all" invalidation. */
  all: ["manager"] as const,

  manager: (searched: string) => [...managerQueryKeys.all, managerKey(searched)] as const,

  leagues: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "leagues", seasonKey(season)] as const,

  players: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "players", seasonKey(season)] as const,

  leaguemates: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "leaguemates", seasonKey(season)] as const,

  /**
   * The projected and record ranks.
   *
   * `options` appends which *half* of the route was asked for — see
   * `?projections=` on `/api/user/[username]/ranks`. The two answers genuinely
   * differ (the cheap one carries no `weeks` and a null `proj` on every league),
   * so they cannot share an entry; re-aiming a column onto a projection metric
   * is a different key rather than a stale one.
   *
   * Omitting it yields the **prefix**, which is what
   * {@link dependentManagerQueryKeys} wants: React Query matches an
   * invalidation by prefix, so one entry there retires both variants.
   */
  ranks: (
    searched: string,
    season?: string,
    options?: { projections: boolean },
  ) =>
    [
      ...managerQueryKeys.manager(searched),
      "ranks",
      seasonKey(season),
      ...(options ? [options.projections ? "proj" : "no-proj"] : []),
    ] as const,

  ktc: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "ktc", seasonKey(season)] as const,

  /**
   * Every board of one manager's ADP valuation — the prefix, not an entry.
   * Dependent invalidation addresses the valuation as a whole; a single board is
   * {@link managerQueryKeys.adpValue}, which appends it.
   */
  adpValues: (searched: string, season?: string) =>
    [...managerQueryKeys.manager(searched), "adp-value", seasonKey(season)] as const,

  /**
   * One board of it — the drawer's whole selection, curve included, as the
   * `/api/user/[username]/adp-value` query string.
   *
   * In the key rather than a reason to invalidate: every board is a different
   * valuation of the same rosters, so returning to one already read — dragging
   * the steepness slider back a notch, widening the window and narrowing it
   * again — should cost no request. It used to be the steepness alone, because
   * that was the only thing the route took; now that the board narrows the
   * population too, a key holding less than the request does is a key that
   * serves one board's answer for another.
   *
   * Normalised the same way `boardQueryKeys.adp` normalises its own, so two
   * assemblies of one board land on a single entry rather than on two holding
   * identical payloads.
   */
  adpValue: (searched: string, season: string | undefined, board: string) =>
    [...managerQueryKeys.adpValues(searched, season), normalizeAdpQuery(board)] as const,
};

/**
 * What a *material* change to a manager's leagues makes stale.
 *
 * These five routes read the rosters and membership the leagues stream writes,
 * so when a refresh actually rewrites them the answers on screen are behind. The
 * list is deliberately short of two things it might look like it should hold:
 * the leagues entry itself (it is the thing that changed, and it holds the new
 * data already) and the ADP board (a fact about the crawled database, not about
 * this manager). Invalidating everything after every stream message is the
 * behaviour this replaces — see `leaguesRevision`, which decides *when*.
 */
export function dependentManagerQueryKeys(
  searched: string,
  season?: string,
): readonly (readonly unknown[])[] {
  return [
    managerQueryKeys.players(searched, season),
    managerQueryKeys.leaguemates(searched, season),
    managerQueryKeys.ranks(searched, season),
    managerQueryKeys.ktc(searched, season),
    // The prefix, so every steepness of the valuation goes with them.
    managerQueryKeys.adpValues(searched, season),
  ];
}

/**
 * How long each of a manager's answers is worth reusing.
 *
 * The server already caches the expensive half of all of this in Postgres —
 * that is what protects Sleeper, KTC and the projections host, and none of it
 * changes here. What was missing is one layer out: the three manager tabs are
 * three routes, so switching between them unmounted every hook and re-asked the
 * browser's questions from scratch. These are how long the *browser* reuses an
 * answer it already has, and they are deliberately shorter than the server's own
 * TTLs — a stale client read costs a request the server answers from its cache,
 * where a stale server read costs a fetch to somebody else.
 *
 * They are set per query rather than as one global default because the resources
 * move at genuinely different speeds — the same rule the background loops follow
 * (a slice's TTL should match how fast *that slice* moves). The client-wide
 * defaults, `gcTime` among them, are in `features/shared/query-client`.
 */
export const MANAGER_STALE_TIMES = {
  /**
   * The leagues stream. Five minutes against the server's ten-minute
   * `SYNC_TTL_MS`: the point is not to re-decide freshness — the route does
   * that, and answers from its own cache when it is still fresh — but to stop
   * three tab navigations in a minute opening three streams.
   */
  leagues: 5 * 60 * 1000,
  /** The manager's rosters, and the players cache resolved alongside them. */
  players: 10 * 60 * 1000,
  /** Who they share leagues with — membership changes at the season's pace. */
  leaguemates: 10 * 60 * 1000,
  /** Projected ranks: a projections slice can move hourly, so the shortest. */
  ranks: 5 * 60 * 1000,
  /** KTC values: the scrape behind them refreshes on the order of a day. */
  ktc: 15 * 60 * 1000,
  /** ADP valuation, per curve — the crawled board behind it moves slowly. */
  adpValue: 15 * 60 * 1000,
  // The league detail's TTL left with the panel that reads it, to
  // `league-query.ts`, on the same terms as kickoff's below: this table is "how
  // long a *manager's* answers are worth reusing", and that answer stopped being
  // one of them when the trades board started opening the same panel.
  // Kickoff's TTL left with the countdown that reads it, to `schedule-query.ts`:
  // the instant is a fact about a season and not about whoever is being read.
} as const;

/**
 * One of the manager's cached sub-resources: rosters, membership, ranks, values.
 *
 * **`userId` is the canonical id the leagues stream already resolved, and
 * sending it is what makes a manager page one Sleeper lookup rather than five.**
 * These five routes read Postgres and nothing else — they take a `user_id` and
 * join it against what the leagues sync wrote — but each one used to open by
 * asking Sleeper who the searched name is, purely to arrive at an id the browser
 * had been holding since the stream's first message. Sent back, the route skips
 * that entirely; omitted (a bookmark, an older client), it resolves the name as
 * it always did, so nothing depends on this being here.
 *
 * It is *not* in the query key: `searched` and the id are one manager, so keying
 * on both would split one answer across two entries — and the hooks don't ask
 * until the stream has produced the id, so there is no window where the key
 * would need to change.
 */
export function fetchManagerResource<T>(
  searched: string,
  path: string,
  fallbackError: string,
  signal?: AbortSignal,
  userId?: string | null,
  /**
   * The ADP valuation's own request, where the board's league rules resolved to
   * more ids than a request line can carry.
   *
   * Only that one resource has one, which is why it is the last argument rather
   * than the shape of every read here: the other four are pure Postgres reads
   * keyed on a user id and have nothing long to send. Given one, the query
   * string is the request's — `path` carries only the resource name — and the
   * method follows the body, so the route parses one query either way.
   */
  scoped?: { method: "GET" | "POST"; search: URLSearchParams; body: unknown } | null,
  /**
   * Which season's leagues to read, or `undefined` for the app's current one.
   *
   * Omission is the *shared* spelling rather than a shortcut: the routes default
   * an absent `?season` to `getActiveSeason()` and these keys file it under
   * `"default"`, so naming the current season explicitly would open a second
   * entry holding the identical answer — see {@link seasonParam}, which is the
   * one place that decision is made.
   *
   * Applied here rather than folded into `path` by each hook, because the two
   * transports spell a parameter differently (a query string for the four plain
   * reads, `scoped.search` for the ADP valuation's POST) and a rule five callers
   * have to remember is a rule one of them eventually won't. It is deliberately
   * *not* the ADP board's own `board_season`, which rides in `scoped.search` and
   * says which drafts the prices come from; this one says which leagues are on
   * screen.
   */
  season?: string,
): Promise<T> {
  if (scoped) {
    const search = new URLSearchParams(scoped.search);
    if (userId) search.set("user_id", userId);
    if (season) search.set("season", season);
    return fetchScoped<T>(
      `/api/user/${encodeURIComponent(searched)}/${path}`,
      { ...scoped, search },
      fallbackError,
      signal,
    );
  }
  const extra = new URLSearchParams();
  if (userId) extra.set("user_id", userId);
  if (season) extra.set("season", season);
  // `path` already carries a query string for some callers, which is why the
  // separator is chosen rather than assumed.
  const query = extra.toString();
  const suffix = query ? `${path.includes("?") ? "&" : "?"}${query}` : "";
  return fetchJson<T>(
    `/api/user/${encodeURIComponent(searched)}/${path}${suffix}`,
    fallbackError,
    signal,
  );
}

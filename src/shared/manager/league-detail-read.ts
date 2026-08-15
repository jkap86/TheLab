import { TtlPromiseCache } from "@/shared/util";

import { getLeagueDetail } from "./queries";
import { LEAGUE_DETAIL_CACHE } from "./read-cache";
import type { LeagueDetail } from "./types";

/**
 * One league's core detail per process, and the reads still running.
 *
 * **It is here rather than in the route because four routes want it**, which is
 * what the League Details split turned this read into. `/api/league/[leagueId]`
 * draws the panel from it; the `values`, `outlook` and `week` siblings each need
 * the same rosters, slots and scoring before they can compute anything. Read
 * uncached, splitting one payload into four requests would have turned one
 * league read into four — the exact tax a split is supposed to avoid paying.
 *
 * It is also the read a *reader* re-issues most: the panel mounts on expand and
 * unmounts on collapse, and a list of a hundred leagues is opened and closed
 * casually.
 *
 * `TtlPromiseCache` rather than a plain map for the half that matters on a cold
 * key: a league nobody has opened for three minutes, opened in two tabs at once,
 * is **one** computation and not two — and the four routes above, fired
 * together by one panel, coalesce onto that same one. A rejection is never
 * stored, so a database blip costs the request that met it and nothing after.
 *
 * Per process, like every cache here. Postgres stays the source of truth and the
 * TTL is well inside the crawler's own, so a second instance costs one extra
 * read of an answer that was about to expire.
 */
const detailCache = new TtlPromiseCache<{ detail: LeagueDetail | null }>(
  LEAGUE_DETAIL_CACHE,
);

/**
 * The core detail for one league, cached and coalesced — or null when the league
 * is not in the corpus.
 *
 * **A miss is wrapped rather than stored bare**, because `TtlPromiseCache`
 * reports "nothing stored" as `undefined` and null is a real answer here: a
 * league id nobody has synced is the answer an unknown id will keep giving, and
 * re-deriving it per request is the one query this exists to stop repeating.
 *
 * Deliberately **not frozen**, unlike the ranks payload. Both share one object
 * across every caller inside the TTL, and the argument for freezing that one is
 * that a route might sort it in place — but this one is handed to
 * `getLeagueOutlook` and `getLeagueWeekView`, which pass its `teams` into the
 * lineup solver, and `deepFreeze` over a dozen rosters on every miss is real
 * work on the path this whole change exists to shorten. What replaces it is the
 * contract: every consumer here reads and none writes.
 */
export function readLeagueDetail(leagueId: string): Promise<LeagueDetail | null> {
  return detailCache
    .read(leagueId, async () => ({ detail: await getLeagueDetail(leagueId) }))
    .then((entry) => entry.detail);
}

/**
 * Forget one league, because something has just rewritten it.
 *
 * **The one thing a TTL alone cannot get right here.** A reader who presses the
 * lineup checker's sync key is told Sleeper has confirmed their change, and the
 * panel refetches — into a cache entry written before the sync ran, for up to
 * three minutes. That is the sync key reporting success and showing the old
 * lineup, which is worse than not having the key.
 *
 * Called where a league's graph is *written* rather than at the route, so it
 * covers the crawler's own refresh in the same process as well as the on-demand
 * one. It cannot reach another process, which is the same bound every cache here
 * has and is why the TTL is short: a worker dyno's write is visible on the web
 * dyno within the TTL, and the interactive path — the sync route and the reader
 * are on the same web process — is exact.
 */
export function invalidateLeagueDetail(leagueIds: readonly string[]): void {
  for (const leagueId of leagueIds) detailCache.forget(leagueId);
}

/** For tests: drop everything. */
export function clearLeagueDetailCache(): void {
  detailCache.clear();
}

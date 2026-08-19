import { memoizeLeagueOutlook } from "./read-cache";
import type { LeagueOutlookInput } from "./read-cache";
import { getLeagueOutlook } from "./outlook";
import type { LeagueOutlook } from "./outlook";

/**
 * One league's rest-of-season outlook per process, and the solves still running.
 *
 * **The thin wiring half of `./read-cache`**, which holds the policy, the key
 * and the memoiser and takes its loader as an argument so all three can be
 * tested with nothing behind them. This is where that argument is
 * {@link getLeagueOutlook} — the split `resolve.ts`/`user-resolution.ts` already
 * draws, and `league-detail-read.ts`'s shape one enrichment along.
 *
 * **Why the enrichment wants its own cache when the detail under it already has
 * one.** `readLeagueDetail` stops four requests from becoming four league reads;
 * it does nothing about the *solve* on top of one of them, which is this route's
 * whole cost — a lineup per team per remaining week, a dozen teams over eighteen
 * weeks in the offseason, ~180ms of CPU on the web process. React Query keeps one
 * browser from asking twice; it cannot help two tabs, two readers of the same
 * league, a revalidation landing beside a cold navigation, or two requests
 * arriving before the first has finished. Each of those was a full second copy of
 * the same solve, and on the web dyno two of them are two spells of a blocked
 * event loop rather than two queries a database can interleave.
 *
 * Per process, like every cache here: Postgres stays the source of truth, so a
 * second instance costs one extra solve of an answer that was about to expire.
 * Nothing here wants Redis — it would put a network hop, and a serialisation of
 * every roster's weekly split, on the hot path this exists to shorten.
 */
const outlookCache = memoizeLeagueOutlook(getLeagueOutlook);

/**
 * The rest-of-season outlook for one league, cached and coalesced — or null when
 * the league cannot be projected.
 *
 * **Invalidation is the key rather than a hook**, which is the one thing to know
 * before reaching for one: the key spells out the slots, the scoring and every
 * roster the solve reads (see `leagueOutlookCacheKey`), so a league graph write
 * cannot leave a readable stale entry behind. `persistLeagueGraph` forgets the
 * league's core detail in the process that served the press, the panel's refetch
 * resolves the new rosters, and those rosters are a key this cache has never been
 * asked. What the TTL bounds is the only input the key does not carry: the
 * projections rows underneath, on the projections sync's own hourly clock.
 */
export function readLeagueOutlook(
  input: LeagueOutlookInput,
): Promise<LeagueOutlook | null> {
  return outlookCache.read(input);
}

/** For tests: drop everything. */
export function clearLeagueOutlookCache(): void {
  outlookCache.clear();
}

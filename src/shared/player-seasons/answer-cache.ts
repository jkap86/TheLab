import type { CompsPayload } from "@/shared/contract";
// Relative, with the extension, so this module resolves under Node's own test
// runner — the arrangement `shared/comps/knn` and `shared/ktc/roster` already
// make. The key below is the whole of what makes a hit correct, and it is not
// a rule to leave untested for the sake of a barrel import.
import { BoundedCache } from "../util/bounded-cache.ts";

/**
 * A small, bounded hold over identical comps answers.
 *
 * **The question is the whole URL and the corpus behind it is immutable for a
 * given version**, so the same question asked twice has the same answer until
 * somebody loads the corpus again. That is an unusually strong guarantee for a
 * cache to have, and it is what makes this safe: there is no window in which a
 * hit could be stale, because a load moves the version and the version is in
 * the key.
 *
 * What it buys is the shape of the page. A weight rail fires on every step of
 * a drag, the hook debounces but does not deduplicate, and a reader who nudges
 * a weight up and back down asks the *same* question twice with a different
 * one in between — which is a full pool walk each time. Against a few thousand
 * player-seasons that is milliseconds rather than seconds, which is why this
 * is a modest optimisation and not a load-bearing one; it is bounded and
 * short-lived precisely so it can never become the thing that has to be
 * correct.
 *
 * **Bounded and TTL'd rather than a `Map`**, on `shared/util/bounded-cache`'s
 * own argument: an unbounded map keyed by a query string is a cache of every
 * question the process has ever been asked, which on a long-running server is
 * a leak with a slow fuse. A rail has 15 positions on 44 possible pairs, so
 * the key space is effectively unbounded and the bound is not a formality.
 *
 * **Nothing failed is ever cached.** A 400, a 404 and a 500 are all decided
 * before this is written to, and the route only stores a payload it is about
 * to answer 200 with.
 */

/**
 * How long an answer is held.
 *
 * Short, deliberately. The version in the key is what makes a hit correct, so
 * the TTL is not a staleness policy at all — it is the bound on how long a
 * question nobody is asking any more occupies a slot. Five minutes covers the
 * session a reader is actually in.
 */
export const COMPS_ANSWER_TTL_MS = 5 * 60 * 1000;

/**
 * How many answers are held at once.
 *
 * A working set is one reader's exploration of one player: a few dozen
 * questions, most of them revisited. Two hundred covers several readers
 * without the eviction ever becoming the thing that decides a response time.
 */
export const COMPS_ANSWER_MAX = 200;

const CACHE_KEY = Symbol.for("thelab.comps.answers");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: BoundedCache<CompsPayload>;
};

/**
 * Cached on `globalThis` for the reason the corpus is: a route bundle carrying
 * its own copy of this module would get its own cache, and nothing in the
 * process could tell.
 */
export function compsAnswerCache(): BoundedCache<CompsPayload> {
  return (globalScope[CACHE_KEY] ??= new BoundedCache<CompsPayload>(
    COMPS_ANSWER_MAX,
    COMPS_ANSWER_TTL_MS,
  ));
}

/**
 * The key an answer is held under: **everything that can change the answer**.
 *
 * `query` is the request already normalised by `compsQueryParams` — subject,
 * season bounds, `k`, the position lock, the own-season exclusion and every
 * weighted pair in the order the panel produced them. `version` is the
 * corpus's, so a load invalidates every entry at once without anything having
 * to be swept. `minCoverage` is in the key because a threshold that ever
 * becomes configurable must not silently reuse an answer computed under the
 * old one; today it is a constant, and a constant in a key costs nothing.
 */
export function compsAnswerKey(parts: {
  version: string;
  query: string;
  minCoverage: number;
}): string {
  return `${parts.version}|${parts.minCoverage}|${parts.query}`;
}

/**
 * Busting Sleeper's CDN for the one caller that has to.
 *
 * Every read in this app is happy with a cached answer: the manager sync, the
 * background crawler and the projections board are all asking "what does Sleeper
 * say about this", and a copy a few seconds old is that answer. Sleeper's API
 * sits behind a CDN and the app is faster and lighter for it.
 *
 * **Two callers are the exception, and for both the cache is the whole
 * problem.** The per-league refresh press is one: a reader changed a lineup in
 * Sleeper's own app moments ago and pressed a key that says *re-read this
 * league*, and a cached answer makes that key look broken while the app behaves
 * exactly as written — the failure that feature cannot have, because the key
 * exists to be believed. The pick tracker is the other, one grain tighter: it
 * follows a draft while the room is watching it, so a board assembled from a
 * CDN copy taken before the last pick is a board showing the pick that has just
 * been made as still to come.
 *
 * **A `Cache-Control: no-cache` request header is deliberately not the answer.**
 * The major CDNs ignore that header from anonymous clients by default, so it
 * would read as a fix in the diff and change nothing on the wire. A query
 * parameter is a different cache key, which is the only thing an anonymous
 * client can be sure of.
 *
 * Pure and import-free, so Node's own runner drives it, and so a getter can take
 * the token as an optional last argument without depending on anything.
 * {@link freshUrl} returning the URL **untouched** for an absent token is what
 * makes that cheap: every getter can offer the parameter while every caller but
 * one keeps hitting the cacheable URL.
 */

/**
 * The parameter name. `_` rather than something descriptive because it is
 * addressed to a CDN rather than to Sleeper — the API ignores unknown query
 * parameters, and the shortest thing that varies is the whole requirement.
 */
export const CACHE_BUST_PARAM = "_";

/**
 * A token for one press.
 *
 * Minted **once per read and shared by every request that read makes**, so a
 * league's ~11 collections — or a draft board's four — are all read from one
 * moment rather than from eleven. A per-request token would also work as a
 * cache bust and would be worse: it would make the graph a mosaic of instants
 * for no gain.
 *
 * The clock is an argument so a test can pin it — a token that does not vary
 * busts nothing, which is exactly the regression worth a test.
 */
export function cacheBustToken(now: number = Date.now()): string {
  return String(now);
}

/**
 * Append {@link CACHE_BUST_PARAM} to a URL, or hand it back untouched.
 *
 * The untouched path is the common one and is the reason this is a function
 * rather than a template at each call site: every Sleeper getter can accept an
 * optional token, and only the two readers named above ever mint one — the
 * manager sync and the crawler keep hitting the cacheable URL.
 *
 * The separator is chosen off the URL rather than assumed, because two of the
 * getters this wraps already carry a query string — appending `?` blindly makes
 * a malformed URL, which Sleeper answers 404, which folds into a *gone league*.
 * That is a cache-busting bug that presents as a tombstone.
 */
export function freshUrl(url: string, token?: string): string {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${CACHE_BUST_PARAM}=${encodeURIComponent(token)}`;
}

/**
 * Asking Sleeper for an answer that has not been cached on the way to us.
 *
 * **Why this exists.** Sleeper's API sits behind a CDN, and a `GET` of a
 * league's rosters or matchups can be served from an edge copy minted seconds
 * ago. For everything this app does on a schedule that is invisible and welcome
 * — the crawler's promise is a fifteen-minute TTL, so an edge copy a few seconds
 * old is inside its own error bars, and letting the CDN answer is strictly
 * cheaper for Sleeper and for us. For the *one* path a reader drives it is the
 * whole problem: they changed a lineup in Sleeper's own app moments ago and
 * pressed a key that says "re-read this", and a cached answer makes that key
 * look broken while the app behaves exactly as written.
 *
 * **A varying query parameter, because that is the half that works.** A shared
 * cache keys on the URL, so a URL nobody has asked for cannot be answered from
 * one. The obvious-looking alternative — a `Cache-Control: no-cache` request
 * header — is deliberately *not* used here and should not be added later on the
 * assumption it does the same job: the major CDNs ignore that header from
 * anonymous clients by default, so it would read as a fix while changing
 * nothing. If this ever stops working, the thing to check is whether the token
 * is actually reaching the URL, not whether some header is missing.
 *
 * Pure and dependency-free, so the round trip through it is testable: the two
 * ways to get this wrong are a token that does not vary (a cache-buster that
 * busts nothing) and a parameter appended so as to break the URL it is on, and
 * both look fine in review.
 */

/**
 * The parameter name the token rides on.
 *
 * `_` by convention, and deliberately not a word Sleeper might one day give a
 * meaning to: this is a value we need the *URL* to carry and the server to
 * ignore, so the safest name is the one every HTTP client has been using for
 * exactly this since jQuery.
 */
export const CACHE_BUST_PARAM = "_";

/**
 * A token for one round of fetching — a millisecond timestamp.
 *
 * **Minted once per press, not once per request**, which is what the callers
 * pass it around for. A league's graph is ~11 requests; giving them one token
 * makes them one legible group in an access log, and it is the timestamp of the
 * press rather than of whichever request happened to be issued when.
 *
 * A timestamp rather than a random value because it is monotonic and readable:
 * two presses can never collide (the refresh's own cooldown is measured in
 * seconds), and the value in a log line says *when*, which a random one would
 * not. It is not a nonce and nothing is authenticated by it.
 */
export function cacheBustToken(now: number = Date.now()): string {
  return String(now);
}

/**
 * The same URL, carrying `token` so a shared cache cannot answer it.
 *
 * **An absent token returns the URL untouched**, which is what lets every
 * Sleeper getter take this as an optional last argument and every existing
 * caller keep the exact URL it has always requested. That matters beyond tidiness:
 * the background loops are the overwhelming majority of this app's traffic, and
 * quietly busting the cache for them would move all of it onto Sleeper's origin
 * for no freshness anybody asked for.
 *
 * The separator is chosen from the URL rather than assumed, so this composes
 * with a path that already carries a query string — nothing in this app does
 * today, and a helper that silently produced `…?a=1?_=…` the day one did is a
 * bug that would surface as an upstream 404.
 */
export function freshUrl(url: string, token?: string): string {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${CACHE_BUST_PARAM}=${encodeURIComponent(token)}`;
}

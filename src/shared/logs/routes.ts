/**
 * Which paths the visit log records, as a predicate rather than a matcher.
 *
 * **The vocabulary is spelled twice and cannot be spelled once.** `proxy.ts`
 * carries the same list as `config.matcher`, and Next requires matcher values
 * to be static constants so they can be analysed at build time — so a seventh
 * tool is a line there as well as here. `routes.test.ts` pins the two against
 * each other by reading that file, on `process-role.test.ts`' terms: a list
 * that lost an entry in one spelling and not the other is a page whose hard
 * loads are logged and whose navigations are refused, or the reverse, with
 * nothing on screen saying which.
 *
 * **It is applied on the server and only on the server.** `VisitBeacon` sends
 * whatever pathname it lands on and this decides; a copy of the rule in the
 * browser would be a third spelling of one list, to save a request nobody is
 * waiting on. It also means a reader cannot learn the vocabulary by probing —
 * every well-formed report is answered the same way whether or not it wrote.
 *
 * **`/logs` is excluded by not being named**, which is the same way the proxy's
 * positive list excludes it, and `/` needs no entry for the same reason it needs
 * none there: `next.config.ts` redirects it to `/tools` and the redirect is what
 * a browser follows.
 */

/** Recorded exactly, with nothing under them. */
export const LOGGED_ROUTES = [
  "/tools",
  "/trades",
  "/picktracker",
  "/comps",
] as const;

/**
 * Recorded with at least one segment under them — the proxy's `:path+`, which
 * is one-or-more rather than zero-or-more. `/manager` on its own is a redirect
 * to `/tools` and never a page, so matching it here would record a visit to
 * something nobody can be looking at.
 */
export const LOGGED_ROUTE_PREFIXES = [
  "/manager",
  "/lineupchecker",
  "/picktracker",
] as const;

/**
 * The longest path worth examining, and the most segments one may have.
 *
 * Both are bounds on a string a caller supplies rather than judgements about
 * URLs: the report arrives over HTTP from a browser this app does not control,
 * so what reaches the canonicalisation below is attacker-supplied in exactly
 * the sense `client-ip`'s own note uses about `x-forwarded-for`.
 */
const MAX_ROUTE_LENGTH = 256;
const MAX_SEGMENTS = 8;

/**
 * What one segment may hold.
 *
 * A positive list rather than a set of exclusions, because the two things that
 * actually appear under these prefixes are a Sleeper username and a league id,
 * and anything outside this is not a route this app serves whatever else it is.
 * `%` is here so an encoded pathname survives: `usePathname` hands back what is
 * in the URL, and the proxy stores `nextUrl.pathname`, which is encoded too —
 * so decoding here would make one visit two different rows depending on which
 * writer recorded it.
 */
const SEGMENT = /^[A-Za-z0-9._~%@+-]+$/;

/**
 * The canonical route to store for `route`, or null where it is not one this
 * log records.
 *
 * It answers the *stored* string rather than a boolean because canonicalising
 * and deciding are one pass: `/manager//jkap86` and `/manager/jkap86/` are the
 * same page, and a row per spelling is a facet menu naming one manager twice.
 */
export function loggedRoute(route: unknown): string | null {
  if (typeof route !== "string") return null;
  if (route.length === 0 || route.length > MAX_ROUTE_LENGTH) return null;
  if (!route.startsWith("/")) return null;

  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;

  const canonical = `/${segments.join("/")}`;
  if (segments.length === 1) {
    return includes(LOGGED_ROUTES, canonical) ? canonical : null;
  }
  return includes(LOGGED_ROUTE_PREFIXES, `/${segments[0]}`) ? canonical : null;
}

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

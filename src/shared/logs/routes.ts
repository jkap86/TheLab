/**
 * Which paths the visit log records, and what it stores for one.
 *
 * **It is a rule rather than a list, and that reverses what this file used to
 * be.** It carried the eight routes the app serves, spelled a second time here
 * as a predicate because `proxy.ts` cannot read an array — Next requires
 * matcher values to be static constants so they can be analysed at build time —
 * and `routes.test.ts` pinned the two against each other. A list has two costs
 * and only one of them was written down. The stated one is that a seventh tool
 * is a line in two files, and a tool added to one and forgotten in the other is
 * a page whose hard loads are recorded and whose in-app navigations are refused.
 * The unstated one is what a positive list cannot answer at all: **a path this
 * app does not serve is a path nobody asked about**, so the log could say which
 * of its pages were read and never which link somebody was holding that led
 * nowhere — which is the one question the cutover onto TheLabX's address made
 * worth asking, and which this file's own predecessor named as the gap to close.
 *
 * So the question is inverted. Everything is a page unless it is one of the
 * things that plainly is not — a namespace this app answers with something
 * other than a page, one of Next's metadata conventions, or a request for a
 * *file* — and those are named below rather than every page being named.
 *
 * **`proxy.ts` applies this too, which is what makes it one rule.** That file's
 * matcher is now a catch-all excluding the same two namespaces, and it is a
 * coarse pre-filter rather than the vocabulary: it exists so the Node-runtime
 * proxy is not invoked for every chunk, and what decides whether a row is
 * written is this function, on both writers. The vocabulary is therefore spelled
 * **once**, and `routes.test.ts` no longer has two lists to hold together — what
 * it pins instead is that nothing the matcher excludes is something this would
 * have kept, since a beacon report reaches this without passing the matcher at
 * all.
 *
 * **`/logs` is recorded now**, where it used to be excluded by not being named.
 * It is a page somebody visits, which is the whole of the rule, and it is the
 * one place the change is visible as a judgement rather than as a widening: the
 * operator's own reads of the log now appear in it. The Address facet is one
 * press away from taking them back out, and naming `/logs` in `NOT_A_PAGE`
 * below is the one line that restores the old behaviour if the noise is worse
 * than the reading.
 */

/**
 * First segments this app answers with something that is not a page.
 *
 * `api` is route handlers, which answer JSON and are reached by this app's own
 * client rather than visited. `_next` is the framework's own namespace —
 * chunks, images, the build manifest — and is here rather than left to the
 * extension rule below because not all of it carries one.
 *
 * Compared lower-cased: a path is case-sensitive to a server and `/API/logs` is
 * still not a page this app serves.
 */
const NOT_A_PAGE = new Set(["api", "_next"]);

/**
 * Next's own metadata conventions, which are matched on the **last** segment
 * because they sit at whatever level the route they describe does.
 *
 * These are the awkward ones and the reason this is a second test rather than
 * more entries above. `app/opengraph-image.tsx` is served at
 * `/opengraph-image`, with the content hash in the *query* and no extension in
 * the path, so nothing else here would tell it from a page — and it is fetched
 * by crawlers, which send no `sec-fetch-dest`, an absent one being read as a
 * page view so a client with no fetch metadata is still counted. Left alone,
 * every share preview would be a visit.
 *
 * **Checking the last segment rather than the first is what the build said to
 * do**, and a first-segment test looked right until it was run: this app also
 * carries `app/picktracker/[leagueId]/opengraph-image.tsx`, so a crawler
 * unfurling one shared draft link would have written
 * `/picktracker/<id>/opengraph-image` — a row deriving to the `picktracker`
 * tool and that league's id, indistinguishable in the facet menus from somebody
 * actually opening the board. A share is not a visit, and the one that would
 * have been miscounted is the link this app exists to have pasted into a league
 * chat.
 *
 * The extensionless conventions are the whole of what needs naming: `sitemap`,
 * `robots` and `manifest` are served with an extension and the rule below has
 * them. Nothing here can shadow a real page, because Next reserves these
 * filenames — a directory cannot hold both `opengraph-image.tsx` and a page at
 * that name.
 */
const METADATA_ROUTES = new Set([
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
]);

/**
 * A final segment that names a file rather than a page.
 *
 * Every static asset this app serves is one root-level segment with an
 * extension — `favicon.ico`, `icon.svg`, `icon1.png`, `apple-icon.png`,
 * `legacy-avatar.png` — and so is the overwhelming majority of what a scanner
 * asks a strange host for: `/wp-login.php`, `/.env`, `/config.json`. Neither is
 * a page and neither is worth a row, and one rule covers both.
 *
 * **The cost is a page whose last segment contains a dot**, which on this app
 * means a Sleeper username or a league id with one in it. A league id is a
 * number and a Sleeper username is letters, digits and underscores, so the case
 * is believed not to arise; it is written down rather than guarded because the
 * alternative — a list of extensions — is a list that goes stale in exactly the
 * way the route list above just did.
 */
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

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
 * A positive list rather than a set of exclusions, because what appears under
 * these paths is a Sleeper username, a league id, or — now that an unserved path
 * is recorded too — whatever a reader typed or a stale link carried. Anything
 * outside this is not a path a browser would show as a page whatever else it is.
 * `%` is here so an encoded pathname survives: `usePathname` hands back what is
 * in the URL, and the proxy stores `nextUrl.pathname`, which is encoded too —
 * so decoding here would make one visit two different rows depending on which
 * writer recorded it.
 */
const SEGMENT = /^[A-Za-z0-9._~%@+-]+$/;

/**
 * The canonical route to store for `route`, or null where it is not a page.
 *
 * It answers the *stored* string rather than a boolean because canonicalising
 * and deciding are one pass: `/manager//jkap86` and `/manager/jkap86/` are the
 * same page, and a row per spelling is a facet menu naming one manager twice.
 *
 * **`/` is null, and that is not an exclusion.** `next.config.ts` redirects it
 * to `/tools` and redirects are checked before the proxy, so the root never
 * reaches either writer; answering it would be describing a page that does not
 * exist. The same goes for the four other entries in that file — a hit on
 * `/manager` is a `/tools` row, and what the reader asked for is not
 * recoverable on this side. That is the one gap this rule does not close, and
 * it is the reason anything worth a permanent redirect has to be named there.
 */
export function loggedRoute(route: unknown): string | null {
  if (typeof route !== "string") return null;
  if (route.length === 0 || route.length > MAX_ROUTE_LENGTH) return null;
  if (!route.startsWith("/")) return null;

  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  const last = segments[segments.length - 1];
  if (NOT_A_PAGE.has(segments[0].toLowerCase())) return null;
  if (METADATA_ROUTES.has(last.toLowerCase())) return null;
  if (FILE_EXTENSION.test(last)) return null;

  return `/${segments.join("/")}`;
}

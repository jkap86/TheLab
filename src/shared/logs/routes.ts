/**
 * Which paths the visit log records, and what it stores for one.
 *
 * **A page this app serves, in one of the shapes it serves, and nothing else.**
 * That reverses what this file was for a while — "everything is a page unless
 * it is plainly not", so that a stale link somebody was holding could be read
 * off the log — and the reversal is deliberate. Under that rule a path was a
 * row whether or not anything answered it, so a scanner walking invented paths
 * wrote a row apiece into a table nothing pruned, against a pool the lineups
 * read is waiting on, and the Tool facet filled with whatever the internet felt
 * like asking for. What the inverted rule bought — knowing which retired URL a
 * reader arrived on — is worth having and is not worth an unbounded write; it
 * is answerable from the router's own logs, which record every request whether
 * or not this app keeps it.
 *
 * **So the vocabulary is a table of shapes, and it is spelled once.** Every
 * page under `app/` is a shape here: a fixed path, or a fixed head over one
 * dynamic segment whose form is known — a Sleeper username, which is letters,
 * digits and underscores, or a league id, which is a number. `routes.test.ts`
 * walks `app/` and fails if a page exists that no shape names, so a tool added
 * to the app is recorded only once somebody says what its subject looks like —
 * which is the honest cost, and is a test failure rather than a silent gap.
 *
 * **`proxy.ts` applies this too.** Its matcher is a coarse pre-filter that
 * exists so the Node-runtime proxy is not invoked for every chunk, and what
 * decides whether a row is written is this function, on both writers. The one
 * thing the matcher must never do is exclude a path this would keep, which
 * `routes.test.ts` pins in the other direction.
 *
 * **`/logs` is recorded**, being a page somebody visits; the Address facet is
 * one press from taking the operator's own reads back out.
 */

/**
 * A Sleeper username: letters, digits and underscores. The route resolves it
 * case-insensitively, so it is stored as typed and folded by `deriveVisit`.
 * Sixty-four is well past anything Sleeper issues and short of anything worth
 * storing.
 */
const USERNAME = /^[A-Za-z0-9_]{1,64}$/;

/** A Sleeper league id: a number, and Sleeper's are eighteen digits today. */
const LEAGUE_ID = /^\d{1,32}$/;

type PageShape = {
  /** The first segment. */
  head: string;
  /** What the one segment under it must look like, or none for a fixed page. */
  tail: RegExp | null;
};

/**
 * Every page this app serves. A shape per `page.tsx` under `app/`, which is
 * what the test walks.
 */
const PAGE_SHAPES: readonly PageShape[] = [
  { head: "tools", tail: null },
  { head: "trades", tail: null },
  { head: "comps", tail: null },
  { head: "logs", tail: null },
  { head: "picktracker", tail: null },
  { head: "picktracker", tail: LEAGUE_ID },
  { head: "manager", tail: USERNAME },
  { head: "lineupchecker", tail: USERNAME },
  { head: "gametime", tail: USERNAME },
];

/**
 * The longest path worth examining. A bound on a string a caller supplies
 * rather than a judgement about URLs: the report arrives over HTTP from a
 * browser this app does not control, so what reaches the canonicalisation
 * below is attacker-supplied in exactly the sense `request/client-ip`'s note
 * uses about `x-forwarded-for`.
 */
const MAX_ROUTE_LENGTH = 256;

/**
 * The canonical route to store for `route`, or null where it is not a page
 * this app serves.
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
 * recoverable on this side.
 */
export function loggedRoute(route: unknown): string | null {
  if (typeof route !== "string") return null;
  if (route.length === 0 || route.length > MAX_ROUTE_LENGTH) return null;
  if (!route.startsWith("/")) return null;

  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;
  const [head, tail] = segments;

  const shape = PAGE_SHAPES.find(
    (s) => s.head === head && (tail === undefined ? s.tail === null : s.tail !== null && s.tail.test(tail)),
  );
  if (!shape) return null;

  return `/${segments.join("/")}`;
}

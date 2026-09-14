import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

import { loggedRoute, recordVisit } from "@/shared/logs";
import { clientIp, decideHttps, httpsPolicy } from "@/shared/request";
import type { HttpsPolicy } from "@/shared/request";

/**
 * Two jobs, in order: **insist on HTTPS**, then **record a visit**.
 *
 * They are one file because they are the two things this app needs to do to
 * every request before a route sees it, and Next gives it one place to stand
 * in front of every route. They are kept as two separate decisions inside it
 * — the HTTPS one is `shared/request/https`' and the logging one is
 * `shared/logs/routes`' — and neither reads the other: an insecure request is
 * redirected *before* it is logged, so a hard load over `http://` is one row
 * (the secure request that follows) rather than two, and a request that is
 * served is logged whether or not it carried the header.
 *
 * **HTTPS is the router's word, and the redirect is to the configured origin.**
 * Heroku terminates TLS and hands the app plain HTTP either way; the only way
 * to tell the two apart is `X-Forwarded-Proto`, which the router sets. A
 * request it marked `http` is redirected — a GET or HEAD, with its path and
 * query, to `SITE_URL`'s origin and never to the request's own `Host`, which
 * anyone can set — and anything else over `http` is refused with a 403, since
 * a body that arrived in the clear has already been exposed and re-sending it
 * securely does not take that back. A request marked `https` is served with
 * the `Strict-Transport-Security` header; one with no header at all
 * (development, a direct connection) is served as it is. See `decideHttps` for
 * the policy, including why there can be no loop and why an unset `SITE_URL`
 * means no enforcement rather than a guess.
 *
 * **It is one of the log's two writers.** What reaches here is a browser asking
 * for a page *as a page*; an in-app press cannot be told from the prefetch that
 * preceded it (see `isPageView`), so the other half is reported from the
 * browser by `features/shared/visit-beacon.tsx` through `/api/logs/visit`. The
 * two do not overlap: the beacon never reports the page it mounts on, which is
 * the one this wrote.
 *
 * **This is `proxy.ts`, not `middleware.ts`.** Next 16 deprecated the older name
 * and renamed the convention; the export is `proxy` and the file sits beside
 * `app/`. More usefully, Proxy now defaults to the **Node.js runtime**, which is
 * what lets this reach Postgres directly — see `logs/record.ts` for the
 * self-addressed HTTP hop that replaces.
 *
 * The insert is handed to `event.waitUntil`, which the Proxy docs name for
 * exactly this ("background work like logging or analytics"): it keeps the
 * invocation alive until the promise settles, so the response is not held and
 * the write is not cut off half way. It is not awaited and `recordVisit` cannot
 * throw, so nothing here can fail a page — and it admits every write against
 * its own bound, so nothing here can flood the table either.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  const decision = decideHttps(policy(), {
    method: request.method,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });
  if (decision.kind === "redirect") {
    return NextResponse.redirect(decision.location, { status: decision.status });
  }
  if (decision.kind === "refuse") {
    return NextResponse.json(
      { error: "HTTPS required" },
      { status: decision.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const route = isPageView(request)
    ? loggedRoute(request.nextUrl.pathname)
    : null;

  if (route !== null) {
    event.waitUntil(
      recordVisit({ ip: clientIp(request.headers), route }),
    );
  }

  const response = NextResponse.next();
  if (decision.hsts !== null) {
    response.headers.set("Strict-Transport-Security", decision.hsts);
  }
  return response;
}

/**
 * The HTTPS policy, resolved once per process and its warning printed once.
 *
 * On `globalThis` rather than at module scope for the live rooms' reason:
 * under `next dev` an edit re-evaluates this file, and a policy resolved per
 * evaluation would print its warning on every save. The environment does not
 * change under a running process, so resolving it once is exact.
 */
const POLICY_KEY = Symbol.for("thelab.proxy.https-policy");
const globalForPolicy = globalThis as unknown as { [key: symbol]: HttpsPolicy | undefined };

function policy(): HttpsPolicy {
  const held = globalForPolicy[POLICY_KEY];
  if (held) return held;
  const resolved = httpsPolicy(process.env, process.env.NODE_ENV === "production");
  if (resolved.warning) console.warn(`[https] ${resolved.warning}`);
  return (globalForPolicy[POLICY_KEY] = resolved);
}

/**
 * Whether this request is a browser being sent to a page, as opposed to the
 * App Router fetching one.
 *
 * **This is the decision the whole log hangs on, and it was made by measuring
 * rather than by reasoning.** The App Router issues two kinds of request that
 * are not a page view: a *prefetch*, fired for every `<Link>` in the viewport as
 * soon as a page loads, and the *soft navigation* that follows a click. In
 * Next 16 the proxy cannot tell those two apart — verified against a production
 * build, driving a real browser: the prefetch of `/trades` and the click
 * through to `/trades` arrived with the *same* URL, the *same* eighteen header
 * names and the *same* value for every one of them. `RSC` and
 * `Next-Router-Prefetch` do reach the server, but Next consumes them into
 * request metadata and strips them before the proxy runs, and the `.rsc`
 * pathname suffix they can arrive as is normalised away too.
 *
 * So the choice is not "log navigations but not prefetches" — that is not
 * available. It is between logging both and logging neither, and logging both
 * is the worse answer by a distance: one load of `/tools` produced **six** rows,
 * two of them for `/trades` and one for `/comps`, a page nobody had opened. A
 * log that reports visits to pages nobody visited is worse than one that
 * undercounts, because there is no reading of it that is true.
 *
 * **So a row from *this* writer means "a browser asked for this page as a
 * page"** — a hard load, a new tab, a bookmark, a pasted link, a refresh. That
 * is the whole of what the proxy can honestly claim, and re-measured against
 * Next 16.3.3 it still is: driven with the three request shapes, a prefetch and
 * a soft navigation arrive here with the same nine header names and the same
 * value for every one.
 *
 * **The in-app press is recorded from the browser instead**, which is the one
 * place the two differ — a prefetch runs no code. It could never have been
 * closed on this side even by reading a header, because a prefetched route is
 * served from the client router cache, so the click that follows often makes no
 * request at all. See `visit-beacon.tsx`.
 *
 * The two conditions cover each other. `next-url` is the App Router's own
 * marker and is what a stray RSC request carries when `sec-fetch-*` is absent;
 * `sec-fetch-dest` is a browser-set header a page cannot forge, and its absence
 * is treated as a page view so that a client which sends no fetch metadata —
 * curl, a crawler, an older browser — is still counted. What decides whether
 * the request is a page *this app serves* is `loggedRoute`, which is the one
 * vocabulary both writers share.
 */
function isPageView(request: NextRequest): boolean {
  if (request.headers.has("next-url")) return false;
  const dest = request.headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}

/**
 * There is deliberately no `viewer` here, and there was.
 *
 * A `thelab_viewer` cookie mirrored the stored Sleeper account so a visit could
 * name whoever was looking — the one fact `route` cannot carry. It did not hold
 * up: the stored account is written by the lookup form on `/tools`, which is
 * also how anybody reaches another manager's page, so the value was the *last
 * account this browser looked up* rather than the person doing the looking.
 * Nothing authenticated it either. A log naming the wrong person is worse than
 * one naming nobody, so the column, the cookie and this reader all went; see
 * `db/migrations/1788000000005_drop_visitor_log_viewer.sql`.
 *
 * What would bring it back is an identity this app does not have. A random
 * browser id would answer the question the column was standing in for — "is
 * this the same visitor again" — without ever claiming to be a person, and is
 * the thing to add if the log ever needs to count people rather than requests.
 */

/**
 * Where the proxy runs, which is not the same question as what gets recorded.
 *
 * **Everything but the framework's own namespace and the favicon.** It used to
 * exclude `api/` as well, on the argument that a route handler is reached by
 * this app's own client rather than visited and the log has no use for it —
 * which was true of the log and is false of the HTTPS rule: an API route
 * reached over plain HTTP carries the visit log's session cookie, or a
 * credential, in the clear, and a matcher that skipped it would leave exactly
 * the requests that matter unguarded. So the API is in, the logging half still
 * declines it (`loggedRoute` answers null for `/api`), and the cost is a
 * Node-runtime invocation per API call — a function call in the same process,
 * which is nothing beside the route handler it precedes.
 *
 * `_next/` and `favicon.ico` stay out. Proxy runs on the Node.js runtime, and a
 * catch-all with no exclusions would spin one up for every chunk and image the
 * page loads — all of which `loggedRoute` would then refuse, having already
 * paid for the invocation. Those two carry that traffic, and neither carries a
 * cookie worth protecting. Next requires matcher values to be constants so it
 * can analyse them at build time, which is why this is a literal rather than a
 * list read out of a module.
 *
 * **What it must never do is exclude something `loggedRoute` would keep.** The
 * beacon reaches that predicate through `/api/logs/visit` without passing this
 * matcher at all, so an exclusion here that the predicate does not share is a
 * page whose in-app navigations are recorded and whose hard loads are not.
 * `routes.test.ts` reads this file and pins that direction.
 *
 * `/` needs no entry, and its absence is not an exclusion: `next.config.ts`
 * redirects it to `/tools`, and redirects are checked *before* the proxy, so
 * what lands here is the destination and the path the reader actually asked for
 * is never seen. A hit on `/manager` is a `/tools` row. That is the one gap
 * the logging half does not close, and it is why anything worth a permanent
 * redirect has to be named in that file. The HTTPS half is unaffected: the
 * redirected request arrives here over whatever scheme it was made on.
 */
export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};

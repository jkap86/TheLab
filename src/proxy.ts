import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

import { clientIp, recordVisit } from "@/shared/logs";

/**
 * Records a visit, and does nothing else.
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
 * throw, so nothing here can fail a page.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isPageView(request)) {
    event.waitUntil(
      recordVisit({
        ip: clientIp(request.headers),
        route: request.nextUrl.pathname,
      }),
    );
  }

  return NextResponse.next();
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
 * **So a row means "a browser asked for this page as a page"** — a hard load, a
 * new tab, a bookmark, a pasted link, a refresh. In-app clicks between tools are
 * not recorded, and mostly could not be: a prefetched route is served from the
 * router cache, so the click that follows often makes no request at all.
 *
 * The two conditions cover each other. `next-url` is the App Router's own
 * marker and is what a stray RSC request carries when `sec-fetch-*` is absent;
 * `sec-fetch-dest` is a browser-set header a page cannot forge, and its absence
 * is treated as a page view so that a client which sends no fetch metadata —
 * curl, a crawler, an older browser — is still counted.
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
 * The pages worth recording.
 *
 * **A positive list, and it cannot be generated from `constants/tools.ts`**,
 * however much it looks like it should be: Next requires matcher values to be
 * static constants so they can be analysed at build time, so a seventh tool is
 * a line here as well as there. A negative pattern would avoid that at the cost
 * of logging `_next` chunks, images and every API call, and of logging `/logs`
 * itself — which this list excludes by simply not naming it.
 *
 * `/` needs no entry: `next.config.ts` redirects it to `/tools`, and the
 * redirect is what the browser follows.
 */
export const config = {
  matcher: [
    "/tools",
    "/manager/:path+",
    "/lineupchecker",
    "/trades",
    "/picktracker",
    "/picktracker/:path+",
    "/comps",
  ],
};

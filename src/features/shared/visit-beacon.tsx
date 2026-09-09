"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Where a report goes. One caller, one route; see that file for the rules. */
const VISIT_ENDPOINT = "/api/logs/visit";

/**
 * Reports an in-app navigation to the visit log, and nothing else.
 *
 * **The proxy cannot do this and the page cannot either.** `proxy.ts` records a
 * browser asking for a page *as a page*, because an App Router prefetch and the
 * soft navigation that follows a click reach it identically — same URL, same
 * nine header names, same value for every one. That leaves a walk from `/tools`
 * to `/manager/<name>` unrecorded, which is most of what anybody does here. A
 * server component cannot close it either: a prefetched route is served out of
 * the client router cache, so the press that follows often makes **no request
 * at all**. The browser is where the two differ, because a prefetch runs no
 * code, and this is the smallest thing that can say so.
 *
 * **It does not report the page it mounts on.** That page arrived as a document
 * request and the proxy has already written it; sending it again would double
 * every hard load. `seen` starts as null precisely so the first pathname is
 * recorded as *seen* and not as a visit — which is also what makes React's
 * development remount a no-op rather than a row.
 *
 * **A subject change is not a navigation.** `usePathname` excludes the query
 * string, and the open card, the week stepper and the timeline all live in
 * `?league=` / `?week=` — several of them written with `history.pushState`
 * directly, which the router does not even see. Reading the whole URL here
 * would file a row every time somebody opened a card.
 *
 * **Nothing is awaited and nothing can fail loudly.** A visit is not worth a
 * page — `recordVisit`'s own bargain, on this side of the wire: the fetch is
 * fire-and-forget, its rejection is swallowed, and the route answers 204 to
 * every well-formed report including the ones it declines to keep, so a
 * navigation to a page this log does not record is silent rather than an error
 * in a reader's console.
 *
 * `keepalive` rather than `sendBeacon`: this fires on a soft navigation, where
 * nothing is unloading, and it is what lets the report carry a JSON content
 * type — which the route requires, and which `sendBeacon` can only spell
 * through a `Blob`.
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (seen.current === pathname) return;
    const first = seen.current === null;
    seen.current = pathname;
    if (first) return;

    void fetch(VISIT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ route: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}

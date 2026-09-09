import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { clientIp, loggedRoute, recordVisit } from "@/shared/logs";
import { BoundedCache } from "@/shared/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/logs/visit` — one in-app navigation.
 *
 * **This is the second writer, and it exists because the proxy cannot be the
 * only one.** `proxy.ts` records a browser asking for a page *as a page*, which
 * is every hard load and no in-app press: an App Router soft navigation and the
 * prefetch that precedes it reach the proxy with the same URL, the same nine
 * header names and the same value for every one — re-measured against Next
 * 16.3.3, which is the version this note is written under — so logging both is
 * the only option there and it invents visits to pages nobody opened. A
 * prefetch runs no client code, which makes the browser the one place the two
 * can be told apart. See `features/shared/visit-beacon.tsx`.
 *
 * **The port dropped an endpoint shaped like this and was right to.** TheLab2026's
 * `/api/common/logs/update` takes an `ip` and a `route` from anybody and writes
 * them, so its table is whatever the internet felt like putting there. Four
 * things narrow this one to something a reader can still believe:
 *
 * - **The address is read from the request and never from the body.** It is the
 *   same `clientIp` the proxy uses, with the same caveat its own note carries —
 *   an address here is what the request *claimed* — and there is no field a
 *   caller could put a different one in.
 * - **The route must be one of the seven this log keeps**, canonicalised by
 *   `loggedRoute`, so the column cannot hold a sentence, a URL or a page this
 *   app does not serve.
 * - **`Sec-Fetch-Site` must say `same-origin`.** The only legitimate caller is
 *   this app's own page in a browser; a header a page cannot forge is what says
 *   so. The cost is that a browser too old to send it goes uncounted, which is
 *   the *opposite* call from `isPageView`'s treatment of absent fetch metadata
 *   and right for the opposite reason: there a missing header costs a visit,
 *   here it would open a write.
 * - **A repeat of one route from one address is dropped for a moment**, which
 *   bounds what hammering this buys and doubles as the dedupe a remounted
 *   layout would otherwise need.
 *
 * **Every well-formed report is answered identically whether or not it wrote**,
 * so the vocabulary above cannot be learned by probing — and so the beacon has
 * nothing to handle: a navigation to `/logs`, which this log deliberately does
 * not keep, is a 204 rather than an error in a reader's console.
 */
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    const error: ApiErrorPayload = { error: "Not found" };
    return NextResponse.json(error, { status: 404 });
  }

  const route = await reportedRoute(request);
  if (route === undefined) {
    // A body this app's own client did not send. It is worth a status of its
    // own rather than a silent 204: reaching it means the beacon and this route
    // disagree about the shape, which is a bug on our side.
    const error: ApiErrorPayload = { error: "Expected { route }" };
    return NextResponse.json(error, { status: 400 });
  }

  if (route !== null) {
    const ip = clientIp(request.headers);
    const key = `${ip ?? "-"}|${route}`;
    if (!throttle.get(key)) {
      throttle.set(key, true);
      // Not awaited, and it cannot throw — the same bargain the proxy makes
      // through `waitUntil`. A route handler's invocation is already held open
      // by the response, so there is nothing here to keep alive.
      void recordVisit({ ip, route });
    }
  }

  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  const error: ApiErrorPayload = { error: "Use POST to record a visit" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "POST" } });
}

/**
 * The route the report names: a canonical path, `null` for a page this log does
 * not keep, or `undefined` for a body that is not a report at all.
 *
 * Three states rather than two, on `parseRequestedSeason`'s terms — "not a page
 * we record" and "not something this app sent" are different facts and only the
 * second is worth a status.
 */
async function reportedRoute(
  request: Request,
): Promise<string | null | undefined> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return undefined;
  }
  // Read as text and measured before parsing: `request.json()` on a body this
  // app did not send is an unbounded parse of whatever arrived.
  const body = await request.text().catch(() => "");
  if (body.length === 0 || body.length > MAX_BODY_LENGTH) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("route" in parsed)) {
    return undefined;
  }
  return loggedRoute((parsed as { route: unknown }).route);
}

/**
 * Enough for `{"route":"/manager/<username>"}` several times over, and far
 * short of anything worth parsing. `loggedRoute` bounds the route itself; this
 * bounds what reaches the parser.
 */
const MAX_BODY_LENGTH = 512;

/**
 * How long one address's report of one route is held to.
 *
 * A bound rather than a freshness policy, on `LEAGUE_REFRESH_COOLDOWN_MS`'
 * terms: what it is sized against is a double-fired effect and a script in a
 * loop, not a reader who genuinely opened the same page twice. Two seconds is
 * shorter than any real second look and longer than any remount.
 *
 * Module-level rather than on `globalThis`: it holds nothing worth surviving a
 * dev reload, and a throttle that forgot its window costs one duplicate row.
 */
const VISIT_THROTTLE_MS = 2_000;

/**
 * Bounded so a burst from many addresses cannot grow it without limit — the
 * `BoundedCache` bargain, with the entries uniform so no weight is needed.
 */
const throttle = new BoundedCache<true>(2_000, VISIT_THROTTLE_MS);

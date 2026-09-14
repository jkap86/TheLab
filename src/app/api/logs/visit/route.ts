import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { loggedRoute, recordVisit } from "@/shared/logs";
import { clientIp, isJsonRequest, readJsonWithin, sameOriginRequest } from "@/shared/request";

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
 * them, so its table is whatever the internet felt like putting there. Five
 * things narrow this one to something a reader can still believe:
 *
 * - **The address is read from the request and never from the body.** It is the
 *   same `clientIp` the proxy uses — the entry the trusted router appended to
 *   `x-forwarded-for`, on `request/client-ip`'s policy — and there is no field a
 *   caller could put a different one in.
 * - **The route must be a page this app serves**, in a shape it serves,
 *   canonicalised by `loggedRoute`, so the column cannot hold a sentence, a
 *   URL, an invented path or a request for a file. It is the same rule the
 *   proxy applies, which is the whole of the vocabulary.
 * - **The browser must say the report came from this app's own page** —
 *   `sameOriginRequest`, which asks `Sec-Fetch-Site` and `Origin` both. That is
 *   a forgery check and not authentication: it proves a page on this origin
 *   made the request, and nothing about who is at the keyboard, which is why
 *   the two bounds below exist as well.
 * - **The body is read within 512 bytes**, never whole: a body past that is
 *   refused at its first chunk rather than allocated and then measured.
 * - **Every write is admitted by `recordVisit`'s own bound** — a dedupe window,
 *   an in-flight cap, a per-client rate and a process rate — so a script in a
 *   loop buys a handful of rows a minute and then nothing.
 *
 * **Every well-formed report is answered identically whether or not it wrote**,
 * so the rule above cannot be learned by probing — and so the beacon has
 * nothing to handle: a report this log declines to keep is a 204 rather than an
 * error in a reader's console.
 */
export async function POST(request: Request) {
  if (!sameOriginRequest(request.headers).ok) {
    const error: ApiErrorPayload = { error: "Not found" };
    return NextResponse.json(error, { status: 404 });
  }

  if (!isJsonRequest(request.headers)) return notAReport();
  const read = await readJsonWithin(request, MAX_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === "too-large") {
      const error: ApiErrorPayload = { error: "Body too large" };
      return NextResponse.json(error, { status: 413 });
    }
    return notAReport();
  }
  if (typeof read.value !== "object" || read.value === null || !("route" in read.value)) {
    return notAReport();
  }

  const route = loggedRoute((read.value as { route: unknown }).route);
  if (route !== null) {
    // Not awaited, and it cannot throw — the same bargain the proxy makes
    // through `waitUntil`. A route handler's invocation is already held open by
    // the response, so there is nothing here to keep alive.
    void recordVisit({ ip: clientIp(request.headers), route });
  }

  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  const error: ApiErrorPayload = { error: "Use POST to record a visit" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "POST" } });
}

/**
 * A body this app's own client did not send. Worth a status of its own rather
 * than a silent 204: reaching it means the beacon and this route disagree
 * about the shape, which is a bug on our side.
 */
function notAReport() {
  const error: ApiErrorPayload = { error: "Expected { route }" };
  return NextResponse.json(error, { status: 400 });
}

/**
 * Enough for `{"route":"/manager/<username>"}` several times over, and far
 * short of anything worth parsing. `loggedRoute` bounds the route itself; this
 * bounds what reaches the parser — and it is enforced while the bytes arrive.
 */
const MAX_BODY_BYTES = 512;

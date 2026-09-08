import { redirect } from "next/navigation";

/**
 * Any URL this app has no route for goes to the tool grid.
 *
 * This app took TheLabX's address, and `next.config.ts` names the four old
 * paths worth a destination of their own. This is the backstop for every one it
 * did not think of — an older shape of that app, a link off somebody's
 * spreadsheet, a path nobody here remembers publishing.
 *
 * **It lives here rather than in `redirects()` because of what fires it.** A
 * config redirect is checked *before* the filesystem, so a catch-all `source`
 * would have to carry a negative lookahead naming every real route — and would
 * then silently swallow the next one added, which is a page that renders
 * perfectly in development and redirects away in production with nothing on
 * screen saying why. This runs only where Next itself found no route, which is
 * the signal that is right by construction rather than by a list somebody has
 * to keep in step.
 *
 * **The redirect is the client's, and the response is still a 404.** Next pins
 * the status of this route whatever is rendered in it — `force-dynamic` does
 * not move it, which was checked — so what actually ships is a 404 carrying a
 * `Location: /tools` header no browser follows, plus a `NEXT_REDIRECT` in the
 * flight payload that React runs on hydration. Driven in headless Chrome, that
 * lands on `/tools` inside ~50ms, through the app's own ground rather than an
 * error page; the browser logs one 404 for the document, which is the whole of
 * the visible cost. What it does not do is redirect a client with no
 * JavaScript, so a crawler sees a 404 for a URL that genuinely does not exist,
 * which is the honest answer to give one.
 *
 * **Nothing here is cached, and that is the property to keep.** The four in
 * `next.config.ts` are 308s, which a browser holds for ever, because those
 * paths are gone for good. This one names paths nobody has enumerated, and a
 * path that becomes a real page later must not be shadowed by a permanent
 * redirect sitting in a reader's browser.
 *
 * **A root `[...slug]` page would answer a real 307, and it would cost `/logs`
 * its cover.** That page answers a missing or wrong key with `notFound()`
 * precisely so it looks like no page at all — and a catch-all *route* does not
 * catch `notFound()`, so `/logs` would be the one path in the app still
 * answering 404 while every unknown one answered 307, which makes the 404 the
 * tell rather than the cover. Rendered here instead they are the same answer to
 * a reader: checked against the running build, `/logs` with no key and
 * `/nonsense` both carry the same `NEXT_REDIRECT` and both land on `/tools`.
 * They are not byte-identical — a prerendered 404 carries `x-nextjs-prerender`
 * and the `Location` header where a dynamically rendered one carries neither —
 * but that asymmetry is `/logs` being `force-dynamic` and predates this file.
 * `/api/logs` never reaches here at all: a route handler answers it with its
 * own JSON 404.
 *
 * The other side of catching everything is that an unmatched `/api/...` —
 * TheLabX's `/api/adp` and the rest — answers HTML rather than saying there is
 * nothing there. Nothing outside this app called those, and a reader holding a
 * stale *page* link is far likelier here than a caller holding a stale JSON
 * one.
 */
export default function NotFound() {
  redirect("/tools");
}

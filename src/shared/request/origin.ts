/**
 * Whether a state-changing request came from this app's own pages.
 *
 * A cross-site request forgery is a browser being made to POST somewhere with
 * the cookies it holds for that somewhere; what defeats it is the browser's
 * own word about where the request was made *from*. Two headers carry that
 * word and neither can be set by page script: `Origin`, which every browser
 * sends on a cross-origin request and on every `fetch`/form POST, and
 * `Sec-Fetch-Site`, which newer browsers send on every request.
 *
 * **Both are asked and either may refuse.** `Sec-Fetch-Site`, where present,
 * must say `same-origin`. `Origin` must be present and must name this
 * request's own host on this request's own scheme. A request carrying neither
 * is not a browser page and is refused: a scripted client can set `Origin` to
 * the site's own origin, which is the one thing it has to say to be treated
 * as the site talking to itself.
 *
 * This is a **forgery check, not authentication** — `sec-fetch-site` in
 * particular proves that a browser sent the request from a page on this
 * origin, and nothing about who is at the keyboard. The visit-log beacon's
 * own note has always said so; the credential endpoint keeps the
 * distinction by asking for the credential as well.
 *
 * The host is the request's `Host` header — the one Heroku's router routed on,
 * so a request that reached this app under it is one the platform agreed was
 * for it. `X-Forwarded-Host` is deliberately not consulted: it is not a header
 * the router sets, so on this deployment it is only ever a client's own.
 */

export type OriginCheck = { ok: true } | { ok: false; reason: string };

export function sameOriginRequest(
  headers: Headers,
  forwardedProto: string | null = headers.get("x-forwarded-proto"),
): OriginCheck {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return { ok: false, reason: `sec-fetch-site is ${site}` };
  }

  const origin = headers.get("origin");
  if (origin === null) return { ok: false, reason: "no origin" };
  if (origin === "null") return { ok: false, reason: "opaque origin" };

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: "unreadable origin" };
  }

  const host = headers.get("host")?.trim().toLowerCase();
  if (!host) return { ok: false, reason: "no host" };
  if (parsed.host.toLowerCase() !== host) {
    return { ok: false, reason: `origin ${parsed.host} is not ${host}` };
  }

  // Behind Heroku the router says which scheme the client used; a page served
  // over https does not send an http origin, so a mismatch is a forgery or a
  // downgrade and is refused either way. With no proxy in front (development)
  // there is nothing to compare against.
  const proto = forwardedProto?.split(",")[0].trim().toLowerCase();
  if (proto && parsed.protocol !== `${proto}:`) {
    return { ok: false, reason: `origin scheme ${parsed.protocol} is not ${proto}` };
  }

  return { ok: true };
}

/**
 * HTTPS enforcement and the HSTS header, decided once and testably.
 *
 * Heroku terminates TLS at its router and hands the app plain HTTP either way,
 * so the app cannot tell a secure request from an insecure one by its socket —
 * only by `X-Forwarded-Proto`, which the router sets from the scheme the client
 * actually used. A certificate on the platform does not redirect anybody: an
 * `http://` link keeps working, keeps sending the visit-log session cookie in
 * the clear, and keeps serving pages nobody meant to serve that way. This is
 * the decision the proxy applies to every request that reaches it.
 *
 * **The redirect target is the configured origin, never the request's own
 * host.** A redirect that echoed `Host` back would let anyone who could reach
 * the app with a forged host header — a scanner, a misrouted request — mint a
 * redirect to a site of their choosing. `SITE_URL` is already the app's one
 * statement of where it is served from (`shared/og/site-url`), so it is the
 * only origin a redirect may name; a deployment that has not set it, or has
 * set it to an `http://` origin, gets **no enforcement and a warning**, because
 * the one thing worse than not redirecting is redirecting to a guess.
 *
 * **Only a request the router marked `http` is acted on.** A request carrying
 * `https` is served, with the HSTS header; a request carrying no
 * `X-Forwarded-Proto` at all — local development, a direct connection with no
 * proxy — is served as it is, with no header, so `npm run dev` is untouched.
 * That is also what makes a loop impossible: the router marks the redirected
 * request `https`, and `https` never redirects.
 *
 * **A GET is redirected and anything else is refused.** Redirecting a POST
 * either drops its body (a 301/302 turns it into a GET) or re-sends it (a
 * 307/308), and a body that arrived over plain HTTP — a credential, say — has
 * already crossed the network in the clear; re-sending it securely does not
 * take that back. A 403 says HTTPS is required and processes nothing.
 *
 * **HSTS is emitted only on secure responses while enforcement is on**, with a
 * max-age that starts short and is raised deliberately — see
 * {@link DEFAULT_HSTS_MAX_AGE_SECONDS}. `includeSubDomains` is off unless the
 * deployment says otherwise, since it is a claim about hosts this app does not
 * serve, and `preload` is never emitted: preloading is a submission to a list
 * browsers ship with, is effectively permanent, and is not a thing a config
 * var should be able to do by accident.
 */
import { resolveSiteUrl, SITE_URL_ENV } from "../og/site-url.ts";

export const ENFORCE_HTTPS_VAR = "ENFORCE_HTTPS";
export const HSTS_MAX_AGE_VAR = "HSTS_MAX_AGE_SECONDS";
export const HSTS_INCLUDE_SUBDOMAINS_VAR = "HSTS_INCLUDE_SUBDOMAINS";

/**
 * One day. Short on purpose: an HSTS policy is cached by every browser that
 * sees it for exactly this long, so a mistake — a certificate that lapses, a
 * host that has to go back to plain HTTP — is a day of readers locked out
 * rather than a year. The rollout policy is to run at a day, confirm every
 * path the app serves works over HTTPS, and then raise the variable to a year
 * (`31536000`). The step in between is the deployment's own call.
 */
export const DEFAULT_HSTS_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Longer than a browser needs; anything past it is a typo. */
const MAX_HSTS_MAX_AGE_SECONDS = 2 * 365 * 24 * 60 * 60;

export type HttpsPolicy =
  | { enforce: false; reason: string; warning?: string }
  | {
      enforce: true;
      /** The `https://host` every redirect points at. */
      origin: string;
      /** The `Strict-Transport-Security` value for a secure response. */
      hsts: string;
      warning?: string;
    };

/** `on`/`off` words, case-insensitively; anything else is `fallback`. */
function onOff(raw: string | undefined, fallback: boolean): boolean {
  const word = raw?.trim().toLowerCase();
  if (!word) return fallback;
  if (["on", "true", "1", "yes"].includes(word)) return true;
  if (["off", "false", "0", "no"].includes(word)) return false;
  return fallback;
}

/** The HSTS value the environment asks for. */
export function hstsHeader(env: Record<string, string | undefined>): string {
  const raw = env[HSTS_MAX_AGE_VAR]?.trim();
  let maxAge = DEFAULT_HSTS_MAX_AGE_SECONDS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_HSTS_MAX_AGE_SECONDS) {
      maxAge = parsed;
    }
  }
  const subdomains = onOff(env[HSTS_INCLUDE_SUBDOMAINS_VAR], false);
  return `max-age=${maxAge}${subdomains ? "; includeSubDomains" : ""}`;
}

/**
 * Resolve the policy from the environment.
 *
 * Enforcement defaults on in production and off elsewhere; `ENFORCE_HTTPS`
 * overrides either way. On, it needs an `https://` `SITE_URL` to redirect to,
 * and stands down with a warning without one.
 */
export function httpsPolicy(
  env: Record<string, string | undefined>,
  production: boolean,
): HttpsPolicy {
  if (!onOff(env[ENFORCE_HTTPS_VAR], production)) {
    return { enforce: false, reason: production ? `${ENFORCE_HTTPS_VAR} is off` : "not production" };
  }
  const site = resolveSiteUrl(env, production);
  const raw = env[SITE_URL_ENV]?.trim();
  if (!raw || site.warning) {
    return {
      enforce: false,
      reason: `${SITE_URL_ENV} is not a usable origin`,
      warning:
        `${ENFORCE_HTTPS_VAR} is on but ${SITE_URL_ENV} is ${raw ? `"${raw}"` : "not set"}, ` +
        `so insecure requests are being served rather than redirected. Set ${SITE_URL_ENV} ` +
        `to the https:// origin this app is served from.`,
    };
  }
  let origin: URL;
  try {
    origin = new URL(site.url);
  } catch {
    return { enforce: false, reason: `${SITE_URL_ENV} is not a URL` };
  }
  if (origin.protocol !== "https:") {
    return {
      enforce: false,
      reason: `${SITE_URL_ENV} is not https`,
      warning:
        `${ENFORCE_HTTPS_VAR} is on but ${SITE_URL_ENV} (${site.url}) is not an https:// ` +
        `origin, so nothing is redirected. Set it to the https:// origin this app is served from.`,
    };
  }
  return { enforce: true, origin: origin.origin, hsts: hstsHeader(env) };
}

/** What the proxy sees of a request, and all it needs to decide. */
export type HttpsRequest = {
  method: string;
  /** The `X-Forwarded-Proto` header, or null. */
  forwardedProto: string | null;
  /** Path and query as they arrived, e.g. `/logs` and `?hours=24`. */
  pathname: string;
  search: string;
};

export type HttpsDecision =
  /** Serve it; `hsts` is the header to add, or null for none. */
  | { kind: "next"; hsts: string | null }
  | { kind: "redirect"; status: 301; location: string }
  /** An insecure request that must not be processed. */
  | { kind: "refuse"; status: 403 };

/** The methods a redirect can carry without changing what the request means. */
const REDIRECTABLE = new Set(["GET", "HEAD"]);

/**
 * The query string a redirect may carry forward.
 *
 * The visit log used to be opened with `?key=<token>`; that path is gone and a
 * redirect that carried the parameter onto the secure origin would put a
 * retired credential into the router's log a second time. Everything else —
 * a season, a week, an open card — rides along.
 */
export function redirectSearch(pathname: string, search: string): string {
  if (!search) return "";
  if (pathname !== "/logs" && pathname !== "/api/logs") return search;
  const params = new URLSearchParams(search);
  params.delete("key");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** Decide one request under `policy`. */
export function decideHttps(policy: HttpsPolicy, request: HttpsRequest): HttpsDecision {
  if (!policy.enforce) return { kind: "next", hsts: null };

  // The router sets one value; a chain of proxies may have appended, and the
  // first entry is the scheme the client used.
  const proto = request.forwardedProto?.split(",")[0].trim().toLowerCase() ?? null;
  if (proto === "https") return { kind: "next", hsts: policy.hsts };
  if (proto !== "http") return { kind: "next", hsts: null };

  if (!REDIRECTABLE.has(request.method.toUpperCase())) return { kind: "refuse", status: 403 };

  const pathname = request.pathname.startsWith("/") ? request.pathname : `/${request.pathname}`;
  return {
    kind: "redirect",
    status: 301,
    location: `${policy.origin}${pathname}${redirectSearch(pathname, request.search)}`,
  };
}

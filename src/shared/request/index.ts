// What a request proves about itself, and what a handler may take from it:
// the address behind the trusted proxies, a body read inside a bound, whether
// a mutation came from this app's own pages, and whether the request was
// secure. Pure throughout — nothing here reaches Postgres or Sleeper — so the
// proxy, the route handlers and Node's own runner can all import it.
export {
  clientIp,
  clientIpPolicy,
  clientKey,
  DEFAULT_TRUSTED_PROXY_HOPS,
  isAddress,
  normalizeAddress,
  TRUSTED_PROXY_HOPS_VAR,
} from "./client-ip";
export type { ClientIpPolicy } from "./client-ip";
export { declaredLength, isJsonRequest, readBodyWithin, readJsonWithin } from "./body";
export type { BodyRead, BodyRefusal, JsonRead } from "./body";
export { sameOriginRequest } from "./origin";
export type { OriginCheck } from "./origin";
export {
  DEFAULT_HSTS_MAX_AGE_SECONDS,
  decideHttps,
  ENFORCE_HTTPS_VAR,
  HSTS_INCLUDE_SUBDOMAINS_VAR,
  HSTS_MAX_AGE_VAR,
  hstsHeader,
  httpsPolicy,
  redirectSearch,
} from "./https";
export type { HttpsDecision, HttpsPolicy, HttpsRequest } from "./https";

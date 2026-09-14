/**
 * The address a request came from, under a stated trusted-proxy policy — or
 * null when there is no trustworthy answer.
 *
 * Pure: the headers and the policy arrive as arguments, so the parsing and the
 * hop rule can both be tested without a request. `node:net`'s `isIP` is the
 * parser, on the rule that an address is validated whole or refused: the
 * predecessor of this module sliced a long claim to 45 characters *before*
 * matching it, which is how an attacker-supplied string becomes a valid-looking
 * address that names nobody.
 *
 * **`X-Forwarded-For` is read from the right, never the left.** The header is a
 * list every proxy on the path *appends* to, so the entries on the right were
 * written by the proxies this deployment controls and the entries on the left
 * by whoever connected. Heroku's router appends the address of the peer that
 * connected to it; reading the first entry, as this app used to, trusted
 * whatever a client typed into its own request — which is how a forged address
 * could be written into the visit log and how a per-address throttle could be
 * rotated through at will.
 *
 * **The policy is a hop count.** `TRUSTED_PROXY_HOPS` is how many proxies this
 * app trusts to have appended honestly, counted from the right: `1` is direct
 * Heroku routing (the default), `2` is a CDN in front of Heroku that sets the
 * header itself, and `0` says no proxy is trusted at all, so the header is
 * ignored and every address is null — the right setting for a process reached
 * with nothing in front of it, where the header is a claim and nothing else.
 * The client is entry `length − hops`; a header shorter than the trusted chain
 * carries no client at all, which is absent rather than a guess.
 *
 * `X-Real-IP` is deliberately not read. Heroku's router does not set it, so on
 * this deployment it is only ever a client's own header.
 */
import { isIP } from "node:net";

/** The variable the hop count is read from. */
export const TRUSTED_PROXY_HOPS_VAR = "TRUSTED_PROXY_HOPS";

/** Direct Heroku routing: one router, which appends the connecting peer. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/** More proxies than any deployment of this app is going to have in front of it. */
const MAX_TRUSTED_PROXY_HOPS = 8;

/**
 * The longest string worth handing to the parser. A full IPv6 address is 45
 * characters; anything longer is not one, whatever else it is, and is refused
 * whole rather than trimmed into something that might be.
 */
const MAX_ADDRESS_LENGTH = 45;

export type ClientIpPolicy = {
  /** Proxies trusted to have appended to `X-Forwarded-For`, from the right. */
  trustedHops: number;
  /** Set where the environment said something this could not honour. */
  warning?: string;
};

/**
 * Read {@link TRUSTED_PROXY_HOPS_VAR}.
 *
 * Junk falls back to the Heroku default and says so — a typo in a config var
 * must not silently switch the log to trusting every forged header, nor to
 * recording nothing.
 */
export function clientIpPolicy(
  env: Record<string, string | undefined> = process.env,
): ClientIpPolicy {
  const raw = env[TRUSTED_PROXY_HOPS_VAR]?.trim();
  if (!raw) return { trustedHops: DEFAULT_TRUSTED_PROXY_HOPS };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TRUSTED_PROXY_HOPS) {
    return {
      trustedHops: DEFAULT_TRUSTED_PROXY_HOPS,
      warning:
        `Ignoring ${TRUSTED_PROXY_HOPS_VAR}="${raw}"; expected an integer from 0 to ` +
        `${MAX_TRUSTED_PROXY_HOPS}. Using ${DEFAULT_TRUSTED_PROXY_HOPS} (direct Heroku routing).`,
    };
  }
  return { trustedHops: parsed };
}

/**
 * One address, validated whole and put into the form the log stores.
 *
 * - An IPv4-mapped IPv6 address (`::ffff:203.0.113.5`) is how a dual-stack
 *   listener reports a v4 client; stored mapped, one visitor reads as two
 *   addresses depending on which socket answered.
 * - IPv6 is lower-cased so one address has one spelling as a key.
 * - A zone id (`fe80::1%eth0`) parses as an address and is not one Postgres's
 *   `INET` will take, so it is refused here rather than at the insert.
 * - Anything else `isIP` refuses — brackets, a port, an out-of-range octet, a
 *   word — is null, never a sentinel.
 */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_LENGTH) return null;
  if (trimmed.includes("%")) return null;
  const unmapped = trimmed.replace(/^::ffff:(?=\d)/i, "");
  const kind = isIP(unmapped);
  if (kind === 4) return unmapped;
  if (kind === 6) return unmapped.toLowerCase();
  return null;
}

/** Whether `value` is an address this app would store or key on. */
export function isAddress(value: string): boolean {
  return normalizeAddress(value) !== null;
}

/**
 * The client address a request proves under `policy`, or null.
 *
 * Null means "no trustworthy address": the header is absent, shorter than the
 * trusted chain, the trusted entry is not an address, or no proxy is trusted
 * at all. Nothing downstream may read null as a sentinel and nothing may read
 * an address as an identity — it is the peer a trusted proxy saw, which is
 * enough to key a throttle on and not enough to name anybody.
 */
export function clientIp(
  headers: Headers,
  policy: ClientIpPolicy = defaultPolicy(),
): string | null {
  if (policy.trustedHops <= 0) return null;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length < policy.trustedHops) return null;
  return normalizeAddress(entries[entries.length - policy.trustedHops]);
}

/**
 * The key a per-client bound counts a request under.
 *
 * An address where the policy proves one, and one shared bucket otherwise —
 * which is every request in a deployment that trusts no proxy, and every
 * request in local development. A bound keyed this way is honest about what it
 * can tell apart: it bounds *what one address can do*, and where there is no
 * address it bounds everyone together rather than nobody.
 */
export function clientKey(headers: Headers, policy?: ClientIpPolicy): string {
  return clientIp(headers, policy) ?? "unknown";
}

let cached: ClientIpPolicy | null = null;

/**
 * The process's policy, read once and warned about once.
 *
 * Cached rather than re-read per request: the environment does not change on a
 * running dyno, and the warning belongs at boot rather than on every log line.
 */
function defaultPolicy(): ClientIpPolicy {
  if (cached === null) {
    cached = clientIpPolicy();
    if (cached.warning) console.warn(`[request] ${cached.warning}`);
  }
  return cached;
}

/**
 * The address a request came from, or null when there isn't one to have.
 *
 * Pure — the headers arrive as an argument — so the parsing can be tested
 * without a request.
 *
 * **Null rather than a sentinel string, and that is the whole point of this
 * module.** The app this was ported from returns the literal `"Unknown IP"` or
 * `"Invalid IP"` here and writes it into an `INET NOT NULL` column; Postgres
 * refuses the cast, the fire-and-forget insert swallows the error, and the visit
 * is lost with nothing said. It is why that app records no local visits at all,
 * since `x-forwarded-for` is absent when nothing is proxying. An address we
 * cannot read is absent, and the column is nullable to say so.
 */

/**
 * The longest string worth examining. An `x-forwarded-for` is attacker-supplied
 * — nothing about it is trustworthy, including its length — and a full IPv6
 * address is 45 characters, so anything past the first entry's worth of them is
 * not an address whatever else it is.
 */
const MAX_ADDRESS_LENGTH = 45;

/**
 * IPv4, four decimal octets in range.
 *
 * Spelled out rather than `\d{1,3}` because that accepts `999.999.999.999`,
 * which then reaches Postgres and throws the error this module exists to avoid.
 */
const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * IPv6, in the two shapes that actually occur: eight full groups, or a `::`
 * elision somewhere in fewer.
 *
 * Deliberately stricter than the ported original's `([0-9a-fA-F]{0,4}:){2,7}…`,
 * which accepts `:::` and other strings `INET` then rejects. The four-mapped
 * form (`::ffff:1.2.3.4`) is not matched here on purpose — it is unwrapped to
 * its IPv4 before this is reached, which is the form anybody reading the page
 * expects to see.
 */
const IPV6_FULL = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
const IPV6_ELIDED =
  /^(([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?)::(([0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*)?)$/;

/** Whether `value` is something `INET` will accept. */
export function isAddress(value: string): boolean {
  if (!value || value.length > MAX_ADDRESS_LENGTH) return false;
  if (IPV4.test(value)) return true;
  if (IPV6_FULL.test(value)) return true;
  // `::` on its own is the unspecified address; it passes the elided form and
  // is a real address, so no special case is needed here.
  return IPV6_ELIDED.test(value);
}

/**
 * The client address behind whatever proxies are in front of this app.
 *
 * `x-forwarded-for` is a list appended to hop by hop, so the client is the
 * *first* entry; the rest are the proxies. It is trusted blindly, exactly as
 * the original does, and that is worth being explicit about rather than quiet:
 * anyone can set the header, so an address here is what the request *claimed*,
 * not what it proved. The page is a private log rather than an access control,
 * so a claim is what it needs — but nothing downstream may treat these as
 * identities.
 *
 * Falls back to `x-real-ip`, which is what nginx sets and Heroku's router does
 * not, so it costs nothing where it is absent.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  return normalize(forwarded) ?? normalize(headers.get("x-real-ip"));
}

function normalize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // An IPv4-mapped IPv6 address (`::ffff:203.0.113.5`) is how a dual-stack
  // listener reports a v4 client. Stored mapped, the same visitor reads as two
  // different addresses depending on which socket answered.
  const value = raw.trim().slice(0, MAX_ADDRESS_LENGTH).replace(/^::ffff:/i, "");
  return isAddress(value) ? value : null;
}

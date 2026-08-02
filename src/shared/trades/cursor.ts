/**
 * The trades board's page cursor: where the last page stopped, in the ordering
 * the board is read in.
 *
 * **It is a keyset, not a Postgres cursor**, and the distinction is the whole
 * point of the module. The route used to hold one `DECLARE`d cursor open across
 * the entire season, which pinned a pooled connection for as long as the walk
 * ran — and the walk ran while the route was resolving player names, league
 * settings and KTC prices for the chunk it had just read. A keyset holds no
 * server-side state at all: each page is one bounded query that finishes and
 * hands its connection back *before* any enrichment starts.
 *
 * What that costs is that the resume position has to be expressible as a value.
 * The board is ordered `(completed_at DESC, transaction_id DESC)` — the
 * timestamp being `coalesce(status_updated, created, 0)`, with the zero standing
 * in for Sleeper's undated rows so the order stays total rather than depending
 * on `NULLS LAST`. Those two fields are exactly what a cursor carries.
 *
 * It is **opaque on the wire** (base64url) for the ordinary reason: a caller who
 * can read it will eventually construct one, and then the ordering is a public
 * contract rather than an implementation detail. It is not signed — there is
 * nothing to protect, since every trade behind it is readable by asking for the
 * first page and scrolling.
 */

/** Where a page stopped: the last row's sort key. */
export type TradeCursor = {
  /** `coalesce(status_updated, created, 0)`, epoch milliseconds. */
  at: number;
  transaction_id: string;
};

/**
 * `{at, transaction_id}` → the opaque token the next request sends back.
 *
 * The delimiter is `:` and the id is *not* escaped, because Sleeper's
 * transaction ids are decimal digit strings — {@link decodeTradeCursor} splits
 * on the first colon for that reason, so an id that ever grew one would round
 * trip anyway.
 */
export function encodeTradeCursor(cursor: TradeCursor): string {
  return base64UrlEncode(`${cursor.at}:${cursor.transaction_id}`);
}

/**
 * A token back into a resume position, or null for anything that isn't one.
 *
 * Null rather than a throw: a cursor is a value a client holds across a filter
 * change, a redeploy and a bookmark, so "I can't read this" has to degrade to
 * "start at the beginning" rather than to a 400. The alternative shows a reader
 * an error page for a stale URL.
 */
export function decodeTradeCursor(token: string | null): TradeCursor | null {
  if (!token) return null;
  const raw = base64UrlDecode(token);
  if (raw === null) return null;

  const split = raw.indexOf(":");
  if (split <= 0) return null;

  const at = Number(raw.slice(0, split));
  const transaction_id = raw.slice(split + 1);
  if (!Number.isFinite(at) || !Number.isInteger(at) || at < 0) return null;
  if (!transaction_id) return null;

  return { at, transaction_id };
}

/**
 * Base64url rather than base64, so the token survives a query string untouched:
 * `+` becomes a space when a form-encoded parameter is parsed, and `/` and `=`
 * both need escaping. Padding is dropped and restored on the way back.
 */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

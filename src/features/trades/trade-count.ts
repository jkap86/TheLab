/**
 * The headline count, and the one thing it must never do: present a page as a
 * total.
 *
 * **A count that failed is not a count of what loaded.** `/api/trades` degrades
 * its denominators deliberately — a failed count costs the page a fraction and
 * never the trades — and ships `total: null` to say so. The board then read
 * `data.total ?? data.trades.length` and printed the result as though it were
 * the answer, so a reader on the first page of a board with thousands of trades
 * was told there were "100 trades". That is a *wrong number* wearing the
 * confidence of a right one, which is the failure this whole codebase spends
 * its effort not having; the em dash grammar exists for exactly this and the
 * fallback went around it.
 *
 * The rule is that the count may only claim to be exact when something counted
 * it. What is known otherwise is a **floor** — the rows in hand — and there is
 * an honest way to say a floor.
 *
 * Pure and in its own module for the reason the rest of this feature's rules
 * are: the difference between "428 trades" and "100+ trades" is one character
 * of markup and a claim the reader cannot check.
 */

/** What the headline says, and how sure it is. */
export type TradeCountReading =
  /** Nothing to say yet — a first page is in flight. */
  | { kind: "pending" }
  /**
   * Somebody counted. `scopeTotal` is the "of M" — the population the league
   * rules and the circle leave — and is absent when it equals `total`, since
   * "428 of 428" is a fraction that says nothing.
   */
  | { kind: "exact"; total: number; scopeTotal: number | null }
  /**
   * The count failed and the walk has not finished, so all that is known is
   * that there are *at least* this many. Drawn `100+`.
   */
  | { kind: "atLeast"; loaded: number }
  /**
   * The count failed but the board is exhausted, so the rows in hand **are**
   * every row there is. This is exact by a different route and says so.
   */
  | { kind: "loaded"; loaded: number };

/**
 * Read the headline off what the board holds.
 *
 * Four states rather than a number and a flag, because the wording differs in
 * each and a caller that had to derive it would be the second place this rule
 * lives.
 *
 * The `hasMore` distinction is the one worth stating: with the count gone, a
 * board that has *finished walking* knows its own size exactly — every row was
 * fetched — so `loaded` is a real total and is drawn as one. It is only while
 * more pages exist that the number in hand is a floor.
 */
export function tradeCountReading(
  data: {
    trades: readonly unknown[];
    total: number | null;
    scopeTotal: number | null;
  } | null,
  loading: boolean,
  hasMore: boolean,
): TradeCountReading {
  if (loading || !data) return { kind: "pending" };

  if (data.total !== null) {
    return {
      kind: "exact",
      total: data.total,
      // Absent where the two agree — an unnarrowed board counts one number and
      // reports it twice, and "428 of 428" is a fraction with nothing in it.
      scopeTotal:
        data.scopeTotal !== null && data.scopeTotal !== data.total
          ? data.scopeTotal
          : null,
    };
  }

  const loaded = data.trades.length;
  return hasMore ? { kind: "atLeast", loaded } : { kind: "loaded", loaded };
}

/**
 * The reading as the rail prints it.
 *
 * Singular and plural are handled at every arm, including the `+` one — "1+
 * trades" is right where "1+ trade" is not, because the `+` is a claim about a
 * number greater than one.
 */
export function tradeCountLabel(reading: TradeCountReading): string {
  switch (reading.kind) {
    case "pending":
      return "Reading…";
    case "exact": {
      if (reading.scopeTotal === null) {
        return `${reading.total.toLocaleString()} ${plural(reading.total)}`;
      }
      // **The noun agrees with the denominator, not the numerator.** "1 of 90
      // trades" is the phrase; "1 of 90 trade" is what agreeing with the `1`
      // gives, and it is wrong in the ordinary case rather than an edge one —
      // a reader who has narrowed to a single trade sees it every time.
      const of = reading.scopeTotal.toLocaleString();
      return `${reading.total.toLocaleString()} of ${of} ${plural(reading.scopeTotal)}`;
    }
    case "atLeast":
      // The board is still walking, so this is a floor. `+` is the shortest
      // honest form and the one the rail has room for.
      return `${reading.loaded.toLocaleString()}+ trades`;
    case "loaded":
      return `${reading.loaded.toLocaleString()} ${plural(reading.loaded)}`;
  }
}

const plural = (n: number) => (n === 1 ? "trade" : "trades");

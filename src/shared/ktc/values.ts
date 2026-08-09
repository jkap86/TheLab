/**
 * How two KTC rows mapped to one Sleeper player become one price on each board.
 *
 * `ktc_values.sleeper_id` carries no unique constraint and cannot: the match is
 * name-based (`./match`), so an alias, a suffix KTC spells differently, or a
 * retired entry beside a current one can all resolve to the same Sleeper id.
 * That is legitimate data rather than corruption, which is why the *read* has to
 * be defensive — cleaning the table up would not stop the next scrape from
 * producing another pair.
 *
 * **The two boards are resolved independently, and the version that picked a
 * whole row was wrong for the board it did not sort on.** The read used to be
 * `DISTINCT ON (sleeper_id) … ORDER BY sf_value DESC`, so a player with
 *
 *     row A: sf 9000, 1QB 5000
 *     row B: sf 8000, 1QB 7000
 *
 * came back as `{ sf: 9000, oneqb: 5000 }` — row A's superflex price beside row
 * A's 1QB price, when the highest mapped 1QB price on file is row B's 7000. It is
 * silent by construction: the number is a real number from a real row, so nothing
 * downstream can tell, and it is only ever wrong on the 1QB board — the four
 * one-QB leagues out of a hundred-odd, which is precisely the population a
 * default already misprices (see `./roster`).
 *
 * The rule is the one the old comment claimed and the SQL didn't keep: **the
 * highest valid mapped value, per board.** Higher rather than either row's, since
 * summing a roster twice for one player is the failure worth avoiding first and
 * the fallen-off-the-board row of a pair is the one carrying nulls or stale lows.
 *
 * Pure and dependency-free so the resolution can be tested without a database
 * behind it — `./queries` selects the rows and hands them here, the same
 * thin-I/O-over-pure-logic split as `./picks` beside it. Aggregating in SQL
 * (`GROUP BY sleeper_id` with `max(sf_value)`, `max(oneqb_value)`) would answer
 * identically; what it would not be is checkable by `npm test`, and the rows a
 * duplicate adds to the wire are a handful out of a board of ~500.
 */

/** One player's value on both of KTC's boards; null where KTC prices neither. */
export type KtcValue = { sf: number | null; oneqb: number | null };

/** A `ktc_values` row as the read selects it, whatever else the table holds. */
export type KtcValueRow = {
  sleeper_id: string;
  sf_value: number | null;
  oneqb_value: number | null;
  updated_at: Date;
};

export type KtcValueSet = {
  /**
   * Sleeper player id → both board values. An id KTC doesn't price is absent
   * rather than zeroed — a kicker is off the board entirely, which is a
   * different claim from being worth nothing.
   */
  values: Record<string, KtcValue>;
  /**
   * When the rows behind those values were scraped, ISO 8601; null when none
   * matched. These are someone else's numbers on a fifteen-minute cache, so
   * anything showing them should be able to say how old they are — the same
   * reason `/api/projections` sends its own `updated_at`.
   */
  updated_at: string | null;
};

/**
 * The higher of two prices on one board, treating null as "this row says
 * nothing" rather than as zero.
 *
 * Null is not a low value, it is the absence of one: a row whose player fell off
 * KTC's board is nulled by the reconciliation rather than deleted, so a pair can
 * legitimately be `null` and `6000` — and `max` over that has to be 6000 and not
 * null. Both null stays null, which is what keeps a player KTC prices on neither
 * board out of the map entirely rather than in it as a pair of zeroes.
 *
 * This is also where SQL's `max()` and a hand-rolled comparison agree: the
 * aggregate ignores nulls and answers null only for an all-null group, which is
 * exactly the fallback the callers already assume.
 */
function higher(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Fold `ktc_values` rows into one value per Sleeper id, per board.
 *
 * Rows may arrive in any order and there may be any number per id; the answer
 * does not depend on either, which is the property the ordered `DISTINCT ON` it
 * replaced could not have.
 *
 * An id whose rows price *neither* board stays in the map carrying two nulls,
 * which is what the read it replaced did: KTC knows the player and has him
 * priced nowhere — the state its reconciliation writes when someone falls off the
 * board — which is a different fact from an id KTC has never heard of, and every
 * caller resolves both to "no price" through `ktcBoardValue` anyway.
 */
export function foldKtcValues(rows: readonly KtcValueRow[]): KtcValueSet {
  const values: Record<string, KtcValue> = {};
  let newest: Date | null = null;

  for (const row of rows) {
    const current = values[row.sleeper_id];
    values[row.sleeper_id] = {
      sf: higher(current?.sf ?? null, row.sf_value),
      oneqb: higher(current?.oneqb ?? null, row.oneqb_value),
    };
    // The sync upserts the board and nulls what fell off it, all in one
    // transaction, so every row it touched carries the same stamp; taking the
    // newest keeps that from being something to rely on.
    if (!newest || row.updated_at > newest) newest = row.updated_at;
  }

  return { values, updated_at: newest?.toISOString() ?? null };
}

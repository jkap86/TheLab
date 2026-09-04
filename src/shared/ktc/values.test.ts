import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { foldKtcValues, type KtcValueRow } from "./values.ts";

/**
 * Two KTC rows mapped to one Sleeper player, resolved per board.
 *
 * The regression these are written against: the read used to be
 * `DISTINCT ON (sleeper_id) … ORDER BY sf_value DESC`, so *both* numbers came off
 * whichever row won on superflex. A player carrying `(sf 9000, 1QB 5000)` and
 * `(sf 8000, 1QB 7000)` was priced at 5000 on the 1QB board with 7000 on file —
 * a real number from a real row, which is why nothing downstream could tell, and
 * wrong only for the handful of one-QB leagues that are already the ones a
 * default misprices.
 *
 * Null is the other half. A row whose player fell off KTC's board is *nulled*
 * rather than deleted, so a pair can legitimately be `null` and a price — and
 * `max` there has to be the price. That is also the semantics SQL's own `max()`
 * has, which is what lets the read stay a plain select without the two spellings
 * disagreeing.
 */

const SCRAPED = new Date("2026-08-09T12:00:00.000Z");

/** A `ktc_values` row, named only by what the fold reads. */
function row(
  sleeperId: string,
  sf: number | null,
  oneqb: number | null,
  updatedAt: Date = SCRAPED,
): KtcValueRow {
  return {
    sleeper_id: sleeperId,
    sf_value: sf,
    oneqb_value: oneqb,
    updated_at: updatedAt,
  };
}

describe("foldKtcValues", () => {
  test("takes each board's maximum independently", () => {
    // The case in the bug report: the SF winner is row A and the 1QB winner is
    // row B, so neither row is the answer.
    const { values } = foldKtcValues([
      row("4034", 9000, 5000),
      row("4034", 8000, 7000),
    ]);
    assert.deepEqual(values["4034"], { sf: 9000, oneqb: 7000 });
  });

  test("does not depend on the order the rows arrive in", () => {
    // What an ordered `DISTINCT ON` could never promise, and the property that
    // makes the read's `ORDER BY` a plan detail rather than a correctness one.
    const rows = [row("4034", 9000, 5000), row("4034", 8000, 7000)];
    assert.deepEqual(
      foldKtcValues(rows).values,
      foldKtcValues([...rows].reverse()).values,
    );
  });

  test("keeps one row's pair where that row is highest on both boards", () => {
    const { values } = foldKtcValues([
      row("4034", 9000, 7000),
      row("4034", 8000, 5000),
    ]);
    assert.deepEqual(values["4034"], { sf: 9000, oneqb: 7000 });
  });

  test("prefers a price over a null on each board separately", () => {
    // A nulled row is a player KTC dropped, not a player worth nothing, so it
    // must not win a board against a row that still carries a number.
    assert.deepEqual(
      foldKtcValues([row("4034", null, 4200), row("4034", 8800, null)]).values[
        "4034"
      ],
      { sf: 8800, oneqb: 4200 },
    );
  });

  test("a partly populated duplicate does not pull the other board down", () => {
    // The shape that broke: the SF-only row wins the `ORDER BY` and takes its own
    // null 1QB value with it, blanking a board the other row prices.
    assert.deepEqual(
      foldKtcValues([row("4034", 9000, null), row("4034", 8000, 7000)]).values[
        "4034"
      ],
      { sf: 9000, oneqb: 7000 },
    );
    assert.deepEqual(
      foldKtcValues([row("4034", null, 7000), row("4034", 8000, 5000)]).values[
        "4034"
      ],
      { sf: 8000, oneqb: 7000 },
    );
  });

  test("carries a null SF board through beside a valid 1QB value", () => {
    // A single mapping is passed through, not filled in: KTC prices some players
    // on one board only, and a zero there would be a claim it never made.
    assert.deepEqual(foldKtcValues([row("4034", null, 5000)]).values["4034"], {
      sf: null,
      oneqb: 5000,
    });
  });

  test("carries a null 1QB board through beside a valid SF value", () => {
    assert.deepEqual(foldKtcValues([row("4034", 9000, null)]).values["4034"], {
      sf: 9000,
      oneqb: null,
    });
  });

  test("leaves a player priced on neither board carrying two nulls", () => {
    // What the read it replaced did, and the honest reading: KTC knows this
    // player and prices him nowhere, which is a different fact from an id KTC has
    // never heard of. Both resolve to "no price" through `ktcBoardValue`.
    assert.deepEqual(foldKtcValues([row("4034", null, null)]).values["4034"], {
      sf: null,
      oneqb: null,
    });
  });

  test("passes a single mapping straight through", () => {
    const { values } = foldKtcValues([
      row("4034", 9000, 5000),
      row("6794", 6100, 6800),
    ]);
    assert.deepEqual(values, {
      "4034": { sf: 9000, oneqb: 5000 },
      "6794": { sf: 6100, oneqb: 6800 },
    });
  });

  test("merges only within a player", () => {
    // The obvious way to break a fold: a `max` that reaches across ids.
    const { values } = foldKtcValues([
      row("4034", 9000, 5000),
      row("6794", 100, 200),
      row("4034", 8000, 7000),
    ]);
    assert.deepEqual(values["4034"], { sf: 9000, oneqb: 7000 });
    assert.deepEqual(values["6794"], { sf: 100, oneqb: 200 });
  });

  test("resolves more than two duplicates", () => {
    const { values } = foldKtcValues([
      row("4034", 100, 900),
      row("4034", 500, 100),
      row("4034", 300, null),
      row("4034", null, 400),
    ]);
    assert.deepEqual(values["4034"], { sf: 500, oneqb: 900 });
  });

  test("reports the newest scrape across every row it read", () => {
    const older = new Date("2026-08-08T12:00:00.000Z");
    const newer = new Date("2026-08-09T12:00:00.000Z");
    const { updated_at } = foldKtcValues([
      row("4034", 9000, 5000, older),
      row("4034", 8000, 7000, newer),
    ]);
    assert.equal(updated_at, newer.toISOString());
  });

  test("counts a wholly unpriced row's timestamp as evidence of a scrape", () => {
    // It is still a row the sync touched — the point of the stamp is how old the
    // answer is, not whether the answer has a number in it.
    const newer = new Date("2026-08-09T12:00:00.000Z");
    const { updated_at } = foldKtcValues([
      row("4034", 9000, 5000, new Date("2026-08-01T00:00:00.000Z")),
      row("6794", null, null, newer),
    ]);
    assert.equal(updated_at, newer.toISOString());
  });

  test("answers empty for no rows", () => {
    assert.deepEqual(foldKtcValues([]), { values: {}, updated_at: null });
  });
});

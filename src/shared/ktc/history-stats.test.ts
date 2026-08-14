import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { foldKtcSfHistory } from "./history-stats.ts";

const row = (
  sleeper_id: string,
  peak_sf: number | null,
  asof_sf: number | null,
  prior_sf: number | null,
) => ({ sleeper_id, peak_sf, asof_sf, prior_sf });

describe("foldKtcSfHistory", () => {
  test("a single row reads straight through", () => {
    assert.deepEqual(foldKtcSfHistory([row("100", 8000, 7000, 6500)]), {
      "100": { peak: 8000, trend: 500 },
    });
  });

  test("a falling value is a negative trend, not a refusal", () => {
    assert.deepEqual(foldKtcSfHistory([row("100", 8000, 6000, 7000)])["100"], {
      peak: 8000,
      trend: -1000,
    });
  });

  test("no earlier endpoint means no trend — never a delta from zero", () => {
    assert.deepEqual(foldKtcSfHistory([row("100", 7000, 7000, null)])["100"], {
      peak: 7000,
      trend: null,
    });
  });

  test("peak survives without a current price — a fallen-off player keeps his career high", () => {
    assert.deepEqual(foldKtcSfHistory([row("100", 9000, null, null)])["100"], {
      peak: 9000,
      trend: null,
    });
  });

  test("duplicate entries: peak is the max across rows, whatever the order", () => {
    const a = row("100", 9000, null, null);
    const b = row("100", 8000, 8000, 7500);
    assert.equal(foldKtcSfHistory([a, b])["100"].peak, 9000);
    assert.equal(foldKtcSfHistory([b, a])["100"].peak, 9000);
  });

  test("duplicate entries: the trend is the winning row's, never a crossed pair", () => {
    // Row A holds the higher as-of value but no earlier endpoint; row B has a
    // complete pair. A crossed read would answer 8000 − 7500 — a move between
    // two different entries' series that nothing recorded. The honest answer is
    // the winning row's null.
    const a = row("100", 8000, 8000, null);
    const b = row("100", 8000, 7000, 7500);
    assert.equal(foldKtcSfHistory([a, b])["100"].trend, null);
    assert.equal(foldKtcSfHistory([b, a])["100"].trend, null);
    // And when the winner has its pair, the loser's endpoints don't leak in.
    const c = row("100", 8000, 8000, 7000);
    assert.equal(foldKtcSfHistory([c, b])["100"].trend, 1000);
    assert.equal(foldKtcSfHistory([b, c])["100"].trend, 1000);
  });

  test("a tied as-of value breaks on the earlier endpoint, whatever the order", () => {
    const a = row("100", 8000, 8000, 7000);
    const b = row("100", 8000, 8000, null);
    assert.equal(foldKtcSfHistory([a, b])["100"].trend, 1000);
    assert.equal(foldKtcSfHistory([b, a])["100"].trend, 1000);
  });

  test("independent players don't mix", () => {
    const folded = foldKtcSfHistory([
      row("100", 8000, 7000, 6000),
      row("200", 3000, 2500, 2600),
    ]);
    assert.deepEqual(folded["100"], { peak: 8000, trend: 1000 });
    assert.deepEqual(folded["200"], { peak: 3000, trend: -100 });
  });

  test("no rows is an empty map", () => {
    assert.deepEqual(foldKtcSfHistory([]), {});
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCompsFilters } from "./filters.ts";

const parse = (query: string) => parseCompsFilters(new URLSearchParams(query));

const ok = (query: string) => {
  const parsed = parse(query);
  assert.ok(parsed.ok, !parsed.ok ? parsed.error : undefined);
  return parsed.filters;
};

const fail = (query: string) => {
  const parsed = parse(query);
  assert.ok(!parsed.ok, "expected a parse failure");
  return parsed.error;
};

describe("parseCompsFilters", () => {
  test("the defaults path: player alone, everything else defaulted", () => {
    const filters = ok("player_id=4034");
    assert.deepEqual(filters, {
      player_id: "4034",
      season: null,
      basis: "per_game",
      fields: null,
      k: 10,
      min_games: 4,
      positions: null,
    });
  });

  test("the explicit path parses every knob", () => {
    const filters = ok(
      "player_id=4034&season=2025&basis=total&fields=rec,rec_yd,age&weights=100,80,50&k=5&min_games=8&positions=WR,TE",
    );
    assert.equal(filters.season, "2025");
    assert.equal(filters.basis, "total");
    assert.deepEqual(filters.fields, [
      { key: "rec", weight: 100 },
      { key: "rec_yd", weight: 80 },
      { key: "age", weight: 50 },
    ]);
    assert.equal(filters.k, 5);
    assert.equal(filters.min_games, 8);
    assert.deepEqual(filters.positions, ["WR", "TE"]);
  });

  test("player_id is required and shape-checked", () => {
    assert.match(fail(""), /player_id/);
    assert.match(fail("player_id=%20"), /player_id/);
    assert.match(fail(`player_id=${"9".repeat(65)}`), /player_id/);
  });

  test("season and basis refuse junk by name", () => {
    assert.match(fail("player_id=1&season=20256"), /season/);
    assert.match(fail("player_id=1&basis=weekly"), /basis/);
  });

  test("an unknown field is a named 400, never a silent skip", () => {
    assert.match(fail("player_id=1&fields=rec,off_snp"), /off_snp/);
  });

  test("a duplicate field is rejected — it would double its own weight", () => {
    assert.match(fail("player_id=1&fields=rec,rec&weights=100,50"), /Duplicate field: rec/);
  });

  test("weights keep their length — the shared list() would dedupe 100,50,100", () => {
    // Three fields, three weights, two of them equal: the desync this module's
    // local split exists to prevent.
    const filters = ok(
      "player_id=1&fields=rec,rec_yd,rec_tgt&weights=100,50,100",
    );
    assert.deepEqual(filters.fields, [
      { key: "rec", weight: 100 },
      { key: "rec_yd", weight: 50 },
      { key: "rec_tgt", weight: 100 },
    ]);
  });

  test("a length mismatch is a named 400", () => {
    assert.match(fail("player_id=1&fields=rec,rec_yd&weights=100"), /2 fields.*1/);
  });

  test("weights are bounded integers", () => {
    assert.match(fail("player_id=1&fields=rec&weights=101"), /rec/);
    assert.match(fail("player_id=1&fields=rec&weights=-1"), /rec/);
    assert.match(fail("player_id=1&fields=rec&weights=1.5"), /rec/);
    assert.match(fail("player_id=1&fields=rec&weights=lots"), /rec/);
  });

  test("absent weights mean equal weights, not a mismatch", () => {
    const filters = ok("player_id=1&fields=rec,age");
    assert.deepEqual(filters.fields, [
      { key: "rec", weight: 100 },
      { key: "age", weight: 100 },
    ]);
  });

  test("weights without fields name nothing", () => {
    assert.match(fail("player_id=1&weights=100"), /weights/);
  });

  test("a zero weight drops its field; all zeroes refuse", () => {
    const filters = ok("player_id=1&fields=rec,rec_yd&weights=100,0");
    assert.deepEqual(filters.fields, [{ key: "rec", weight: 100 }]);
    assert.match(fail("player_id=1&fields=rec,rec_yd&weights=0,0"), /0/);
  });

  test("k and min_games are bounded with defaults", () => {
    assert.equal(ok("player_id=1&k=50").k, 50);
    assert.match(fail("player_id=1&k=51"), /k/);
    assert.match(fail("player_id=1&k=0"), /k/);
    assert.match(fail("player_id=1&min_games=19"), /min_games/);
  });

  test("positions are upper-cased, deduplicated and validated by name", () => {
    assert.deepEqual(ok("player_id=1&positions=wr,WR,te").positions, [
      "WR",
      "TE",
    ]);
    assert.match(fail("player_id=1&positions=BANANA"), /BANANA/);
    assert.match(fail("player_id=1&positions=K"), /positions/);
  });
});

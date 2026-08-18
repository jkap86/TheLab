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
      { key: "rec", weight: 100, window: "season" },
      { key: "rec_yd", weight: 80, window: "season" },
      { key: "age", weight: 50, window: "season" },
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
    assert.match(fail("player_id=1&fields=rec,kick_ret_yd"), /kick_ret_yd/);
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
      { key: "rec", weight: 100, window: "season" },
      { key: "rec_yd", weight: 50, window: "season" },
      { key: "rec_tgt", weight: 100, window: "season" },
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
      { key: "rec", weight: 100, window: "season" },
      { key: "age", weight: 100, window: "season" },
    ]);
  });

  test("weights without fields name nothing", () => {
    assert.match(fail("player_id=1&weights=100"), /weights/);
    assert.match(fail("player_id=1&windows=prev3"), /windows/);
  });

  test("absent windows mean every field over its own season", () => {
    // What an old bookmark and the shortest curl both still mean — the wire
    // grew a third parallel list without any existing spelling changing.
    const filters = ok("player_id=1&fields=rec_tgt,age&weights=100,50");
    assert.deepEqual(
      filters.fields?.map((f) => f.window),
      ["season", "season"],
    );
  });

  test("windows parse as a third parallel list, positionally", () => {
    const filters = ok(
      "player_id=1&fields=rec_tgt,rec_yd,age&weights=100,80,50&windows=prev3,career_best,season",
    );
    assert.deepEqual(filters.fields, [
      { key: "rec_tgt", weight: 100, window: "prev3" },
      { key: "rec_yd", weight: 80, window: "career_best" },
      { key: "age", weight: 50, window: "season" },
    ]);
  });

  test("a windows list of the wrong length is a mismatch, never a truncation", () => {
    assert.match(
      fail("player_id=1&fields=rec,rec_yd&weights=100,80&windows=prev3"),
      /2 fields.*1/,
    );
  });

  test("an unknown window is refused by name", () => {
    assert.match(
      fail("player_id=1&fields=rec&weights=100&windows=last_year"),
      /last_year/,
    );
  });

  test("a window on a field that takes none is refused, never ignored", () => {
    // Pooling two seasons of KTC is a number nobody has a name for, and a
    // silently-ignored parameter is a board that quietly isn't the one asked
    // for.
    assert.match(
      fail("player_id=1&fields=ktc_sf&weights=100&windows=prev3"),
      /ktc_sf/,
    );
    // The same field under its own season is fine — it is the window that is
    // refused, not the field.
    assert.ok(ok("player_id=1&fields=ktc_sf&weights=100&windows=season"));
  });

  test("a zero weight drops its field; all zeroes refuse", () => {
    const filters = ok("player_id=1&fields=rec,rec_yd&weights=100,0");
    assert.deepEqual(filters.fields, [
      { key: "rec", weight: 100, window: "season" },
    ]);
    assert.match(fail("player_id=1&fields=rec,rec_yd&weights=0,0"), /0/);
  });

  test("an absent fields= is the defaults; a present-but-empty one is not", () => {
    // The distinction this whole branch exists for. A caller that never
    // mentions the board gets the position's defaults; one that spells
    // `fields=` and names nothing has described an empty comparison, which is
    // invalid — answering it with the defaults is the editor saying nothing is
    // being compared while the server computes the ordinary board.
    assert.equal(ok("player_id=1").fields, null);
    assert.match(fail("player_id=1&fields="), /nothing to compare/);
    assert.match(fail("player_id=1&fields=&weights="), /nothing to compare/);
    // The client's own spelling of a board with every field removed.
    const emptied = new URLSearchParams();
    emptied.set("player_id", "1");
    emptied.set("fields", "");
    emptied.set("weights", "");
    assert.ok(!parseCompsFilters(emptied).ok);
  });

  test("a whitespace or comma-only fields= is empty too, never defaults", () => {
    // `rawList` trims and drops blanks, so these reach the same place as
    // `fields=` — and must be refused there rather than falling through.
    assert.match(fail("player_id=1&fields=%20"), /nothing to compare/);
    assert.match(fail("player_id=1&fields=,,"), /nothing to compare/);
  });

  test("all-zero weights refuse rather than resolving to the default board", () => {
    // Two spellings of "nothing is being compared", and neither may become the
    // position's defaults: one names fields and switches them all off, the
    // other names none at all.
    assert.match(fail("player_id=1&fields=rec&weights=0"), /0/);
    assert.match(
      fail("player_id=1&fields=rec,rec_yd,age&weights=0,0,0"),
      /0/,
    );
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

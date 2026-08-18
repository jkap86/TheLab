import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCompsFilters } from "../../shared/comps/filters.ts";
import { buildCompsQuery } from "./build-query.ts";
import { defaultWeightBoard } from "./prefs.ts";

import type { CompsSelection } from "./build-query.ts";

const selection = (over: Partial<CompsSelection> = {}): CompsSelection => ({
  playerId: "4034",
  season: null,
  basis: "per_game",
  position: "WR",
  weights: null,
  ...over,
});

describe("buildCompsQuery", () => {
  test("every default is omitted — the bare board is the shortest spelling", () => {
    assert.equal(buildCompsQuery(selection()), "player_id=4034");
  });

  test("non-defaults spell out", () => {
    const query = buildCompsQuery(
      selection({ season: "2024", basis: "total", k: 5, minGames: 8 }),
    );
    const params = new URLSearchParams(query);
    assert.equal(params.get("season"), "2024");
    assert.equal(params.get("basis"), "total");
    assert.equal(params.get("k"), "5");
    assert.equal(params.get("min_games"), "8");
  });

  test("weights matching the position's defaults fold back to no fields=", () => {
    // A reader who tuned a board and put every weight back by hand lands on
    // the same cache entry as one who never opened the editor.
    const query = buildCompsQuery(
      selection({ weights: defaultWeightBoard("WR") }),
    );
    assert.equal(query, "player_id=4034");
  });

  test("customized weights travel as parallel lists, zeroes dropped", () => {
    const weights = { ...defaultWeightBoard("WR"), rec: 0, ktc_sf: 40 };
    const query = buildCompsQuery(selection({ weights }));
    const params = new URLSearchParams(query);
    const fields = params.get("fields")!.split(",");
    const values = params.get("weights")!.split(",");
    assert.equal(fields.length, values.length);
    assert.ok(!fields.includes("rec"));
    assert.equal(values[fields.indexOf("ktc_sf")], "40");
  });

  test("an all-zero board spells an explicit empty fields=, never no fields=", () => {
    // The whole point: omitting the parameter is how "I named no board" is
    // spelled, and the server answers that with the position's defaults. A
    // board the reader emptied is a *different* statement and has to reach the
    // wire as one — which the parser then refuses, rather than quietly running
    // the ordinary comparison under a panel saying nothing is being compared.
    const zeroed = Object.fromEntries(
      Object.keys(defaultWeightBoard("WR")).map((key) => [key, 0]),
    );
    const params = new URLSearchParams(buildCompsQuery(selection({ weights: zeroed })));
    assert.ok(params.has("fields"), "fields= travels");
    assert.equal(params.get("fields"), "");
    assert.equal(params.get("weights"), "");

    // And it is refused rather than defaulted, end to end.
    const parsed = parseCompsFilters(params);
    assert.ok(!parsed.ok, "an emptied board is not a request the server honours");
  });

  test("a board with one field left still travels as that one field", () => {
    // The state the editor holds the reader at: removing down to the last field
    // is a legitimate, explicit, single-dimension comparison.
    const one = {
      ...Object.fromEntries(
        Object.keys(defaultWeightBoard("WR")).map((key) => [key, 0]),
      ),
      rec_tgt: 100,
    };
    const params = new URLSearchParams(buildCompsQuery(selection({ weights: one })));
    assert.equal(params.get("fields"), "rec_tgt");
    assert.equal(params.get("weights"), "100");
    const parsed = parseCompsFilters(params);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.filters.fields, [
      { key: "rec_tgt", weight: 100, window: "season" },
    ]);
  });

  test("the same board for another position is not the defaults", () => {
    // A WR default board under a QB subject must spell out — QB defaults are
    // different fields.
    const query = buildCompsQuery(
      selection({ position: "QB", weights: defaultWeightBoard("WR") }),
    );
    assert.ok(new URLSearchParams(query).get("fields"));
  });
});

describe("buildCompsQuery windows", () => {
  test("all-default windows send no windows= at all", () => {
    // A third parallel list full of "season" would only lengthen the cache key
    // for a board the server would read identically without it.
    const query = buildCompsQuery(
      selection({
        weights: { ...defaultWeightBoard("WR"), rec: 0 },
        windows: { rec_tgt: "season" },
      }),
    );
    assert.equal(new URLSearchParams(query).get("windows"), null);
  });

  test("windows travel positionally, aligned with the fields they belong to", () => {
    const query = buildCompsQuery(
      selection({
        weights: { ...defaultWeightBoard("WR") },
        windows: { rec_tgt: "prev3", rec_yd: "career_best" },
      }),
    );
    const params = new URLSearchParams(query);
    const fields = params.get("fields")!.split(",");
    const windows = params.get("windows")!.split(",");
    assert.equal(fields.length, windows.length);
    assert.equal(windows[fields.indexOf("rec_tgt")], "prev3");
    assert.equal(windows[fields.indexOf("rec_yd")], "career_best");
    assert.equal(windows[fields.indexOf("rec")], "season");
  });

  test("a window on a weighted field makes an otherwise-default board explicit", () => {
    // The board's *weights* are the position's defaults, so without this it
    // would fold back to no fields= and the window would be silently dropped.
    const query = buildCompsQuery(
      selection({
        weights: defaultWeightBoard("WR"),
        windows: { rec_tgt: "prev3" },
      }),
    );
    assert.ok(new URLSearchParams(query).get("fields"));
    assert.ok(new URLSearchParams(query).get("windows"));
  });

  test("a window on an unweighted field changes nothing and never travels", () => {
    // It computes no number, so it is not a customized board — the same rule
    // the prefs codec keeps when it declines to store a default.
    const query = buildCompsQuery(
      selection({
        weights: defaultWeightBoard("WR"),
        // `fum_lost` carries no default weight for a receiver.
        windows: { fum_lost: "career_best" },
      }),
    );
    assert.equal(query, "player_id=4034");
  });
});

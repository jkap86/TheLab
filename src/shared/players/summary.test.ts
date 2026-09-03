import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toPlayerSummary } from "./summary.ts";
import type { PlayerNameRow } from "./summary.ts";

/**
 * The name fallback, which is the whole reason this is a module rather than a
 * line inside the query that reads it: written twice it is two fallbacks, and a
 * player showing as an id on one surface and as a blank on another is a
 * difference nothing else in the repo would fail on.
 */

const row = (over: Partial<PlayerNameRow> = {}): PlayerNameRow => ({
  player_id: "4046",
  full_name: null,
  first_name: null,
  last_name: null,
  position: null,
  team: null,
  ...over,
});

describe("toPlayerSummary", () => {
  test("prefers Sleeper's own full name", () => {
    const summary = toPlayerSummary(
      row({ full_name: "Patrick Mahomes", first_name: "Pat", last_name: "M" }),
    );
    assert.equal(summary.name, "Patrick Mahomes");
  });

  test("joins the halves when there is no full name", () => {
    assert.equal(
      toPlayerSummary(row({ first_name: "Patrick", last_name: "Mahomes" })).name,
      "Patrick Mahomes",
    );
  });

  test("uses whichever half exists", () => {
    assert.equal(toPlayerSummary(row({ last_name: "Mahomes" })).name, "Mahomes");
    assert.equal(toPlayerSummary(row({ first_name: "Patrick" })).name, "Patrick");
  });

  test("falls back to the id rather than to an empty cell", () => {
    // A searchable token beats a blank: it is what a reader can act on when the
    // players cache is behind Sleeper's map.
    assert.equal(toPlayerSummary(row()).name, "4046");
  });

  test("carries position and team through unchanged, nulls included", () => {
    assert.deepEqual(toPlayerSummary(row({ position: "QB", team: "KC" })), {
      player_id: "4046",
      name: "4046",
      position: "QB",
      team: "KC",
    });
    const free = toPlayerSummary(row({ full_name: "Someone", position: "WR" }));
    assert.equal(free.team, null);
  });
});

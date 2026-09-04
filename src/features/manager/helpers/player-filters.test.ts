import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeFilterCount,
  facetCounts,
  keepsPlayer,
  NO_PLAYER_FILTERS,
  playerFilterBounds,
  playerFilterSummary,
  spanActive,
  toggleFacet,
  UNKNOWN_VALUE,
} from "./player-filters.ts";
import type { PlayerShare } from "./shares.ts";

function player(over: Partial<PlayerShare> = {}): PlayerShare {
  return {
    player_id: "1",
    name: "A Player",
    position: "RB",
    team: "BAL",
    age: 25,
    draft_class: 2023,
    ktc_value: 5000,
    leagues: [],
    ...over,
  };
}

const AGE = { lo: 22, hi: 34 };
const CLASS = { lo: 2014, hi: 2026 };

test("bounds come off the population, and a single value is no range", () => {
  const rows = [player({ age: 24 }), player({ age: 31 }), player({ age: null })];
  assert.deepEqual(
    playerFilterBounds(rows, (p) => p.age),
    { lo: 24, hi: 31 },
  );
  assert.equal(
    playerFilterBounds([player({ age: 24 })], (p) => p.age),
    null,
  );
  assert.equal(
    playerFilterBounds([player({ age: null })], (p) => p.age),
    null,
  );
});

test("a span sitting on both bounds is not a filter", () => {
  assert.equal(spanActive({ lo: 22, hi: 34 }, AGE), false);
  assert.equal(spanActive({ lo: 23, hi: 34 }, AGE), true);
  assert.equal(spanActive(null, AGE), false);
  // A facet with no bounds has nothing to be narrower than.
  assert.equal(spanActive({ lo: 23, hi: 34 }, null), false);
});

test("the badge counts facets, not values", () => {
  assert.equal(activeFilterCount(NO_PLAYER_FILTERS, AGE, CLASS), 0);
  assert.equal(
    activeFilterCount(
      {
        positions: ["RB", "WR"],
        teams: ["BAL"],
        age: { lo: 23, hi: 26 },
        draftClass: null,
      },
      AGE,
      CLASS,
    ),
    3,
  );
  // A full-width span is not asked, so it does not light the key.
  assert.equal(
    activeFilterCount({ ...NO_PLAYER_FILTERS, age: { lo: 22, hi: 34 } }, AGE, CLASS),
    0,
  );
});

test("within a facet OR, across facets AND", () => {
  const f = { positions: ["RB", "WR"], teams: ["BAL"], age: null, draftClass: null };
  assert.equal(keepsPlayer(player({ position: "WR", team: "BAL" }), f, AGE, CLASS), true);
  assert.equal(keepsPlayer(player({ position: "TE", team: "BAL" }), f, AGE, CLASS), false);
  assert.equal(keepsPlayer(player({ position: "RB", team: "KC" }), f, AGE, CLASS), false);
});

test("an empty facet excludes nobody", () => {
  // Not "everything chosen": a value that appears in the population after the
  // reader last touched the facet must not drop off the list.
  assert.equal(
    keepsPlayer(player({ position: "LB", team: null }), NO_PLAYER_FILTERS, AGE, CLASS),
    true,
  );
});

test("an unknown age is outside every span, not inside the young end", () => {
  const f = { ...NO_PLAYER_FILTERS, age: { lo: 22, hi: 25 } };
  assert.equal(keepsPlayer(player({ age: 24 }), f, AGE, CLASS), true);
  assert.equal(keepsPlayer(player({ age: 30 }), f, AGE, CLASS), false);
  assert.equal(keepsPlayer(player({ age: null }), f, AGE, CLASS), false);
  // …but an untouched span excludes nobody, absent ages included.
  assert.equal(keepsPlayer(player({ age: null }), NO_PLAYER_FILTERS, AGE, CLASS), true);
  // …and neither does one dragged out to both bounds again.
  assert.equal(
    keepsPlayer(player({ age: null }), { ...NO_PLAYER_FILTERS, age: AGE }, AGE, CLASS),
    true,
  );
});

test("an unknown draft class is outside every span too", () => {
  const f = { ...NO_PLAYER_FILTERS, draftClass: { lo: 2022, hi: 2026 } };
  assert.equal(keepsPlayer(player({ draft_class: 2023 }), f, AGE, CLASS), true);
  assert.equal(keepsPlayer(player({ draft_class: 2018 }), f, AGE, CLASS), false);
  assert.equal(keepsPlayer(player({ draft_class: null }), f, AGE, CLASS), false);
});

test("a missing position and a missing team fold to one bucket", () => {
  const counts = facetCounts(
    [player({ position: null }), player({ position: "RB" })],
    (p) => p.position,
  );
  assert.equal(counts.get(UNKNOWN_VALUE), 1);
  assert.equal(counts.get("RB"), 1);
  // The chip that bucket draws is a chip that matches it, in either facet.
  const f = { ...NO_PLAYER_FILTERS, teams: [UNKNOWN_VALUE] };
  assert.equal(keepsPlayer(player({ team: null }), f, AGE, CLASS), true);
  assert.equal(keepsPlayer(player({ team: "BAL" }), f, AGE, CLASS), false);
});

test("toggling a facet adds then removes", () => {
  assert.deepEqual(toggleFacet([], "RB"), ["RB"]);
  assert.deepEqual(toggleFacet(["RB", "WR"], "RB"), ["WR"]);
});

test("the summary names only what is narrowing", () => {
  assert.equal(playerFilterSummary(NO_PLAYER_FILTERS, AGE, CLASS), null);
  assert.equal(
    playerFilterSummary(
      { positions: ["RB"], teams: [], age: { lo: 22, hi: 25 }, draftClass: null },
      AGE,
      CLASS,
    ),
    "RB · Age 22–25",
  );
  // A span sitting on its bounds is not narrowing, so it says nothing.
  assert.equal(
    playerFilterSummary({ ...NO_PLAYER_FILTERS, age: AGE }, AGE, CLASS),
    null,
  );
});

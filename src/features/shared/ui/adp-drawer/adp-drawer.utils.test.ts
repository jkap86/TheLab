import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";
import type { AdpBoardStats } from "@/shared/manager";

import { defaultAdpControls, seedFromLeague } from "../../adp-controls.ts";
import { FIXED_FILTERS } from "./adp-drawer.constants.ts";
import {
  adpCellTitle,
  boardTitle,
  leagueSizeFilter,
  narrowingFilters,
  soleBoardOf,
  takenShare,
  takenTitle,
  valueTitle,
  withBoardToggle,
  withSeason,
  withSeededLeague,
} from "./adp-drawer.utils.ts";

const controls = defaultAdpControls("2026");

const league = (id: string, teams: number): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2025",
  status: "in_season",
  total_rosters: teams,
  avatar: null,
  record: null,
  settings: { type: 2, best_ball: 1 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"],
  scoring_settings: { rec: 0.5 },
});

const stats = (over: Partial<AdpBoardStats> = {}): AdpBoardStats => ({
  picks: 46,
  adp: 3.2,
  min_pick: 1,
  max_pick: 12,
  stdev: 2.35,
  ...over,
});

describe("the filter table", () => {
  test("every fixed filter reads and writes its own field", () => {
    const written = FIXED_FILTERS.map((f) => f.set(controls, f.options[1].value));
    // Each write lands on exactly one field, and reads back through the same
    // accessor — the whole point of `get`/`set` over a computed key.
    for (const [i, next] of written.entries()) {
      const spec = FIXED_FILTERS[i];
      assert.equal(spec.get(next), spec.options[1].value);
      const untouched = FIXED_FILTERS.filter((f) => f.key !== spec.key);
      for (const other of untouched) assert.equal(other.get(next), "all");
    }
  });

  test("the fixed filters are the six the drawer has always had", () => {
    assert.deepEqual(
      FIXED_FILTERS.map((f) => f.key),
      ["rounds", "scoring", "superflex", "bestBall"],
    );
    // The vocabulary the route parses — a value dropped here is a filter that
    // silently stops narrowing rather than a type error.
    assert.deepEqual(
      FIXED_FILTERS.map((f) => f.options.map((o) => o.value)),
      [
        ["all", "full", "rookie"],
        ["all", "std", "half_ppr", "ppr"],
        ["all", "yes", "no"],
        ["all", "no", "yes"],
      ],
    );
  });

  test("changing one filter leaves the rest of the controls alone", () => {
    const scoring = FIXED_FILTERS.find((f) => f.key === "scoring");
    assert.ok(scoring);
    const next = scoring.set({ ...controls, teams: "12" }, "ppr");
    assert.equal(next.scoring, "ppr");
    assert.equal(next.teams, "12");
    assert.equal(next.season, controls.season);
    assert.deepEqual(next.range, controls.range);
    assert.equal(next.steepness, controls.steepness);
  });

  test("the size options are the sizes the population actually holds", () => {
    const spec = leagueSizeFilter([league("a", 12), league("b", 10), league("c", 12)]);
    assert.deepEqual(spec.options, [
      { value: "all", label: "All sizes" },
      { value: "10", label: "10 teams" },
      { value: "12", label: "12 teams" },
    ]);
    assert.equal(spec.set(controls, "10").teams, "10");
  });

  test("an empty population still offers 'all', and nothing else", () => {
    assert.deepEqual(leagueSizeFilter([]).options, [
      { value: "all", label: "All sizes" },
    ]);
  });

  test("narrowing is everything that isn't 'all'", () => {
    const filters = [...FIXED_FILTERS, leagueSizeFilter([league("a", 12)])];
    assert.deepEqual(narrowingFilters(filters, controls), []);
    const narrowed = { ...controls, scoring: "ppr" as const, teams: "12" };
    assert.deepEqual(
      narrowingFilters(filters, narrowed).map((f) => f.key),
      ["scoring", "teams"],
    );
  });
});

describe("the control writes", () => {
  test("a season change drops the window with it", () => {
    const narrowed = {
      ...controls,
      season: "2026",
      range: { preset: "30d" as const, from: null, to: null },
    };
    const next = withSeason(narrowed, "2024");
    assert.equal(next.season, "2024");
    // A date range is a cut *inside* a season, so the same dates against
    // another one are a window that mostly isn't there.
    assert.deepEqual(next.range, { preset: "all", from: null, to: null });
  });

  test("a season change touches nothing else", () => {
    const next = withSeason({ ...controls, scoring: "ppr", teams: "10" }, "2025");
    assert.equal(next.scoring, "ppr");
    assert.equal(next.teams, "10");
    assert.equal(next.boards, controls.boards);
  });

  test("the board toggle keeps the last lit board on", () => {
    assert.equal(withBoardToggle(controls, "redraft").boards, "dynasty");
    assert.equal(withBoardToggle(controls, "dynasty").boards, "redraft");
    const sole = { ...controls, boards: "dynasty" as const };
    assert.equal(withBoardToggle(sole, "redraft").boards, "both");
    // Pressing the only lit key is a no-op rather than a blank list.
    assert.equal(withBoardToggle(sole, "dynasty").boards, "dynasty");
  });

  test("a board toggle narrows nothing else", () => {
    const next = withBoardToggle({ ...controls, teams: "12" }, "redraft");
    assert.equal(next.teams, "12");
    assert.equal(next.season, controls.season);
  });

  test("seeding by id is exactly seedFromLeague", () => {
    const leagues = [league("a", 12), league("b", 10)];
    assert.deepEqual(
      withSeededLeague(controls, leagues, "b"),
      seedFromLeague(controls, leagues[1]),
    );
  });

  test("an id nothing matches writes nothing", () => {
    assert.equal(withSeededLeague(controls, [league("a", 12)], "zzz"), null);
    assert.equal(withSeededLeague(controls, [], "a"), null);
  });
});

describe("the board's own wording", () => {
  test("the sole board is redraft unless dynasty is the one shown", () => {
    assert.equal(soleBoardOf("redraft"), "redraft");
    assert.equal(soleBoardOf("dynasty"), "dynasty");
    assert.equal(soleBoardOf("both"), "redraft");
  });

  test("a heading names its population, with the count when there is one", () => {
    assert.equal(
      boardTitle("redraft", null),
      "Average draft position over drafts in redraft and keeper leagues",
    );
    assert.equal(
      boardTitle("dynasty", 1204),
      "Average draft position over 1,204 drafts in dynasty leagues",
    );
    assert.match(takenTitle("redraft"), /redraft board’s drafts/);
    assert.match(valueTitle("all"), /12-slot pool|slot startable pool/);
    // The premise is the pool the size filter implies, not a constant.
    assert.notEqual(valueTitle("10"), valueTitle("12"));
  });

  test("an ADP cell's hover carries the spread and the sample", () => {
    assert.equal(
      adpCellTitle(stats({ picks: 1 }), "redraft", 1204),
      "Picks 1–12 · taken in 1 of 1,204 redraft draft · ±2.4",
    );
    assert.equal(
      adpCellTitle(stats(), "dynasty", null),
      "Picks 1–12 · taken in 46 dynasty drafts · ±2.4",
    );
  });

  test("the taken share is of this board's drafts, and an em dash otherwise", () => {
    assert.equal(takenShare(stats({ picks: 46 }), 100), "46%");
    assert.equal(takenShare(null, 100), "—");
    assert.equal(takenShare(stats(), null), "—");
    // A board with no drafts is a missing denominator, never a 0%.
    assert.equal(takenShare(stats(), 0), "—");
  });
});

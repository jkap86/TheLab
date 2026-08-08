import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";
import type { AdpBoardStats } from "@/shared/manager";

import { DEFAULT_ADP_ROUNDS, defaultAdpControls, seedFromLeague } from "../../adp-controls.ts";
import { ROUNDS_SEGMENT } from "./adp-drawer.constants.ts";
import {
  adpCellTitle,
  boardTitle,
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

describe("the draft-kind row", () => {
  test("it offers the three buckets the query string knows how to send", () => {
    // The vocabulary the route parses, one side of a matched pair with no
    // compiler link: a value dropped here is a filter that silently stops
    // narrowing rather than a type error.
    assert.deepEqual(
      ROUNDS_SEGMENT.options.map((o) => o.value),
      ["all", "full", "rookie"],
    );
  });

  test("Reset returns it to the board's own default, not to the first option", () => {
    // The board opens on startups, which is not "All drafts" — see
    // `DEFAULT_ADP_ROUNDS` for why an unnarrowed default is the wrong one here.
    assert.equal(ROUNDS_SEGMENT.defaultValue, DEFAULT_ADP_ROUNDS);
    assert.notEqual(ROUNDS_SEGMENT.defaultValue, ROUNDS_SEGMENT.options[0].value);
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
    const rules = { ...controls.leagueRules, bestBall: "yes" as const };
    const next = withSeason({ ...controls, leagueRules: rules }, "2025");
    assert.deepEqual(next.leagueRules, rules);
    assert.equal(next.rounds, controls.rounds);
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
    const rules = {
      ...controls.leagueRules,
      size: [{ key: "teams", op: "eq" as const, value: 12 }],
    };
    const next = withBoardToggle({ ...controls, leagueRules: rules }, "redraft");
    assert.deepEqual(next.leagueRules, rules);
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
    assert.match(valueTitle(controls.leagueRules), /slot startable pool/);
    // The premise is the pool an exact size *rule* implies, not a constant.
    const sized = (teams: number) => ({
      ...controls.leagueRules,
      size: [{ key: "teams", op: "eq" as const, value: teams }],
    });
    assert.notEqual(valueTitle(sized(10)), valueTitle(sized(12)));
    // A bound is a range of pools rather than one, so it falls back rather than
    // guessing at an end of it — see `previewDraftTeams`.
    assert.equal(
      valueTitle({
        ...controls.leagueRules,
        size: [{ key: "teams", op: "gte", value: 14 }],
      }),
      valueTitle(controls.leagueRules),
    );
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

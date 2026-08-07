import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";

import { leagueSpecs, qbSlotLabel } from "./league-specs.ts";

/**
 * The rules that break silently.
 *
 * Every fact this module derives is a Sleeper quirk somebody was caught by
 * once — an omitted `type` that means redraft, an omitted scoring key that
 * means zero, and a `roster_positions` that is null and means *unknown* rather
 * than empty. None of those is visible in a type, and getting one wrong prints
 * a plausible token rather than throwing, which is exactly the failure a test
 * has to stand in for.
 */

const league = (over: Partial<ManagerLeague> = {}): ManagerLeague =>
  ({
    league_id: "L1",
    name: "Dynasty Elite",
    season: "2026",
    status: "in_season",
    total_rosters: 12,
    avatar: null,
    record: null,
    settings: {},
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
    scoring_settings: { rec: 1 },
    ...over,
  }) as ManagerLeague;

const labels = (l: ManagerLeague | null) => leagueSpecs(l).map((s) => s.label);
const keys = (l: ManagerLeague | null) => leagueSpecs(l).map((s) => s.key);

describe("qbSlotLabel", () => {
  // The two counts stay apart because they are different rooms: two bare QB
  // slots force a second quarterback, a superflex only permits one.
  test("spells the four shapes a lineup takes", () => {
    assert.equal(qbSlotLabel(1, 0), "1QB");
    assert.equal(qbSlotLabel(2, 0), "2QB");
    assert.equal(qbSlotLabel(1, 1), "1QB + SF");
    assert.equal(qbSlotLabel(0, 1), "SF");
  });

  // No league here runs one, and it costs nothing to be right about.
  test("spells a count above one on both halves", () => {
    assert.equal(qbSlotLabel(2, 2), "2QB + 2SF");
    assert.equal(qbSlotLabel(0, 2), "2SF");
  });

  // A real answer, not a missing one — the league starts no quarterback.
  test("says zero where the lineup genuinely has none", () => {
    assert.equal(qbSlotLabel(0, 0), "0QB");
  });
});

describe("leagueSpecs", () => {
  // The league list hasn't answered yet; the card draws its id and no claims.
  test("is empty for a league that hasn't loaded", () => {
    assert.deepEqual(leagueSpecs(null), []);
  });

  // Sleeper omits `type` for the standard redraft league, so absent is 0 —
  // the same assumption `/api/adp` makes in SQL.
  test("reads an omitted type as redraft", () => {
    assert.equal(labels(league({ settings: {} }))[0], "Redraft");
  });

  test("names the four types Sleeper has", () => {
    assert.equal(labels(league({ settings: { type: 0 } }))[0], "Redraft");
    assert.equal(labels(league({ settings: { type: 1 } }))[0], "Keeper");
    assert.equal(labels(league({ settings: { type: 2 } }))[0], "Dynasty");
    assert.equal(labels(league({ settings: { type: 3 } }))[0], "Chopped");
  });

  // A format Sleeper has added since this build: saying nothing beats naming
  // the league as something it is not, on a run whose whole job is to say what
  // game is being played.
  test("drops the token for a type it doesn't know", () => {
    assert.ok(!keys(league({ settings: { type: 9 } })).includes("type"));
  });

  test("counts the lineup", () => {
    const l = league({
      roster_positions: ["QB", "SUPER_FLEX", "RB", "TE", "TE", "BN"],
    });
    assert.deepEqual(labels(l), ["Redraft", "12 Team", "1QB + SF", "2TE"]);
  });

  // The rule this module shares with the filters: null is not zero. An unsynced
  // lineup is not evidence that the league starts no tight end.
  test("omits the lineup tokens when roster_positions is unknown", () => {
    const l = league({ roster_positions: null });
    assert.deepEqual(keys(l), ["type", "teams"]);
  });

  // Present and empty is a real answer, and a different one.
  test("reports a genuinely empty lineup as zero", () => {
    const l = league({ roster_positions: [] });
    assert.deepEqual(labels(l), ["Redraft", "12 Team", "0QB", "0TE"]);
  });

  // Absent from a stored blob is 0 — Sleeper omits what a league doesn't pay
  // for, which is exactly why `bonus_rec_te > 0` is how this is asked.
  test("draws TE premium only when the league pays one", () => {
    assert.ok(!keys(league()).includes("tep"));
    assert.ok(!keys(league({ scoring_settings: { bonus_rec_te: 0 } })).includes("tep"));
    assert.ok(
      !keys(league({ scoring_settings: null })).includes("tep"),
      "an unsynced scoring blob is unknown, not a premium",
    );
  });

  // Half a point and a full point are different leagues; the rate travels.
  test("carries the premium's rate, formatted as typed", () => {
    const half = leagueSpecs(league({ scoring_settings: { bonus_rec_te: 0.5 } }));
    assert.equal(half.find((s) => s.key === "tep")?.label, "TEP 0.5");
    const full = leagueSpecs(league({ scoring_settings: { bonus_rec_te: 1 } }));
    assert.equal(full.find((s) => s.key === "tep")?.label, "TEP 1");
  });

  // Lineup is the overwhelming default: a token on nearly every card says
  // nothing, and the one on the minority says a lot.
  test("draws best ball only when true", () => {
    assert.ok(!keys(league()).includes("best_ball"));
    assert.ok(keys(league({ settings: { best_ball: 1 } })).includes("best_ball"));
  });

  // The run is read down a list, so the always-present facts hold fixed
  // positions and the conditional ones trail. Best ball leading would move
  // every other token one place left on the cards that have it.
  test("keeps the conditional tokens after the fixed spine", () => {
    const l = league({
      settings: { type: 2, best_ball: 1 },
      roster_positions: ["QB", "SUPER_FLEX", "TE", "BN"],
      scoring_settings: { bonus_rec_te: 0.5 },
    });
    assert.deepEqual(keys(l), ["type", "teams", "qb", "te", "tep", "best_ball"]);
  });

  // What game this is reads a step brighter than the room it was played in.
  test("tones the format facts apart from the lineup detail", () => {
    const l = league({ settings: { type: 2, best_ball: 1 } });
    const byKey = new Map(leagueSpecs(l).map((s) => [s.key, s.tone]));
    assert.equal(byKey.get("type"), "format");
    assert.equal(byKey.get("best_ball"), "format");
    assert.equal(byKey.get("teams"), "config");
    assert.equal(byKey.get("qb"), "config");
  });

  // Against a row stored before the column was filled, not against Sleeper.
  test("omits the size for a league with no rosters", () => {
    assert.ok(!keys(league({ total_rosters: 0 })).includes("teams"));
  });

  // A token this short is an abbreviation, and the title is the desktop
  // backstop the contracted player names already use.
  test("spells every token out in its title", () => {
    const l = league({
      settings: { type: 2, best_ball: 1 },
      roster_positions: ["QB", "SUPER_FLEX", "TE", "BN"],
      scoring_settings: { bonus_rec_te: 0.5 },
    });
    for (const spec of leagueSpecs(l)) {
      assert.ok(spec.title.length > spec.label.length, `${spec.key} has no title`);
    }
  });

  // The gauge's caption is what the value is a count *of*, and it is the whole
  // reason the run is gauges rather than tokens: on a phone there is no hover to
  // ask what `1QB + SF` counts. An empty one is a hole in the bezel rather than
  // a shorter label, so every spec has to carry one.
  test("every gauge names the unit its value counts", () => {
    const l = league({
      settings: { type: 2, best_ball: 1 },
      roster_positions: ["QB", "SUPER_FLEX", "TE", "BN"],
      scoring_settings: { bonus_rec_te: 0.5 },
    });
    const specs = leagueSpecs(l);
    assert.equal(specs.length, 6);
    for (const spec of specs) {
      assert.ok(spec.caption.length > 0, `${spec.key} has no caption`);
      // A caption that restated its value would be spending a line on nothing —
      // "Best ball" over "Best ball" is the one this rule was written against.
      assert.notEqual(
        spec.caption.toLowerCase(),
        spec.label.toLowerCase(),
        `${spec.key} restates itself`,
      );
    }
  });

  // It sits above a value in a housing the run is read *across*, so a caption
  // long enough to wrap is taller than the value it names and the gauges stop
  // lining up. Held to the longest that fits the narrowest gauge.
  test("keeps every caption short enough not to wrap a gauge", () => {
    const l = league({
      settings: { type: 2, best_ball: 1 },
      roster_positions: ["QB", "SUPER_FLEX", "TE", "BN"],
      scoring_settings: { bonus_rec_te: 0.5 },
    });
    for (const spec of leagueSpecs(l)) {
      assert.ok(spec.caption.length <= 8, `${spec.key}'s caption is too long`);
    }
  });
});

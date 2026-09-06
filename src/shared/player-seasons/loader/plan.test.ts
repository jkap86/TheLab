import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EARLIEST_SEASON, latestCompleteSeason, planLoad, playersMapSeason } from "./plan.ts";

/**
 * A season still being played is not a historical outcome, and writing one as
 * though it were is the loader's most expensive mistake: the corpus's
 * did-not-play rule would read every player who has not yet appeared in it as
 * gone, and every row of the season before would be scored against a payoff
 * column nine games short.
 */
describe("latestCompleteSeason", () => {
  const sept2026 = Date.parse("2026-09-06T00:00:00Z");
  const feb2027 = Date.parse("2027-02-20T00:00:00Z");
  const june2027 = Date.parse("2027-06-15T00:00:00Z");

  test("the season Sleeper names is not the season that has been played", () => {
    // `state.season` is the season Sleeper is *working on*, and during it the
    // latest finished one is the year before.
    assert.equal(
      latestCompleteSeason({ season: "2026", season_type: "regular" }, sept2026),
      2025,
    );
  });

  test("`off` on its own does not mean the named season is over", () => {
    // Sleeper rolls its year forward in the spring while `season_type` is
    // still "off", so reading "off" as "this season finished" would write a
    // season nobody has played as a completed historical outcome — for most of
    // the calendar. This is the rule's whole point.
    assert.equal(
      latestCompleteSeason(
        { season: "2027", season_type: "off", season_start_date: "2027-09-09" },
        june2027,
      ),
      2026,
    );
  });

  test("`off` past its own kickoff does: the window before Sleeper rolls its year", () => {
    assert.equal(
      latestCompleteSeason(
        { season: "2026", season_type: "off", season_start_date: "2026-09-10" },
        feb2027,
      ),
      2026,
    );
  });

  test("`pre` and `post` are never enough", () => {
    // The playoffs are not in a regular season's stats, and a preseason is a
    // season that has not happened.
    assert.equal(
      latestCompleteSeason({ season: "2027", season_type: "pre", season_start_date: "2027-09-09" }, june2027),
      2026,
    );
    assert.equal(
      latestCompleteSeason({ season: "2026", season_type: "post", season_start_date: "2026-09-10" }, feb2027),
      2025,
    );
  });

  test("an absent or unparseable kickoff falls to the conservative reading", () => {
    // A few weeks of lag once a year, rather than a wrong season ever.
    for (const start of [undefined, null, "", "soon", "2026-13-40"]) {
      assert.equal(
        latestCompleteSeason({ season: "2026", season_type: "off", season_start_date: start }, feb2027),
        2025,
        String(start),
      );
    }
  });

  test("an unreadable season means nothing is complete", () => {
    for (const season of ["", "abc", "0", "12"]) {
      assert.equal(latestCompleteSeason({ season, season_type: "off" }, sept2026), 0, season);
    }
  });

  test("case and whitespace do not change the answer", () => {
    assert.equal(
      latestCompleteSeason(
        { season: "2026", season_type: " OFF ", season_start_date: "2026-09-10" },
        feb2027,
      ),
      2026,
    );
  });
});

describe("playersMapSeason", () => {
  test("is the season Sleeper names, which is the baseline `years_exp` counts from", () => {
    // Off by one here is a year of experience on every row the `years_exp`
    // fallback answers for — the reading nothing else would catch.
    assert.equal(playersMapSeason({ season: "2026", season_type: "regular" }, 0), 2026);
  });

  test("falls back where the state cannot be read", () => {
    assert.equal(playersMapSeason({ season: "", season_type: "off" }, 2024), 2024);
    assert.equal(playersMapSeason({ season: "abc", season_type: "off" }, 2024), 2024);
  });
});

describe("planLoad", () => {
  test("the default span is the earliest season through the latest complete one", () => {
    const plan = planLoad({ from: null, to: null }, 2025);
    assert.equal(plan.seasons[0], EARLIEST_SEASON);
    assert.equal(plan.seasons[plan.seasons.length - 1], 2025);
    assert.equal(plan.maxCompletedSeason, 2025);
    assert.deepEqual(plan.refused, []);
  });

  test("a requested span inside the complete range is taken whole", () => {
    assert.deepEqual(planLoad({ from: 2021, to: 2023 }, 2025).seasons, [2021, 2022, 2023]);
  });

  test("a season past the latest complete one is refused by name, not clamped", () => {
    // Clamping silently is the difference between a console line an operator
    // reads and a corpus that quietly stops a year short of what they asked.
    const plan = planLoad({ from: 2024, to: 2027 }, 2025);
    assert.deepEqual(plan.seasons, [2024, 2025]);
    assert.deepEqual(
      plan.refused.map((r) => r.season),
      [2026, 2027],
    );
    assert.match(plan.refused[0].reason, /not a completed season/);
  });

  test("with no readable state every season is refused, and the reason says why", () => {
    const plan = planLoad({ from: 2020, to: 2022 }, 0);
    assert.deepEqual(plan.seasons, []);
    assert.equal(plan.refused.length, 3);
    assert.match(plan.refused[0].reason, /NFL state could not be read/);
  });

  test("an inverted or empty span plans nothing rather than looping", () => {
    assert.deepEqual(planLoad({ from: 2024, to: 2022 }, 2025).seasons, []);
    assert.deepEqual(planLoad({ from: 2024, to: 2024 }, 2025).seasons, [2024]);
  });
});

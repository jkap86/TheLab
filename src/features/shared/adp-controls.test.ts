import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_PEAK,
  DEFAULT_ADP_STEEPNESS,
  adpBoardRows,
  adpNarrowingCount,
  adpQueryString,
  adpRangePresets,
  boardLabel,
  defaultAdpControls,
  deriveScoring,
  previewAdpPool,
  previewAdpValue,
  shownAdpBoards,
  steepnessSummary,
  seasonOptions,
  rangeBounds,
  rangeLabel,
  rangeSummary,
  seedFromLeague,
  todayIso,
  toggleAdpBoard,
  type AdpControls,
  type AdpRange,
} from "./adp-controls.ts";
import type { ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

/** A fixed "today" so the relative presets resolve to asserted dates. */
const TODAY = "2026-07-31";

/** The season a board opens on, as the manager layout supplies it. */
const SEASON = "2026";

const league = (over: Partial<ManagerLeague>): ManagerLeague => ({
  league_id: "1",
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  roster_positions: null,
  scoring_settings: null,
  ...over,
});

/** Parse a query string back to a plain object for order-independent asserts. */
const params = (query: string) =>
  Object.fromEntries(new URLSearchParams(query).entries());

describe("adpQueryString", () => {
  test("the default board sends one whole season, snake+linear, and nothing else", () => {
    const query = params(adpQueryString(defaultAdpControls(SEASON), TODAY));
    assert.deepEqual(query, {
      limit: "1000",
      season: "2026",
      draft_type: "snake,linear",
    });
  });

  test("season is always sent, narrowed window or not", () => {
    // The route applies its own DEFAULT_SEASON only when the caller bounded the
    // board neither way, so an omitted season is a default that switches itself
    // off the moment a date bound appears — and the board silently goes back to
    // pooling every season, which is what makes it wrong at every row.
    for (const preset of ["30d", "90d", "all"] as const) {
      const query = params(
        adpQueryString(
          { ...defaultAdpControls(SEASON), range: { preset, from: null, to: null } },
          TODAY,
        ),
      );
      assert.equal(query.season, "2026");
    }
  });

  test("pooling every season is stated, not left to a missing parameter", () => {
    const query = params(adpQueryString({ ...defaultAdpControls(SEASON), season: "all" }, TODAY));
    assert.equal(query.season, "all");
  });

  test("an unbounded range sends no date at all", () => {
    const all = params(
      adpQueryString(
        { ...defaultAdpControls(SEASON), range: { preset: "all", from: null, to: null } },
        TODAY,
      ),
    );
    assert.equal("start_after" in all, false);
    assert.equal("start_before" in all, false);
  });

  test("a custom range sends the ends it has, and only those", () => {
    const query = (range: AdpRange) =>
      params(adpQueryString({ ...defaultAdpControls(SEASON), range }, TODAY));

    assert.deepEqual(
      query({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      {
        limit: "1000",
        season: "2026",
        draft_type: "snake,linear",
        start_after: "2026-06-01",
        start_before: "2026-07-31",
      },
    );
    assert.equal("start_before" in query({ preset: "custom", from: "2026-06-01", to: null }), false);
    assert.equal("start_after" in query({ preset: "custom", from: null, to: "2026-07-31" }), false);
  });

  test("an 'all' control is omitted, not sent empty", () => {
    // Every league filter left on "all" must drop out entirely.
    const query = params(adpQueryString(defaultAdpControls(SEASON), TODAY));
    for (const key of ["scoring", "superflex", "best_ball"]) {
      assert.equal(key in query, false);
    }
  });

  test("league settings map to the route's vocabulary", () => {
    const controls: AdpControls = {
      season: "2025",
      range: { preset: "all", from: null, to: null },
      boards: "dynasty",
      scoring: "ppr",
      superflex: "yes",
      bestBall: "no",
      teams: "12",
      rounds: "full",
      steepness: 5,
    };
    assert.deepEqual(params(adpQueryString(controls, TODAY)), {
      limit: "1000",
      season: "2025",
      draft_type: "snake,linear",
      scoring: "ppr",
      superflex: "1",
      best_ball: "0",
      teams_min: "12",
      teams_max: "12",
      rounds_min: "12",
    });
  });

  test("the boards selection is display state, never a query parameter", () => {
    // The route answers both league-type boards on every fetch; which is drawn
    // is the drawer's business. Sending it would also split the client cache
    // into two entries holding identical payloads.
    const both = adpQueryString(defaultAdpControls(SEASON), TODAY);
    const one = adpQueryString(
      { ...defaultAdpControls(SEASON), boards: "dynasty" },
      TODAY,
    );
    assert.equal(both, one);
    assert.equal("league_type" in params(both), false);
  });

  test("steepness is a value-curve knob, not a board filter — never sent here", () => {
    // It drives the Leagues-tab team value, not which drafts /api/adp averages.
    const flat = adpQueryString({ ...defaultAdpControls(SEASON), steepness: 3 }, TODAY);
    const steep = adpQueryString({ ...defaultAdpControls(SEASON), steepness: 6 }, TODAY);
    assert.equal(flat, steep);
    assert.equal("steepness" in params(flat), false);
  });

  test("the rounds buckets bound one side each, all-rounds neither", () => {
    const round = (rounds: AdpControls["rounds"]) =>
      params(adpQueryString({ ...defaultAdpControls(SEASON), rounds }, TODAY));
    assert.equal("rounds_min" in round("all"), false);
    assert.equal("rounds_max" in round("all"), false);
    assert.deepEqual(
      { min: round("rookie").rounds_min, max: round("rookie").rounds_max },
      { min: undefined, max: "5" },
    );
    assert.deepEqual(
      { min: round("full").rounds_min, max: round("full").rounds_max },
      { min: "12", max: undefined },
    );
  });

  test("a team count binds both bounds to an exact match", () => {
    const query = params(
      adpQueryString({ ...defaultAdpControls(SEASON), teams: "10" }, TODAY),
    );
    assert.equal(query.teams_min, "10");
    assert.equal(query.teams_max, "10");
  });

  test("a board is always over snake and linear drafts, never auctions", () => {
    // An auction's `pick_no` is nomination order rather than a draft slot, so
    // its "ADP" is not one. It stopped being a control when that chip became the
    // startup/rookie question readers were actually asking it, so the parameter
    // is now a constant — and this is what pins it.
    for (const rounds of ["all", "rookie", "full"] as const) {
      const query = params(
        adpQueryString({ ...defaultAdpControls(SEASON), rounds }, TODAY),
      );
      assert.equal(query.draft_type, "snake,linear");
    }
  });
});

describe("steepnessSummary", () => {
  test("reads the curve as what the last starter is worth", () => {
    // 2^-halvings a full pool deep. The default halves four times, so the last
    // startable pick is ~1/16 of the 1.01.
    assert.equal(steepnessSummary(4), "last starter ≈ 6% of the 1.01");
    assert.equal(steepnessSummary(2), "last starter ≈ 25% of the 1.01");
  });

  test("the steep end keeps a digit rather than rounding to nothing", () => {
    // Rounded whole, the top of the range reads "0%", which says the curve
    // stopped moving where it is in fact still halving.
    assert.equal(steepnessSummary(8), "last starter ≈ 0.4% of the 1.01");
  });
});

describe("previewAdpPool", () => {
  test("uses the size filter when the board is narrowed to one", () => {
    assert.equal(previewAdpPool("10"), 10 * 9);
  });

  test("an unnarrowed or junk size falls back to a typical 12-team league", () => {
    // The drawer's board belongs to no league, so the preview needs a premise;
    // a zero or unparseable one would collapse the curve rather than pick a pool.
    assert.equal(previewAdpPool("all"), 12 * 9);
    assert.equal(previewAdpPool("0"), 12 * 9);
    assert.equal(previewAdpPool("nonsense"), 12 * 9);
  });
});

describe("previewAdpValue", () => {
  test("the top of the board is the peak, and value falls down it", () => {
    assert.equal(previewAdpValue(1, "all", DEFAULT_ADP_STEEPNESS), ADP_PEAK);
    assert.ok(
      previewAdpValue(50, "all", DEFAULT_ADP_STEEPNESS) >
        previewAdpValue(120, "all", DEFAULT_ADP_STEEPNESS),
    );
  });

  test("a steeper curve is worth less everywhere but the very top", () => {
    // What the slider does, and the reason the preview re-prices as it moves.
    assert.ok(previewAdpValue(40, "all", 6) < previewAdpValue(40, "all", 3));
    assert.equal(previewAdpValue(1, "all", 6), previewAdpValue(1, "all", 3));
  });
});

describe("deriveScoring", () => {
  test("buckets on rec, treating a missing rec as standard", () => {
    assert.equal(deriveScoring(null), "std");
    assert.equal(deriveScoring({}), "std");
    assert.equal(deriveScoring({ rec: 0 }), "std");
    assert.equal(deriveScoring({ rec: 0.5 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 0.75 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 1 }), "ppr");
  });
});

describe("seedFromLeague", () => {
  test("fills the league settings and leaves the rest", () => {
    const base: AdpControls = {
      ...defaultAdpControls(SEASON),
      range: { preset: "custom", from: "2025-05-01", to: null },
      rounds: "rookie",
      superflex: "yes",
    };
    const seeded = seedFromLeague(
      base,
      league({
        total_rosters: 10,
        settings: { type: 2, best_ball: 1 },
        roster_positions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
        scoring_settings: { rec: 0.5 },
      }),
    );
    // The league's type seeds which board the list displays — the market this
    // league is actually in — since it is no longer a fetch filter to set.
    assert.equal(seeded.boards, "dynasty");
    assert.equal(seeded.scoring, "half_ppr");
    assert.equal(seeded.bestBall, "yes");
    assert.equal(seeded.teams, "10");
    assert.equal(seeded.superflex, "yes");
    // The season *is* a league setting: matching a 2025 league while leaving the
    // board on this year prices it against a market it was never in.
    assert.equal(seeded.season, "2026");
    assert.equal(
      seedFromLeague(base, league({ season: "2024" })).season,
      "2024",
    );
    // Not league settings — left exactly as they were.
    assert.deepEqual(seeded.range, { preset: "custom", from: "2025-05-01", to: null });
    assert.equal(seeded.rounds, "rookie");
  });

  test("seeds superflex off the slots, so a 1QB league resets it", () => {
    // The board a two-QB league belongs to is the one thing this shortcut used
    // to leave pointing at whatever was there before.
    const base: AdpControls = { ...defaultAdpControls(SEASON), superflex: "yes" };
    const seeded = seedFromLeague(
      base,
      league({ roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"] }),
    );
    assert.equal(seeded.superflex, "no");
  });

  test("a league Sleeper omits `type` for reads as redraft, lineup", () => {
    const seeded = seedFromLeague(defaultAdpControls(SEASON), league({ settings: {} }));
    assert.equal(seeded.boards, "redraft");
    assert.equal(seeded.bestBall, "no");
  });

  test("a keeper league reads the redraft board, the server's own bucketing", () => {
    const seeded = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ settings: { type: 1 } }),
    );
    assert.equal(seeded.boards, "redraft");
  });
});

describe("rangeBounds", () => {
  test("the relative presets count back from today and end open", () => {
    // Open-ended on purpose: a draft in progress can carry a start time hours
    // ahead, and "last 30 days" shouldn't drop it.
    assert.deepEqual(rangeBounds({ preset: "30d", from: null, to: null }, TODAY), {
      from: "2026-07-01",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "90d", from: null, to: null }, TODAY), {
      from: "2026-05-02",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "12m", from: null, to: null }, TODAY), {
      from: "2025-07-31",
      to: null,
    });
  });

  test("months are calendar months, clamped where the day doesn't exist", () => {
    // Backing up 12 months from a leap day, or from the 31st of a month whose
    // counterpart is shorter, must not roll into the next month — that would
    // silently widen the window by a whole month.
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2024-02-29").from, "2023-02-28");
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2026-03-31").from, "2025-03-31");
  });

  test("day arithmetic crosses months and years", () => {
    assert.equal(rangeBounds({ preset: "30d", from: null, to: null }, "2026-01-15").from, "2025-12-16");
  });

  test("all time bounds nothing; custom passes its own ends through", () => {
    assert.deepEqual(rangeBounds({ preset: "all", from: null, to: null }, TODAY), {
      from: null,
      to: null,
    });
    assert.deepEqual(
      rangeBounds({ preset: "custom", from: "2026-06-01", to: "2026-06-30" }, TODAY),
      { from: "2026-06-01", to: "2026-06-30" },
    );
  });
});

describe("rangeLabel", () => {
  test("a preset keeps its name, so it stays true tomorrow", () => {
    assert.equal(rangeLabel({ preset: "90d", from: null, to: null }), "Last 90 days");
    assert.equal(rangeLabel({ preset: "all", from: null, to: null }), "All time");
  });

  test("a custom range spells out the ends it has", () => {
    assert.equal(
      rangeLabel({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeLabel({ preset: "custom", from: "2026-06-01", to: null }), "Since Jun 1, 2026");
    assert.equal(rangeLabel({ preset: "custom", from: null, to: "2026-07-31" }), "Through Jul 31, 2026");
    // Neither end set narrows nothing, so say what it does rather than "Custom".
    assert.equal(rangeLabel({ preset: "custom", from: null, to: null }), "All time");
  });
});

describe("boardLabel", () => {
  const unbounded: AdpRange = { preset: "all", from: null, to: null };

  test("an unbounded window folds into the season rather than sitting beside it", () => {
    // "2026 · All time" would be claiming two contradictory things.
    assert.equal(boardLabel(unbounded, "2026"), "All of 2026");
    assert.equal(boardLabel({ preset: "custom", from: null, to: null }, "2026"), "All of 2026");
  });

  test("a narrowed window is named after its season, because it is half an answer", () => {
    assert.equal(boardLabel({ preset: "30d", from: null, to: null }, "2026"), "2026 · Last 30 days");
    assert.equal(
      boardLabel({ preset: "custom", from: "2026-06-01", to: null }, "2026"),
      "2026 · Since Jun 1, 2026",
    );
  });

  test("the all-seasons board has only the window to name", () => {
    assert.equal(boardLabel(unbounded, "all"), "All time");
    assert.equal(boardLabel({ preset: "90d", from: null, to: null }, "all"), "Last 90 days");
  });
});

describe("adpRangePresets", () => {
  const values = (season: string) => adpRangePresets(season, SEASON).map((p) => p.value);

  test("a relative preset is only offered on a board that can contain today", () => {
    // "The last 30 days" of a finished season is an empty board, and a chip that
    // reliably returns nothing is worse than no chip.
    assert.deepEqual(values("2026"), ["all", "30d", "90d"]);
    assert.deepEqual(values("2024"), ["all"]);
  });

  test("twelve months survives only where it is a real cut", () => {
    // Inside one season it is the whole season with extra steps.
    assert.equal(values("2026").includes("12m"), false);
    assert.deepEqual(values("all"), ["30d", "90d", "12m", "all"]);
  });

  test("the unbounded preset names the season it covers", () => {
    const inSeason = adpRangePresets("2026", SEASON).find((p) => p.value === "all")!;
    assert.equal(inSeason.label, "All of 2026");
    assert.equal(inSeason.chip, "All 2026");
    assert.equal(adpRangePresets("all", SEASON).at(-1)!.label, "All time");
  });
});

describe("seasonOptions", () => {
  const density = [
    { season: "2024" },
    { season: "2025" },
    { season: "2025" },
    { season: "2026" },
  ];

  test("newest first, with the pooled board last", () => {
    assert.deepEqual(seasonOptions(density, "2026", SEASON), ["2026", "2025", "2024", "all"]);
  });

  test("the current season is offered even before it has been crawled", () => {
    // Every spring it is empty for a few weeks, and it is still the default.
    assert.deepEqual(seasonOptions([{ season: "2025" }], "2025", "2026"), [
      "2026",
      "2025",
      "all",
    ]);
  });

  test("the selected season is never dropped by the cap", () => {
    // A row describing a board it isn't showing is worse than a shorter row.
    const many = ["2022", "2023", "2024", "2025", "2026"].map((season) => ({ season }));
    const options = seasonOptions(many, "2022", SEASON, 3);
    assert.deepEqual(options, ["2026", "2025", "2022", "all"]);
  });
});

describe("rangeSummary", () => {
  test("says the dates a preset's name doesn't", () => {
    // The label stays "Last 90 days"; inside the scrubber, where the handles
    // are sitting on those dates, the reader shouldn't have to work them back
    // off the axis.
    assert.equal(rangeSummary({ preset: "90d", from: null, to: null }, TODAY), "since May 2, 2026");
    assert.equal(rangeSummary({ preset: "12m", from: null, to: null }, TODAY), "since Jul 31, 2025");
  });

  test("a bounded range reads as its pair, a half-open one as its end", () => {
    const custom = (from: string | null, to: string | null): AdpRange => ({
      preset: "custom",
      from,
      to,
    });
    assert.equal(
      rangeSummary(custom("2026-06-01", "2026-07-31"), TODAY),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeSummary(custom(null, "2026-07-31"), TODAY), "up to Jul 31, 2026");
  });

  test("an unbounded range has nothing to add", () => {
    // "All time" needs no gloss, and null is what the caller skips rendering.
    assert.equal(rangeSummary({ preset: "all", from: null, to: null }, TODAY), null);
    assert.equal(rangeSummary({ preset: "custom", from: null, to: null }, TODAY), null);
  });
});

describe("todayIso", () => {
  test("formats the local date, not the UTC one", () => {
    // Late evening in a western zone is already tomorrow in UTC; the reader's
    // "last 30 days" should start from the date on their calendar.
    assert.equal(todayIso(new Date(2026, 6, 31, 23, 30)), "2026-07-31");
    assert.equal(todayIso(new Date(2026, 0, 5, 0, 15)), "2026-01-05");
  });
});

describe("adpNarrowingCount", () => {
  test("the default board narrows nothing", () => {
    assert.equal(adpNarrowingCount(defaultAdpControls(SEASON), SEASON), 0);
  });

  test("each filter counts once", () => {
    const base = defaultAdpControls(SEASON);
    assert.equal(adpNarrowingCount({ ...base, superflex: "yes" }, SEASON), 1);
    assert.equal(
      adpNarrowingCount(
        { ...base, superflex: "yes", rounds: "rookie", teams: "12" },
        SEASON,
      ),
      3,
    );
  });

  test("a bounded window counts, an unbounded one doesn't", () => {
    const base = defaultAdpControls(SEASON);
    // A custom range with neither end set narrows nothing — the same reading
    // `isUnboundedRange` gives it, so the diamond stays dark for a window that
    // is "custom" in name only.
    const range = (range: AdpRange) => adpNarrowingCount({ ...base, range }, SEASON);
    assert.equal(range({ preset: "custom", from: null, to: null }), 0);
    assert.equal(range({ preset: "30d", from: null, to: null }), 1);
    assert.equal(range({ preset: "custom", from: "2026-05-01", to: null }), 1);
  });

  test("a season other than the default counts", () => {
    // The board's population, and a larger departure from the board everybody
    // else is reading than any filter here — a different season is a different
    // market, not a slice of this one.
    assert.equal(adpNarrowingCount(defaultAdpControls("2024"), SEASON), 1);
    assert.equal(adpNarrowingCount(defaultAdpControls("all"), SEASON), 1);
  });

  test("the value curve is not a narrowing", () => {
    // It converts an ADP into value once averaged, so it moves the Leagues tab's
    // team value and leaves the population the trigger describes untouched.
    assert.equal(
      adpNarrowingCount({ ...defaultAdpControls(SEASON), steepness: 6 }, SEASON),
      0,
    );
  });

  test("the boards selection is not a narrowing either", () => {
    // Which market is drawn is a display choice over an unchanged population —
    // the same standing the steepness has.
    assert.equal(
      adpNarrowingCount({ ...defaultAdpControls(SEASON), boards: "dynasty" }, SEASON),
      0,
    );
  });
});

describe("shownAdpBoards / toggleAdpBoard", () => {
  test("each selection lights the boards it names", () => {
    assert.deepEqual(shownAdpBoards("both"), { redraft: true, dynasty: true });
    assert.deepEqual(shownAdpBoards("redraft"), { redraft: true, dynasty: false });
    assert.deepEqual(shownAdpBoards("dynasty"), { redraft: false, dynasty: true });
  });

  test("toggling flips one board's visibility", () => {
    assert.equal(toggleAdpBoard("both", "redraft"), "dynasty");
    assert.equal(toggleAdpBoard("both", "dynasty"), "redraft");
    assert.equal(toggleAdpBoard("redraft", "dynasty"), "both");
    assert.equal(toggleAdpBoard("dynasty", "redraft"), "both");
  });

  test("the last lit board can't be turned off", () => {
    // A blank list is unrepresentable, so pressing the only lit key is a no-op
    // rather than a guard every caller has to remember.
    assert.equal(toggleAdpBoard("redraft", "redraft"), "redraft");
    assert.equal(toggleAdpBoard("dynasty", "dynasty"), "dynasty");
  });
});

describe("adpBoardRows", () => {
  const row = (
    player_id: string,
    redraft: number | null,
    dynasty: number | null,
    picks = 10,
  ): AdpPlayerPayload => ({
    player_id,
    name: player_id,
    position: null,
    team: null,
    redraft:
      redraft === null
        ? null
        : { adp: redraft, min_pick: 1, max_pick: 30, picks, stdev: 2 },
    dynasty:
      dynasty === null
        ? null
        : { adp: dynasty, min_pick: 1, max_pick: 30, picks, stdev: 2 },
  });

  const ids = (rows: AdpPlayerPayload[]) => rows.map((r) => r.player_id);

  test("a single board keeps only what it can average, in its own order", () => {
    // The fetch's order is fair to both markets, so it matches neither column
    // read alone — a veteran early in redraft and late in dynasty must re-rank
    // when the reader flips boards.
    const players = [
      row("veteran", 5, 40),
      row("rookie", null, 3),
      row("star", 2, 8),
    ];
    assert.deepEqual(ids(adpBoardRows(players, "redraft")), ["star", "veteran"]);
    assert.deepEqual(ids(adpBoardRows(players, "dynasty")), [
      "rookie",
      "star",
      "veteran",
    ]);
  });

  test("both boards keep every row, redraft order first, dynasty-only tail after", () => {
    // Interleaving on numbers from two different markets would rank a rookie's
    // dynasty 3.0 against a veteran's redraft 5.0, which compares nothing.
    const players = [row("rookie", null, 3), row("veteran", 5, 40), row("star", 2, 8)];
    assert.deepEqual(ids(adpBoardRows(players, "both")), [
      "star",
      "veteran",
      "rookie",
    ]);
  });

  test("ties break on the better sample, then the id", () => {
    const players = [row("thin", 4, null, 3), row("deep", 4, null, 20)];
    assert.deepEqual(ids(adpBoardRows(players, "redraft")), ["deep", "thin"]);
  });

  test("the input order is left alone", () => {
    const players = [row("b", 9, null), row("a", 1, null)];
    adpBoardRows(players, "redraft");
    assert.deepEqual(ids(players), ["b", "a"]);
  });
});

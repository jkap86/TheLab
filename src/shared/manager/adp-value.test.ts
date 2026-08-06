import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_PEAK,
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  ADP_VALUE_PARAMS,
  adpBoardFor,
  adpValue,
  boardSignature,
  defaultBoardChoices,
  parseAdpBoardChoices,
  leagueAdpPool,
  parseSteepness,
  rosterAdpValue,
  startingSlotCount,
} from "./adp-value.ts";

// A 12-team league starting 9 — 108 startable slots — at the default steepness.
const POOL = 108;
const HALVINGS = 4;

describe("adpValue", () => {
  test("the first pick sits at the peak", () => {
    assert.equal(adpValue(1, POOL, HALVINGS), ADP_PEAK);
  });

  test("value halves one full halving-step into the pool", () => {
    // (adp − 1)/pool = 1/halvings ⇒ one halving. 27/108 = 1/4 = 1/HALVINGS.
    assert.equal(adpValue(1 + POOL / HALVINGS, POOL, HALVINGS), Math.round(ADP_PEAK / 2));
  });

  test("a full pool deep, value has halved `halvings` times", () => {
    assert.equal(adpValue(1 + POOL, POOL, HALVINGS), Math.round(ADP_PEAK / 2 ** HALVINGS));
  });

  test("a better (lower) ADP is never worth less", () => {
    // Non-increasing everywhere — integer rounding leaves ties in the deep tail
    // (two picks in the hundreds price a rounding apart), which is fine: two deep
    // bench pieces really are worth about the same.
    let previous = Infinity;
    for (let adp = 1; adp <= 300; adp += 3) {
      const value = adpValue(adp, POOL, HALVINGS);
      assert.ok(value <= previous, `adp ${adp} rose above ${previous}`);
      previous = value;
    }
  });

  test("a bigger startable pool holds value further down the board", () => {
    // The league-size anchor: the same pick is worth more where more players start.
    assert.ok(adpValue(30, 132, HALVINGS) > adpValue(30, 72, HALVINGS));
  });

  test("more halvings make the curve steeper", () => {
    assert.ok(adpValue(30, POOL, 5) < adpValue(30, POOL, 3));
  });

  test("a junk ADP can't exceed the peak or return NaN", () => {
    assert.equal(adpValue(Number.NaN, POOL, HALVINGS), ADP_PEAK);
    assert.equal(adpValue(0, POOL, HALVINGS), ADP_PEAK);
  });

  test("a zero pool is floored rather than dividing by zero", () => {
    const value = adpValue(30, 0, HALVINGS);
    assert.ok(Number.isFinite(value) && value >= 0 && value < ADP_PEAK);
  });
});

describe("startingSlotCount", () => {
  test("counts starting slots, dropping bench, IR and taxi", () => {
    assert.equal(
      startingSlotCount(["QB", "RB", "RB", "WR", "TE", "FLEX", "BN", "IR", "TAXI"]),
      6,
    );
  });

  test("a superflex slot is a starting slot", () => {
    assert.equal(startingSlotCount(["QB", "SUPER_FLEX", "BN"]), 2);
  });

  test("an unrecognised slot starts nobody", () => {
    assert.equal(startingSlotCount(["QB", "OP", "BN"]), 1);
  });

  test("no slots on file is zero, not a guess", () => {
    assert.equal(startingSlotCount(null), 0);
    assert.equal(startingSlotCount([]), 0);
  });
});

describe("leagueAdpPool", () => {
  test("teams times starting slots", () => {
    assert.equal(leagueAdpPool(12, ["QB", "RB", "WR", "BN"]), 36);
  });

  test("a league with no slots on file falls back to a typical lineup", () => {
    // The fallback keeps the curve from collapsing to a pool of zero; the same
    // number must reach the league route and the adp-value route, which is why
    // it lives here and not retyped per caller.
    assert.equal(leagueAdpPool(10, null), 10 * TYPICAL_STARTING_SLOTS);
    assert.equal(leagueAdpPool(10, []), 10 * TYPICAL_STARTING_SLOTS);
  });
});

describe("parseSteepness", () => {
  test("a number of halvings passes through, fractions included", () => {
    // The slider's step is a quarter of a halving, so a whole-number parse would
    // silently coarsen every curve between the notches.
    assert.equal(parseSteepness("3"), 3);
    assert.equal(parseSteepness("4.25"), 4.25);
  });

  test("anything unparseable falls back to the default", () => {
    assert.equal(parseSteepness(null), DEFAULT_STEEPNESS);
    assert.equal(parseSteepness(undefined), DEFAULT_STEEPNESS);
    assert.equal(parseSteepness("garbage"), DEFAULT_STEEPNESS);
    // An empty parameter is an absent one — `Number("")` is 0, which would clamp
    // to the flattest curve on the scale rather than the default.
    assert.equal(parseSteepness(""), DEFAULT_STEEPNESS);
  });

  test("out of range clamps rather than resetting", () => {
    // The nearest curve on the scale is a better answer to "steeper than that"
    // than silently pricing every roster on the default.
    assert.equal(parseSteepness("99"), STEEPNESS_RANGE.max);
    assert.equal(parseSteepness("-5"), STEEPNESS_RANGE.min);
  });

  test("the default sits inside the range", () => {
    assert.ok(DEFAULT_STEEPNESS >= STEEPNESS_RANGE.min);
    assert.ok(DEFAULT_STEEPNESS <= STEEPNESS_RANGE.max);
  });
});

describe("rosterAdpValue", () => {
  const values = new Map([
    ["qb", 8000],
    ["rb", 5000],
    ["wr", 3000],
    ["stash", 2000],
  ]);

  test("splits the total across the lineup, bench taking the remainder", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["qb", "rb"],
      values,
    });
    assert.deepEqual(result, {
      total: 18000,
      priced: 4,
      rostered: 4,
      split: { starters: 13000, bench: 5000 },
    });
  });

  test("the halves always add back up to the total", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["wr"],
      values,
    });
    assert.equal(result.split!.starters + result.split!.bench, result.total);
  });

  test("a player with no ADP is rostered but adds nothing", () => {
    const result = rosterAdpValue({
      players: ["qb", "kicker", "def"],
      starters: ["qb", "kicker"],
      values,
    });
    assert.equal(result.total, 8000);
    assert.equal(result.priced, 1);
    assert.equal(result.rostered, 3);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("empty and padded slot ids are not players", () => {
    const result = rosterAdpValue({
      players: ["qb", "0", ""],
      starters: ["qb", "0"],
      values,
    });
    assert.equal(result.rostered, 1);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("a repeated player id counts once", () => {
    const result = rosterAdpValue({
      players: ["qb", "qb", "rb"],
      starters: ["qb"],
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.rostered, 2);
    assert.deepEqual(result.split, { starters: 8000, bench: 5000 });
  });

  test("a starter this roster doesn't hold can't overdraw the bench", () => {
    const result = rosterAdpValue({
      players: ["wr"],
      starters: ["qb", "wr"],
      values,
    });
    assert.deepEqual(result.split, { starters: 3000, bench: 0 });
  });

  test("no lineup leaves the total intact and the split unanswered", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb"],
      starters: null,
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.split, null);
  });

  test("an empty roster prices at nothing rather than failing", () => {
    const result = rosterAdpValue({ players: [], starters: [], values });
    assert.deepEqual(result, {
      total: 0,
      priced: 0,
      rostered: 0,
      split: { starters: 0, bench: 0 },
    });
  });
});

describe("adpBoardFor", () => {
  test("reads the board off the league's slots and scoring", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
    });
    assert.deepEqual(board.seasons, ["2025"]);
    assert.equal(board.superflex, true);
    assert.deepEqual(board.scoring, ["ppr"]);
  });

  test("a single QB league reads the 1QB board, half-PPR its bucket", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
      scoringSettings: { rec: 0.5 },
    });
    assert.equal(board.superflex, false);
    assert.deepEqual(board.scoring, ["half_ppr"]);
  });

  test("missing reception scoring is standard, not a failure", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: null,
    });
    assert.deepEqual(board.scoring, ["std"]);
  });

  test("leagues sharing the priced axes share a signature", () => {
    // The league type is deliberately not an axis: the fetch answers both
    // boards, so a dynasty league and a redraft league alike in slots and
    // scoring share one query and read their own side of it.
    const a = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
    });
    const b = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "QB", "RB"],
      scoringSettings: { rec: 1.5 },
    });
    const c = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: { rec: 1 },
    });
    assert.equal(boardSignature(a), boardSignature(b));
    assert.notEqual(boardSignature(a), boardSignature(c));
  });

  test("with no board supplied it is this season, whole — the old behaviour", () => {
    // The league detail route has no drawer behind it, so the fallback has to be
    // the board this function produced before a reader could narrow one.
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: null,
    });
    assert.deepEqual(board.seasons, ["2025"]);
    for (const bound of [
      board.start_after,
      board.start_before,
      board.best_ball,
      board.rounds_min,
      board.rounds_max,
      board.teams_min,
      board.teams_max,
    ]) {
      assert.equal(bound, null);
    }
  });

  test("the reader's choices narrow the population the league is matched inside", () => {
    // What the ADP drawer sends: the window, the kind of draft, the size and the
    // format. Without this the panel could be narrowed to startup drafts while
    // every card went on being priced off every draft crawled.
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: { rec: 1 },
      board: {
        ...defaultBoardChoices("2026"),
        start_after: "2026-06-01",
        rounds_min: 12,
        teams_min: 12,
        teams_max: 12,
        best_ball: false,
      },
    });
    assert.deepEqual(board.seasons, ["2026"]);
    assert.equal(board.start_after, "2026-06-01");
    assert.equal(board.rounds_min, 12);
    assert.deepEqual([board.teams_min, board.teams_max], [12, 12]);
    assert.equal(board.best_ball, false);
  });

  test("a reader cannot reach the two axes the league answers for itself", () => {
    // Scoring and superflex are facts about the league being priced, not choices
    // about a market: a superflex roster valued off 1QB drafts is wrong at every
    // position. The type makes that unrepresentable; this pins that the fields
    // survive a board that carries every axis a reader *may* set.
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "SUPER_FLEX", "RB"],
      scoringSettings: { rec: 1 },
      board: {
        ...defaultBoardChoices("2025"),
        rounds_min: 12,
        best_ball: true,
      },
    });
    assert.equal(board.superflex, true);
    assert.deepEqual(board.scoring, ["ppr"]);
  });

  test("an empty query string is the board this route always used", () => {
    // What both routes answer for a caller that sends nothing: the season they
    // supply, whole. A change that made the no-board case narrow anything would
    // move numbers for readers who never opened the drawer.
    const parsed = parseAdpBoardChoices(new URLSearchParams(), "2025");
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.board, defaultBoardChoices("2025"));
  });

  test("the season arrives as `board_season`, and plain `season` is ignored", () => {
    // `?season` belongs to `resolveManagerRequest` on the batch route, where it
    // picks which leagues' rosters are being priced — so a board that read it
    // would swap the card list out from under itself. The two names are two
    // questions, and this is the whole of that separation.
    const parsed = parseAdpBoardChoices(
      new URLSearchParams({ season: "2024", [ADP_VALUE_PARAMS.boardSeason]: "2026" }),
      "2025",
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.board.seasons, ["2026"]);

    // A `?season` with no board season beside it narrows nothing: the caller's
    // default stands, which is the page's own season on one route and the
    // league's on the other.
    const pageOnly = parseAdpBoardChoices(new URLSearchParams({ season: "2024" }), "2025");
    assert.ok(pageOnly.ok);
    assert.deepEqual(pageOnly.board.seasons, ["2025"]);
  });

  test("it reads the whole board vocabulary, through the one parser", () => {
    const parsed = parseAdpBoardChoices(
      new URLSearchParams({
        [ADP_VALUE_PARAMS.boardSeason]: "2026",
        start_after: "2026-06-01",
        start_before: "2026-07-31",
        rounds_min: "12",
        teams_min: "12",
        teams_max: "12",
        best_ball: "0",
      }),
      "2025",
    );
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.board, {
      seasons: ["2026"],
      start_after: "2026-06-01",
      start_before: "2026-07-31",
      best_ball: false,
      rounds_min: 12,
      rounds_max: null,
      teams_min: 12,
      teams_max: 12,
    });
  });

  test("an all-seasons board is `null` seasons, not the default", () => {
    const parsed = parseAdpBoardChoices(
      new URLSearchParams({ [ADP_VALUE_PARAMS.boardSeason]: "all" }),
      "2025",
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.board.seasons, null);
  });

  test("a malformed bound is refused, never quietly dropped", () => {
    // The failure that matters is the silent one: a board that ignored a bad
    // date would answer with a wider population than the reader asked for and
    // nothing on screen would say so.
    const bounds: Record<string, string>[] = [
      { start_after: "2026-02-31" },
      { start_after: "2026-07-01", start_before: "2026-06-01" },
      { rounds_min: "2.5" },
    ];
    for (const bad of bounds) {
      const parsed = parseAdpBoardChoices(
        new URLSearchParams({ [ADP_VALUE_PARAMS.boardSeason]: "2026", ...bad }),
        "2025",
      );
      assert.equal(parsed.ok, false);
    }
  });

  test("the signature names every axis of the board, not only the varying two", () => {
    // The reader's choices are constant across one request, so this changes no
    // grouping today — but a signature naming less than the board it stands for
    // is a silent collision the moment a caller varies one, and the symptom
    // would be leagues priced off somebody else's window with nothing to say so.
    const of = (over: Partial<Parameters<typeof adpBoardFor>[0]["board"] & object>) =>
      boardSignature(
        adpBoardFor({
          season: "2025",
          rosterPositions: ["QB", "RB", "WR"],
          scoringSettings: { rec: 1 },
          board: { ...defaultBoardChoices("2025"), ...over },
        }),
      );
    const plain = of({});
    assert.notEqual(plain, of({ rounds_min: 12 }));
    assert.notEqual(plain, of({ start_after: "2026-06-01" }));
    assert.notEqual(plain, of({ teams_min: 12, teams_max: 12 }));
    assert.notEqual(plain, of({ best_ball: true }));
    // …and equal boards still share one query, which is what it is for.
    assert.equal(of({ rounds_min: 12 }), of({ rounds_min: 12 }));
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { leagueScoringRows, leagueSettingRows } from "./league-settings.ts";
import type { SettingRow } from "./league-settings.ts";

/**
 * What the Settings tab promises about a league it is describing.
 *
 * Every assertion here is a *reading* of a Sleeper blob rather than a shape, and
 * each one fails silently: a row saying `trade deadline 99` or `type 2` renders
 * as fluently as the right answer, a scoring list that keeps its stored zeros
 * makes two identically-scored leagues look different, and a format row read off
 * the blob rather than off the payload's own boolean would disagree with the
 * board that priced the card this panel opened from.
 */

const rowFor = (rows: SettingRow[], key: string) =>
  rows.find((row) => row.key === key);

describe("league scoring rows", () => {
  test("no scoring stored is no rows — not a list of zeros", () => {
    assert.deepEqual(leagueScoringRows(null), []);
  });

  test("a stored zero is dropped, because absent means zero anyway", () => {
    // `scoringValue`'s rule read the other way: a league that omits `rec` and
    // one that stores `rec: 0` are the same league, so a list that drew them
    // differently would be reporting Sleeper's serialisation rather than the
    // league's scoring.
    const rows = leagueScoringRows({ rec: 0, pass_td: 4 });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["pass_td"],
    );
  });

  test("a negative rate stays — paying −2 for a pick is something a league does", () => {
    const rows = leagueScoringRows({ pass_int: -2 });
    assert.equal(rowFor(rows, "pass_int")?.value, "-2");
  });

  test("ranked by the menu's own table, then alphabetically", () => {
    const rows = leagueScoringRows({
      zebra_bonus: 1,
      pass_yd: 0.04,
      rec: 1,
      abacus_bonus: 1,
    });
    assert.deepEqual(
      rows.map((r) => r.key),
      // `rec` and `pass_yd` are ranked by `COMMON_SCORING_KEYS`; the two the
      // table has never heard of follow in alphabetical order.
      ["rec", "pass_yd", "abacus_bonus", "zebra_bonus"],
    );
  });

  test("a rate reads as typed rather than as floated", () => {
    const rows = leagueScoringRows({ pass_yd: 0.04, rec: 0.5, pass_td: 6 });
    assert.equal(rowFor(rows, "pass_yd")?.value, "0.04");
    assert.equal(rowFor(rows, "rec")?.value, "0.5");
    assert.equal(rowFor(rows, "pass_td")?.value, "6");
  });

  test("a key is spelled with its underscores opened out", () => {
    const rows = leagueScoringRows({ bonus_rec_te: 0.5 });
    assert.equal(rowFor(rows, "bonus_rec_te")?.label, "bonus rec te");
  });

  test("a value that isn't a number is no row at all", () => {
    // The rule menu drops these for want of anything to compare; a list drops
    // them for want of anything to print.
    const rows = leagueScoringRows({
      rec: 1,
      // Sleeper promises nothing about this blob's types.
      note: "half ppr" as unknown as number,
    });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["rec"],
    );
  });
});

describe("league settings rows", () => {
  const league = (
    settings: Record<string, unknown> | null,
    over: { teams?: number; bestBall?: boolean } = {},
  ) =>
    leagueSettingRows({
      settings,
      teams: over.teams ?? 12,
      bestBall: over.bestBall ?? false,
    });

  test("leads with what game this is — teams, type, format", () => {
    const rows = league({ type: 2 });
    assert.deepEqual(
      rows.slice(0, 3).map((r) => r.key),
      ["teams", "type", "best_ball"],
    );
  });

  test("the type is named, never left as its code", () => {
    assert.equal(rowFor(league({ type: 2 }), "type")?.value, "Dynasty");
    assert.equal(rowFor(league({ type: 1 }), "type")?.value, "Keeper");
    assert.equal(rowFor(league({ type: 3 }), "type")?.value, "Chopped");
  });

  test("an omitted type is redraft, the one fallback the app shares", () => {
    // Sleeper omits `type` for a standard redraft league; read through
    // `leagueType`, so this panel and the filters cannot disagree.
    assert.equal(rowFor(league({}), "type")?.value, "Redraft");
    assert.equal(rowFor(league(null), "type")?.value, "Redraft");
  });

  test("the format is the payload's answer, not the blob's", () => {
    // `best_ball` reaches the panel through `BEST_BALL_SQL`, which is the one
    // definition the board and the trade cards read too. A blob that says
    // otherwise must not win here, or the panel argues with the card that
    // opened it.
    const rows = league({ best_ball: 1 }, { bestBall: false });
    assert.equal(rowFor(rows, "best_ball")?.value, "Lineup");
    assert.equal(
      rowFor(league({}, { bestBall: true }), "best_ball")?.value,
      "Best ball",
    );
  });

  test("the two named keys appear once, not again in the run below", () => {
    const rows = league({ type: 2, best_ball: 1, taxi_slots: 4 });
    assert.equal(rows.filter((r) => r.key === "type").length, 1);
    assert.equal(rows.filter((r) => r.key === "best_ball").length, 1);
  });

  test("a roster count of zero is unknown rather than a size", () => {
    // Sleeper always reports `total_rosters` for a live league, so a 0 is a row
    // stored before the league answered — the same reading `settingValue` gives
    // this key.
    assert.equal(rowFor(league({}, { teams: 0 }), "teams"), undefined);
  });

  test("the sentinel is named, never printed as a week", () => {
    // `trade_deadline: 99` is Sleeper's "no deadline"; as a number it is a row
    // claiming this league trades until week 99.
    assert.equal(
      rowFor(league({ trade_deadline: 99 }), "trade_deadline")?.value,
      "No deadline",
    );
    assert.equal(
      rowFor(league({ trade_deadline: 12 }), "trade_deadline")?.value,
      "12",
    );
  });

  test("a key whose numbers are names reads as the name", () => {
    assert.equal(
      rowFor(league({ disable_trades: 1 }), "disable_trades")?.value,
      "Disabled",
    );
    assert.equal(
      rowFor(league({ pick_trading: 1 }), "pick_trading")?.value,
      "On",
    );
  });

  test("a key the tables name carries its label and its hint", () => {
    const row = rowFor(league({ waiver_budget: 100 }), "waiver_budget");
    assert.equal(row?.label, "FAAB budget");
    assert.equal(row?.value, "100");
    assert.equal(typeof row?.title, "string");
  });

  test("a key nothing names is still printed, and claims no description", () => {
    // A house setting this build has never met is spelled out rather than
    // dropped for not being on a list; inventing a hint for it would be a guess
    // presented as documentation.
    const row = rowFor(league({ some_new_knob: 3 }), "some_new_knob");
    assert.equal(row?.label, "some new knob");
    assert.equal(row?.value, "3");
    assert.equal(row?.title, undefined);
  });

  test("the run below the head is in the naming table's order", () => {
    const rows = league({
      draft_rounds: 25,
      trade_deadline: 12,
      waiver_budget: 100,
    });
    assert.deepEqual(
      rows.slice(3).map((r) => r.key),
      ["trade_deadline", "waiver_budget", "draft_rounds"],
    );
  });

  test("a value that isn't a number is no row at all", () => {
    const rows = league({ league_average_match: {} as unknown as number });
    assert.equal(rowFor(rows, "league_average_match"), undefined);
  });

  test("no settings stored still says what game this is", () => {
    // The three lead rows come from the league row and the payload, so a league
    // whose blob never synced still answers the question the tab is opened for.
    assert.deepEqual(
      league(null).map((r) => r.key),
      ["teams", "type", "best_ball"],
    );
  });
});

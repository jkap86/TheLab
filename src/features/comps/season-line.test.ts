import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { draftSummary, pointsSummary, seasonCompareRows } from "./season-line.ts";

import type { CompsFieldSpecPayload, CompsSeasonRowPayload } from "./types";

const rowPayload = (
  over: Partial<CompsSeasonRowPayload> = {},
): CompsSeasonRowPayload => ({
  player_id: "1",
  season: "2025",
  name: "Someone",
  position: "WR",
  team: null,
  draft: null,
  games: 17,
  values: {},
  line: {},
  ...over,
});

const spec = (
  key: string,
  over: Partial<CompsFieldSpecPayload> = {},
): CompsFieldSpecPayload => ({
  key,
  field: key,
  window: "season",
  label: key,
  family: "production",
  weight: 100,
  per_game: true,
  pool_mean: null,
  pool_stdev: null,
  ...over,
});

describe("seasonCompareRows", () => {
  test("a stat neither season touched is dropped; a touched one stays", () => {
    const subject = rowPayload({ line: { rec: 5, pass_yd: 0, pts_ppr: 200 } });
    const comp = rowPayload({ line: { rec: 4, pass_yd: 0, pts_ppr: 180 } });
    const keys = seasonCompareRows([], subject, comp, "total").map((r) => r.key);
    assert.ok(keys.includes("rec"));
    assert.ok(!keys.includes("pass_yd"));
    assert.ok(keys.includes("pts_ppr"));
  });

  test("a weighted derived share renders exactly once, off values", () => {
    // tgt_share is production-family but not on `line` (a rate, not a total);
    // the line loop must skip it or the table draws an empty duplicate row
    // beside the real one from the extras loop.
    const subject = rowPayload({ line: { rec: 5 }, values: { tgt_share: 24.5 } });
    const comp = rowPayload({ line: { rec: 4 }, values: { tgt_share: 22 } });
    const rows = seasonCompareRows(
      [spec("tgt_share", { per_game: false, weight: 80, pool_mean: 18 })],
      subject,
      comp,
      "per_game",
    );
    const shares = rows.filter((r) => r.key === "tgt_share");
    assert.equal(shares.length, 1);
    assert.equal(shares[0].subject, 24.5);
    assert.equal(shares[0].comp, 22);
    // Already a rate: the basis must not mark it per-game.
    assert.equal(shares[0].perGame, false);
  });

  test("a weighted field never vanishes, even at zero on both sides", () => {
    const subject = rowPayload({ line: { rush_yd: 0 }, values: { rush_yd: 0 } });
    const comp = rowPayload({ line: { rush_yd: 0 }, values: { rush_yd: 0 } });
    const rows = seasonCompareRows(
      [spec("rush_yd", { weight: 60, pool_mean: 12.5 })],
      subject,
      comp,
      "total",
    );
    const rushRow = rows.find((r) => r.key === "rush_yd");
    assert.equal(rushRow?.weight, 60);
    assert.equal(rushRow?.poolMean, 12.5);
  });

  test("weighted profile and market fields follow the line", () => {
    const subject = rowPayload({
      line: { rec: 5 },
      values: { age: 24.5, ktc_sf: 9000 },
    });
    const comp = rowPayload({
      line: { rec: 4 },
      values: { age: 23.9, ktc_sf: null },
    });
    const rows = seasonCompareRows(
      [
        spec("age", { family: "profile", per_game: false, weight: 60 }),
        spec("ktc_sf", { family: "market", per_game: false, weight: 40 }),
      ],
      subject,
      comp,
      "total",
    );
    const keys = rows.map((r) => r.key);
    // Production first, then points, then the extras — a fixed reading order.
    assert.deepEqual(keys, ["rec", "age", "ktc_sf"]);
    assert.equal(rows.at(-1)?.comp, null);
  });

  test("an unweighted line row carries no weight and no pool mean", () => {
    const rows = seasonCompareRows(
      [],
      rowPayload({ line: { rec: 5 } }),
      rowPayload({ line: { rec: 4 } }),
      "total",
    );
    assert.equal(rows[0].weight, null);
    assert.equal(rows[0].poolMean, null);
  });

  test("perGame follows the basis for line rows and the field for extras", () => {
    const subject = rowPayload({ line: { rec: 5 }, values: { age: 24 } });
    const comp = rowPayload({ line: { rec: 4 }, values: { age: 25 } });
    const fields = [spec("age", { family: "profile", per_game: false })];
    const perGame = seasonCompareRows(fields, subject, comp, "per_game");
    assert.equal(perGame.find((r) => r.key === "rec")?.perGame, true);
    assert.equal(perGame.find((r) => r.key === "age")?.perGame, false);
    const total = seasonCompareRows(fields, subject, comp, "total");
    assert.equal(total.find((r) => r.key === "rec")?.perGame, false);
  });
});

describe("pointsSummary", () => {
  test("names the basis it was read under", () => {
    const row = rowPayload({ line: { pts_ppr: 265.4 } });
    assert.equal(pointsSummary(row, "total"), "265.4 PPR pts");
    assert.equal(pointsSummary(row, "per_game"), "265.4 PPR/g");
  });

  test("a missing reading is null, never zero", () => {
    assert.equal(pointsSummary(rowPayload(), "total"), null);
    assert.equal(
      pointsSummary(rowPayload({ line: { pts_ppr: null } }), "per_game"),
      null,
    );
  });
});

describe("seasonCompareRows with windows", () => {
  test("a windowed field is its own row, labelled with the stretch it covers", () => {
    // The line is always the anchor season, so a field weighted over three
    // years is a different number that happens to share a name — folding the
    // two together would put the weight on a number the distance never read.
    const subject = rowPayload({
      line: { rec_tgt: 100 },
      values: { "rec_tgt@prev3": 78 },
    });
    const comp = rowPayload({
      line: { rec_tgt: 90 },
      values: { "rec_tgt@prev3": 81 },
    });
    const rows = seasonCompareRows(
      [spec("rec_tgt@prev3", { field: "rec_tgt", window: "prev3" })],
      subject,
      comp,
      "total",
    );

    const line = rows.find((r) => r.key === "rec_tgt")!;
    assert.equal(line.weight, null, "the season's own row carries no weight");
    assert.equal(line.subject, 100);

    const windowed = rows.find((r) => r.key === "rec_tgt@prev3")!;
    assert.equal(windowed.label, "Targets · prev 3 yrs");
    assert.equal(windowed.weight, 100);
    assert.equal(windowed.subject, 78);
    assert.equal(windowed.comp, 81);
  });
});

describe("draftSummary", () => {
  const withDraft = (
    draft: CompsSeasonRowPayload["draft"],
  ): CompsSeasonRowPayload => rowPayload({ draft });

  test("a placed pick reads as the pick, with the long form on the hover", () => {
    const summary = draftSummary(
      withDraft({ season: "2020", round: 1, slot: 5, overall: 5 }),
    );
    assert.equal(summary?.short, "Drafted 1.05");
    assert.match(summary?.full ?? "", /Round 1, pick 5/);
    assert.match(summary?.full ?? "", /2020/);
  });

  /**
   * On a comps row an undrafted player is a *finding*, not a gap — a reader
   * looking at an undrafted breakout is looking at the thing that makes the
   * comp interesting — so it is said out loud.
   */
  test("undrafted is stated, and names its class on the hover", () => {
    const summary = draftSummary(
      withDraft({ season: "2017", round: null, slot: null, overall: null }),
    );
    assert.equal(summary?.short, "Undrafted");
    assert.match(summary?.full ?? "", /undrafted in 2017/);
  });

  /**
   * The one wrong answer here that would read as a working one. This app has no
   * draft record for part of the archive, and labelling those players undrafted
   * would invent a fact about every one of them.
   */
  test("no record draws nothing, and never reads as undrafted", () => {
    assert.equal(draftSummary(withDraft(null)), null);
  });

  test("a round with no slot names the round rather than inventing one", () => {
    const summary = draftSummary(
      withDraft({ season: "2013", round: 3, slot: null, overall: 80 }),
    );
    assert.equal(summary?.short, "Drafted Rd 3");
    assert.match(summary?.full ?? "", /Round 3 \(#80 overall\)/);
  });

  /**
   * The row already carries a season — the *stat* season — so the draft class
   * stays on the hover. Two four-digit years a few pixels apart meaning
   * different things is worse than one of them being a hover away.
   */
  test("the short form carries no year, since the row already shows one", () => {
    const summary = draftSummary(
      withDraft({ season: "2020", round: 1, slot: 5, overall: 5 }),
    );
    assert.doesNotMatch(summary?.short ?? "", /20\d\d/);
  });
});

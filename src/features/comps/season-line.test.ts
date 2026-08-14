import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pointsSummary, seasonCompareRows } from "./season-line.ts";

import type { CompsFieldSpecPayload, CompsSeasonRowPayload } from "./types";

const rowPayload = (
  over: Partial<CompsSeasonRowPayload> = {},
): CompsSeasonRowPayload => ({
  player_id: "1",
  season: "2025",
  name: "Someone",
  position: "WR",
  team: null,
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

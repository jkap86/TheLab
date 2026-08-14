import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ageAtSeasonStart, assemblePoolRows, seasonLine } from "./assemble.ts";

import type {
  CompsProfileInput,
  CompsStatLineInput,
} from "./assemble.ts";

const line = (
  player_id: string,
  stats: Record<string, number> | null,
  week = 1,
  team: string | null = null,
): CompsStatLineInput => ({ player_id, week, team, stats });

const profile = (over: Partial<CompsProfileInput> = {}): CompsProfileInput => ({
  name: "Some Player",
  position: "WR",
  team: "PHI",
  birth_date: null,
  ...over,
});

const assemble = (
  over: Partial<Parameters<typeof assemblePoolRows>[0]> = {},
) =>
  assemblePoolRows({
    statLines: [],
    profiles: {},
    ktc: {},
    ktcHistory: {},
    adp: new Map(),
    season: "2025",
    ...over,
  });

describe("ageAtSeasonStart", () => {
  test("decimal years to the season's Sept 1", () => {
    // 2000-09-01 → 2024-09-01 is 8,766 days — exactly 24 × 365.25.
    assert.equal(ageAtSeasonStart("2000-09-01", "2024"), 24);
    const age = ageAtSeasonStart("2001-03-01", "2025");
    assert.ok(age !== null && age > 24.4 && age < 24.6);
  });

  test("null, junk and future dates read as unknown", () => {
    assert.equal(ageAtSeasonStart(null, "2025"), null);
    assert.equal(ageAtSeasonStart("not-a-date", "2025"), null);
    assert.equal(ageAtSeasonStart("2026-01-01", "2025"), null);
  });
});

describe("assemblePoolRows", () => {
  test("a stored row is a game — an all-zero line still counts", () => {
    // The invariant the games count rests on: `hasStatLine` stores a row iff
    // the game was played, so a dressed-and-did-nothing week (gp, no events)
    // is a real game with a real zero line, not an absence.
    const rows = assemble({
      statLines: [
        line("1", { rec: 5, rec_yd: 60 }),
        line("1", { gp: 1 }),
        line("1", null),
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].games, 3);
    assert.equal(rows[0].values.rec, 5);
  });

  test("totals sum across weeks and absent production keys fold to 0", () => {
    const rows = assemble({
      statLines: [
        line("1", { rec: 5, rec_yd: 60.5, rec_tgt: 8 }),
        line("1", { rec: 3, rec_yd: 39.5 }),
      ],
    });
    const values = rows[0].values;
    assert.equal(values.rec, 8);
    assert.equal(values.rec_yd, 100);
    assert.equal(values.rec_tgt, 8);
    // Never weighted in, never seen: still a real 0, not null.
    assert.equal(values.pass_yd, 0);
    assert.equal(values.fum_lost, 0);
  });

  test("non-catalogue and non-numeric stats are ignored", () => {
    const rows = assemble({
      statLines: [
        line("1", {
          rec: 4,
          pts_ppr: 24.5,
          adp_dd_ppr: 3,
          rec_yd: "60" as unknown as number,
        }),
      ],
    });
    assert.equal(rows[0].values.rec, 4);
    assert.equal(rows[0].values.rec_yd, 0);
    assert.equal(rows[0].values.pts_ppr, undefined);
  });

  test("profile joins identity and age; a missing profile degrades honestly", () => {
    const rows = assemble({
      statLines: [line("1", { rec: 1 }), line("2", { rec: 1 })],
      profiles: {
        "1": profile({ name: "Ja'Marr Chase", birth_date: "2000-03-01" }),
      },
    });
    const known = rows.find((r) => r.player_id === "1");
    const unknown = rows.find((r) => r.player_id === "2");
    assert.equal(known?.name, "Ja'Marr Chase");
    assert.equal(known?.position, "WR");
    assert.ok(known?.values.age !== null);
    assert.equal(unknown?.name, "2");
    assert.equal(unknown?.position, null);
    assert.equal(unknown?.values.age, null);
  });

  test("market values join by id and absence is null, never zero", () => {
    const rows = assemble({
      statLines: [line("1", { rec: 1 }), line("2", { rec: 1 })],
      ktc: { "1": { sf: 9000, oneqb: null } },
      adp: new Map([
        ["1", { redraft: { adp: 12.5 }, dynasty: null }],
      ]),
    });
    const priced = rows.find((r) => r.player_id === "1")!.values;
    assert.equal(priced.ktc_sf, 9000);
    assert.equal(priced.ktc_oneqb, null);
    assert.equal(priced.adp_redraft, 12.5);
    assert.equal(priced.adp_dynasty, null);

    const unpriced = rows.find((r) => r.player_id === "2")!.values;
    assert.equal(unpriced.ktc_sf, null);
    assert.equal(unpriced.adp_redraft, null);
  });

  test("rows carry the season they were assembled for", () => {
    const rows = assemble({
      statLines: [line("1", { rec: 1 })],
      season: "2024",
    });
    assert.equal(rows[0].season, "2024");
  });

  test("summed floats are rounded rather than leaking binary noise", () => {
    const rows = assemble({
      statLines: [line("1", { rec_yd: 0.1 }), line("1", { rec_yd: 0.2 })],
    });
    assert.equal(rows[0].values.rec_yd, 0.3);
  });

  test("fantasy points total across weeks, per scoring, and never score", () => {
    const rows = assemble({
      statLines: [
        line("1", { rec: 5, pts_ppr: 20.5, pts_half_ppr: 18, pts_std: 15.5 }),
        line("1", { rec: 3, pts_ppr: 10.5, pts_half_ppr: 9, pts_std: 7.5 }),
      ],
    });
    assert.deepEqual(rows[0].points, { ppr: 31, half_ppr: 27, std: 23 });
    // The points keys stay out of `values` — a KNN field they are not.
    assert.equal(rows[0].values.pts_ppr, undefined);
  });

  test("a usage share is the player's count over his team-week totals", () => {
    const rows = assemble({
      statLines: [
        line("1", { rec_tgt: 8, rush_att: 1 }, 1, "PHI"),
        line("2", { rec_tgt: 2, rush_att: 19 }, 1, "PHI"),
      ],
    });
    const a = rows.find((r) => r.player_id === "1")!.values;
    const b = rows.find((r) => r.player_id === "2")!.values;
    assert.equal(a.tgt_share, 80);
    assert.equal(b.tgt_share, 20);
    assert.equal(a.rush_share, 5);
    assert.equal(b.rush_share, 95);
  });

  test("a traded player's share reads each half against the right offense", () => {
    // 8 of 10 on PHI, then 2 of 8 on DAL: 10 of 18 overall — the denominators
    // are the team-weeks he appeared in, not either team's whole season.
    const rows = assemble({
      statLines: [
        line("1", { rec_tgt: 8 }, 1, "PHI"),
        line("2", { rec_tgt: 2 }, 1, "PHI"),
        line("1", { rec_tgt: 2 }, 2, "DAL"),
        line("3", { rec_tgt: 6 }, 2, "DAL"),
        // A PHI week he wasn't there for must not enter his denominator.
        line("2", { rec_tgt: 12 }, 2, "PHI"),
      ],
    });
    const traded = rows.find((r) => r.player_id === "1")!.values;
    assert.equal(traded.tgt_share, Math.round((10 / 18) * 10000) / 100);
  });

  test("no team attribution means no share — and no denominator means no share", () => {
    const rows = assemble({
      statLines: [
        // No line names a team: nothing can be attributed.
        line("1", { rec_tgt: 8 }, 1, null),
        // Attributed, but nobody on the team has the key that week — a feed
        // without targets must not read as everyone commanding 0%.
        line("2", { rec: 4 }, 1, "PHI"),
      ],
    });
    assert.equal(rows.find((r) => r.player_id === "1")!.values.tgt_share, null);
    assert.equal(rows.find((r) => r.player_id === "2")!.values.tgt_share, null);
  });

  test("an attributed zero against a live denominator is a real 0% share", () => {
    const rows = assemble({
      statLines: [
        line("1", { rec_tgt: 0 }, 1, "PHI"),
        line("2", { rec_tgt: 10 }, 1, "PHI"),
      ],
    });
    assert.equal(rows.find((r) => r.player_id === "1")!.values.tgt_share, 0);
  });

  test("KTC history joins by id and absence is null, never zero", () => {
    const rows = assemble({
      statLines: [line("1", { rec: 1 }), line("2", { rec: 1 })],
      ktcHistory: { "1": { peak: 9500, trend: -400 } },
    });
    const known = rows.find((r) => r.player_id === "1")!.values;
    assert.equal(known.ktc_peak_sf, 9500);
    assert.equal(known.ktc_trend_sf, -400);
    const unknown = rows.find((r) => r.player_id === "2")!.values;
    assert.equal(unknown.ktc_peak_sf, null);
    assert.equal(unknown.ktc_trend_sf, null);
  });
});

describe("seasonLine", () => {
  const row = assemblePoolRows({
    statLines: [
      line("1", { rec: 5, rec_yd: 60, pts_ppr: 16.5 }, 1, "CIN"),
      line("1", { rec: 3, rec_yd: 40, pts_ppr: 8.5 }, 2, "CIN"),
    ],
    profiles: {},
    ktc: {},
    ktcHistory: {},
    adp: new Map(),
    season: "2025",
  })[0];

  test("carries every production key plus the three point totals", () => {
    const total = seasonLine(row, "total");
    assert.equal(total.rec, 8);
    assert.equal(total.rec_yd, 100);
    assert.equal(total.pass_yd, 0);
    assert.equal(total.pts_ppr, 25);
    assert.equal(total.pts_half_ppr, 0);
    assert.equal(total.pts_std, 0);
  });

  test("resolves under the basis exactly as the weighted fields do", () => {
    const perGame = seasonLine(row, "per_game");
    assert.equal(perGame.rec, 4);
    assert.equal(perGame.rec_yd, 50);
    assert.equal(perGame.pts_ppr, 12.5);
  });

  test("a zero-game season has no per-game reading", () => {
    const empty = { ...row, games: 0 };
    assert.equal(seasonLine(empty, "per_game").rec, null);
    assert.equal(seasonLine(empty, "total").rec, 8);
  });

  test("the derived shares stay off the line — a rate is not a season total", () => {
    // They reach the reader on `values` when weighted, like the profile and
    // market fields; on the line they would be divided by games under the
    // per-game basis, which is nonsense for something already a rate.
    assert.equal(seasonLine(row, "total").tgt_share, undefined);
    assert.equal(seasonLine(row, "per_game").tgt_share, undefined);
  });
});

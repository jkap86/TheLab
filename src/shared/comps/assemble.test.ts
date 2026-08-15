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

  /**
   * The three-way distinction the draft field rests on, asserted where it is
   * actually folded into a number. Drafted and undrafted are both *values* and
   * must differ; unknown is null and must not collapse onto either — a player
   * the crosswalk has never heard of is not an undrafted one.
   */
  test("draft capital: drafted, undrafted and unknown are three answers", () => {
    const rows = assemble({
      statLines: [
        line("1", { rec: 1 }),
        line("2", { rec: 1 }),
        line("3", { rec: 1 }),
      ],
      draft: new Map([
        ["1", { season: "2020", round: 1, slot: 1, overall: 1 }],
        ["2", { season: "2017", round: null, slot: null, overall: null }],
      ]),
    });
    const at = (id: string) => rows.find((r) => r.player_id === id)!;

    const first = at("1").values.draft_capital;
    const udfa = at("2").values.draft_capital;

    assert.ok(typeof first === "number" && first > 0);
    assert.ok(typeof udfa === "number" && udfa > 0);
    assert.ok(first > udfa, "a 1.01 outranks an undrafted player");
    assert.equal(at("3").values.draft_capital, null, "unknown is null");
  });

  test("the pick itself rides the row, so a comp can print it", () => {
    const rows = assemble({
      statLines: [line("1", { rec: 1 }), line("2", { rec: 1 })],
      draft: new Map([["1", { season: "2020", round: 1, slot: 5, overall: 5 }]]),
    });
    assert.deepEqual(rows.find((r) => r.player_id === "1")?.draft, {
      season: "2020",
      round: 1,
      slot: 5,
      overall: 5,
    });
    assert.equal(rows.find((r) => r.player_id === "2")?.draft, null);
  });

  test("no draft input at all degrades to unknown rather than throwing", () => {
    const rows = assemble({ statLines: [line("1", { rec: 1 })] });
    assert.equal(rows[0].values.draft_capital, null);
    assert.equal(rows[0].draft, null);
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

  test("snaps are gated on the season's vocabulary, like every unverified key", () => {
    // The whole reason the snap fields could ship at all: nothing in the repo
    // pins `off_snp`, so a season whose feed never mentions it answers null
    // for everyone rather than reporting that nobody played a snap.
    const without = assemble({ statLines: [line("1", { rec_tgt: 8 })] });
    assert.equal(without[0].values.off_snp, null);
    assert.equal(without[0].values.snap_pct, null);
    assert.equal(without[0].values.tgt_per_snap, null);

    // One line carrying it is proof the season publishes it — and a player
    // without it is then a real zero, the absent-is-zero production rule.
    const with_ = assemble({
      statLines: [
        line("1", { rec_tgt: 8, off_snp: 40 }),
        line("2", { rec_tgt: 1 }),
      ],
    });
    assert.equal(with_.find((r) => r.player_id === "1")!.values.off_snp, 40);
    assert.equal(with_.find((r) => r.player_id === "2")!.values.off_snp, 0);
  });

  test("snap share is the player's snaps over his team's, off the same lines", () => {
    const rows = assemble({
      statLines: [
        line("1", { off_snp: 45, tm_off_snp: 60 }),
        line("1", { off_snp: 15, tm_off_snp: 60 }),
      ],
    });
    // 60 of 120 — read off the lines themselves, so no teammate's row is
    // needed and a traded player is exact on both sides of the move.
    assert.equal(rows[0].values.snap_pct, 50);
    assert.deepEqual(rows[0].rates?.snap_pct, { n: 6000, d: 120 });
  });

  test("a snap share needs its own denominator, not just snaps", () => {
    // `tm_off_snp` is the key no field is named after, so it needs the gate
    // as much as the numerator does: snaps with no team snaps published is a
    // share nobody can take.
    const rows = assemble({ statLines: [line("1", { off_snp: 45 })] });
    assert.equal(rows[0].values.off_snp, 45);
    assert.equal(rows[0].values.snap_pct, null);
  });

  test("targets per snap counts only the weeks its denominator can speak for", () => {
    // Week 2 carries targets and no snap count: counting those targets over
    // week 1's snaps alone would inflate the rate. The rule the usage shares
    // already keep by pairing on team-weeks.
    const rows = assemble({
      statLines: [
        line("1", { rec_tgt: 10, off_snp: 50 }, 1),
        line("1", { rec_tgt: 6 }, 2),
      ],
    });
    assert.equal(rows[0].values.tgt_per_snap, 0.2);
    assert.deepEqual(rows[0].rates?.tgt_per_snap, { n: 10, d: 50 });
  });

  test("every derived rate carries components that reproduce its own value", () => {
    // The agreement windows rest on: pooling is Σn / Σd whatever the rate is,
    // which only works while `n / d` *is* the value on every one of them.
    const rows = assemble({
      statLines: [
        line("1", { rec_tgt: 8, rush_att: 4, off_snp: 40, tm_off_snp: 64 }, 1, "PHI"),
        line("2", { rec_tgt: 2, rush_att: 6 }, 1, "PHI"),
      ],
    });
    const row = rows.find((r) => r.player_id === "1")!;
    for (const [key, parts] of Object.entries(row.rates ?? {})) {
      assert.equal(
        Math.round((parts.n / parts.d) * 100) / 100,
        row.values[key],
        `${key} components disagree with its value`,
      );
    }
    assert.deepEqual(Object.keys(row.rates ?? {}).sort(), [
      "rush_share",
      "snap_pct",
      "tgt_per_snap",
      "tgt_share",
    ]);
  });

  test("a rate that can't be taken leaves no components behind", () => {
    // Null is unknown, and a component pair for an unknown rate would let a
    // window pool a number the season never answered.
    const rows = assemble({ statLines: [line("1", { rec_tgt: 8 })] });
    assert.equal(rows[0].values.tgt_share, null);
    assert.equal(rows[0].rates?.tgt_share, undefined);
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

  test("a gated key inside the season's vocabulary reads absent-as-zero", () => {
    // One line carrying rec_air_yd proves the feed publishes it this season,
    // so a player without it is a real 0 — the ordinary production rule.
    const rows = assemble({
      statLines: [
        line("1", { rec_air_yd: 80 }, 1),
        line("1", { rec_air_yd: 72.5 }, 2),
        line("2", { rec: 4 }, 1),
      ],
    });
    assert.equal(rows.find((r) => r.player_id === "1")!.values.rec_air_yd, 152.5);
    assert.equal(rows.find((r) => r.player_id === "2")!.values.rec_air_yd, 0);
  });

  test("a gated key outside the vocabulary is null for everyone", () => {
    // No line all season mentions the key: the feed doesn't publish it there
    // (or the key's spelling is wrong), and either way zero would be a lie.
    const rows = assemble({
      statLines: [line("1", { rec: 4, rec_yd: 60 }), line("2", { rec: 2 })],
    });
    assert.equal(rows.find((r) => r.player_id === "1")!.values.rec_air_yd, null);
    assert.equal(rows.find((r) => r.player_id === "2")!.values.pass_air_yd, null);
    // The ungated keys keep the plain absent-is-zero reading beside them.
    assert.equal(rows.find((r) => r.player_id === "2")!.values.rec_yd, 0);
  });

  test("an explicit zero opens the gate — present is present", () => {
    const rows = assemble({
      statLines: [line("1", { rec_air_yd: 0 }), line("2", { rec: 2 })],
    });
    assert.equal(rows.find((r) => r.player_id === "1")!.values.rec_air_yd, 0);
    assert.equal(rows.find((r) => r.player_id === "2")!.values.rec_air_yd, 0);
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

  test("a closed-gate field is null on the line too, never 'Air yards 0'", () => {
    // The row above was assembled from lines with no rec_air_yd anywhere.
    assert.equal(seasonLine(row, "total").rec_air_yd, null);
    assert.equal(seasonLine(row, "per_game").rec_air_yd, null);
  });

  test("an open-gate field resolves under the basis like any other total", () => {
    const open = assemblePoolRows({
      statLines: [
        line("1", { rec_air_yd: 90 }, 1),
        line("1", { rec_air_yd: 60 }, 2),
      ],
      profiles: {},
      ktc: {},
      ktcHistory: {},
      adp: new Map(),
      season: "2025",
    })[0];
    assert.equal(seasonLine(open, "total").rec_air_yd, 150);
    assert.equal(seasonLine(open, "per_game").rec_air_yd, 75);
  });

  test("the derived shares stay off the line — a rate is not a season total", () => {
    // They reach the reader on `values` when weighted, like the profile and
    // market fields; on the line they would be divided by games under the
    // per-game basis, which is nonsense for something already a rate.
    assert.equal(seasonLine(row, "total").tgt_share, undefined);
    assert.equal(seasonLine(row, "per_game").tgt_share, undefined);
  });
});

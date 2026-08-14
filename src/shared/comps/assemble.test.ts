import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ageAtSeasonStart, assemblePoolRows } from "./assemble.ts";

import type {
  CompsProfileInput,
  CompsStatLineInput,
} from "./assemble.ts";

const line = (
  player_id: string,
  stats: Record<string, number> | null,
): CompsStatLineInput => ({ player_id, stats });

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
});

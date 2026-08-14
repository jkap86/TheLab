import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  compsSeasonAnchor,
  resolveCompsFields,
  resolveSubjectPosition,
  resolveSubjectSeason,
} from "./resolve.ts";

import type { CompsPoolRow } from "./knn.ts";

const subject = (values: CompsPoolRow["values"], games = 17): CompsPoolRow => ({
  player_id: "s",
  season: "2025",
  name: "Subject",
  position: "WR",
  team: null,
  games,
  values,
});

describe("compsSeasonAnchor", () => {
  test("a past season anchors on its own Sept 1", () => {
    assert.equal(compsSeasonAnchor("2025", "2026-08-14"), "2025-09-01");
  });

  test("the current season before Sept 1 anchors on today", () => {
    assert.equal(compsSeasonAnchor("2026", "2026-08-14"), "2026-08-14");
  });

  test("on Sept 1 the two agree", () => {
    assert.equal(compsSeasonAnchor("2026", "2026-09-01"), "2026-09-01");
  });

  test("after Sept 1 the season's own boundary wins", () => {
    assert.equal(compsSeasonAnchor("2026", "2026-11-20"), "2026-09-01");
  });
});

describe("resolveSubjectSeason", () => {
  test("an explicit season must have stored stats", () => {
    assert.deepEqual(resolveSubjectSeason("2025", ["2024", "2025"]), {
      ok: true,
      season: "2025",
    });
    const refused = resolveSubjectSeason("2023", ["2024", "2025"]);
    assert.ok(!refused.ok);
    assert.equal(refused.code, "COMPS_NO_SEASON");
    assert.match(refused.error, /2023/);
  });

  test("no request means the latest stored season, whatever the order", () => {
    assert.deepEqual(resolveSubjectSeason(null, ["2025", "2024"]), {
      ok: true,
      season: "2025",
    });
    assert.deepEqual(resolveSubjectSeason(null, ["2024", "2025"]), {
      ok: true,
      season: "2025",
    });
  });

  test("a player with no stored seasons refuses", () => {
    const refused = resolveSubjectSeason(null, []);
    assert.ok(!refused.ok);
    assert.equal(refused.code, "COMPS_NO_SEASON");
  });
});

describe("resolveSubjectPosition", () => {
  test("supported positions pass through", () => {
    assert.deepEqual(resolveSubjectPosition("TE"), { ok: true, position: "TE" });
  });

  test("null and unsupported positions refuse with the named code", () => {
    for (const position of [null, "K", "DEF", "LB"]) {
      const refused = resolveSubjectPosition(position);
      assert.ok(!refused.ok);
      assert.equal(refused.code, "COMPS_UNSUPPORTED_POSITION");
    }
  });
});

describe("resolveCompsFields", () => {
  test("null explicit fields resolve to the position's defaults", () => {
    const resolved = resolveCompsFields({
      explicit: null,
      position: "WR",
      subject: subject({ rec_tgt: 100, rec: 80, rec_yd: 1200, rec_td: 9, age: 24 }),
      basis: "total",
    });
    assert.ok(resolved.ok);
    assert.ok(resolved.fields.some((f) => f.key === "rec_tgt"));
    assert.ok(resolved.fields.every((f) => f.weight > 0));
    assert.deepEqual(resolved.dropped, []);
  });

  test("explicit fields keep their weights and perGame comes from the catalogue", () => {
    const resolved = resolveCompsFields({
      explicit: [
        { key: "rec_yd", weight: 70 },
        { key: "age", weight: 30 },
      ],
      position: "WR",
      subject: subject({ rec_yd: 1200, age: 24 }),
      basis: "total",
    });
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.fields, [
      { key: "rec_yd", weight: 70, perGame: true },
      { key: "age", weight: 30, perGame: false },
    ]);
  });

  test("a subject-missing field is dropped and reported, never a 400", () => {
    const resolved = resolveCompsFields({
      explicit: [
        { key: "rec_yd", weight: 100 },
        { key: "ktc_sf", weight: 40 },
      ],
      position: "WR",
      subject: subject({ rec_yd: 1200, ktc_sf: null }),
      basis: "total",
    });
    assert.ok(resolved.ok);
    assert.deepEqual(
      resolved.fields.map((f) => f.key),
      ["rec_yd"],
    );
    assert.deepEqual(resolved.dropped, ["ktc_sf"]);
  });

  test("a subject answering nothing refuses with the named code", () => {
    const resolved = resolveCompsFields({
      explicit: [{ key: "ktc_sf", weight: 40 }],
      position: "WR",
      subject: subject({ ktc_sf: null }),
      basis: "total",
    });
    assert.ok(!resolved.ok);
    assert.equal(resolved.code, "COMPS_NO_FIELDS");
  });

  test("a zero-game subject drops per-game production under the per_game basis", () => {
    // The parser can't see games; this is where that read has to land.
    const resolved = resolveCompsFields({
      explicit: [
        { key: "rec_yd", weight: 100 },
        { key: "age", weight: 50 },
      ],
      position: "WR",
      subject: subject({ rec_yd: 0, age: 24 }, 0),
      basis: "per_game",
    });
    assert.ok(resolved.ok);
    assert.deepEqual(
      resolved.fields.map((f) => f.key),
      ["age"],
    );
    assert.deepEqual(resolved.dropped, ["rec_yd"]);
  });
});

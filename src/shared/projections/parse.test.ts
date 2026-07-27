import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hasProjection, toProjectionRows } from "./parse.ts";
import type { SleeperProjection } from "../sleeper/types.ts";

/**
 * Roughly a tenth of a weekly response is real; the rest are placeholders for
 * players with no game. Getting that filter wrong either stores ~8,500 rows of
 * nulls per week (which read as projected zeroes) or drops real projections, so
 * the boundary cases are pinned here.
 */

const entry = (over: Partial<SleeperProjection> = {}): SleeperProjection => ({
  player_id: "4881",
  season: "2025",
  week: 1,
  season_type: "regular",
  category: "proj",
  company: "rotowire",
  team: "BAL",
  opponent: "BUF",
  game_id: "202510107",
  date: "2025-09-07",
  last_modified: 1759765502563,
  stats: { pts_ppr: 25.07, pts_half_ppr: 25.07, pts_std: 25.07, pass_yd: 228.3 },
  player: { position: "QB" },
  ...over,
});

describe("hasProjection", () => {
  test("keeps an entry tied to a game with real stats", () => {
    assert.equal(hasProjection(entry()), true);
  });

  test("drops the placeholder shape: no game, ADP only", () => {
    const placeholder = entry({
      game_id: null,
      date: null,
      team: null,
      opponent: null,
      stats: { adp_dd_ppr: 1000 },
      last_modified: null,
    });
    assert.equal(hasProjection(placeholder), false);
  });

  test("drops a scheduled game with nothing but ADP keys behind it", () => {
    // Storing this would be a row of nulls for a player who has a game, which
    // any consumer reads as "projected to score nothing".
    const empty = entry({ stats: { adp_dd_ppr: 999, pos_adp_dd_ppr: 51 } });
    assert.equal(hasProjection(empty), false);
  });

  test("drops entries with no stats object or no player id", () => {
    assert.equal(hasProjection(entry({ stats: null })), false);
    assert.equal(hasProjection(entry({ stats: {} })), false);
    assert.equal(hasProjection(entry({ player_id: "" })), false);
  });

  test("keeps a projection with no fantasy points but real stats", () => {
    // Sleeper publishes stat lines without pts_* for some IDP entries; those are
    // still projections, and a custom-scoring league can score them.
    const idp = entry({ stats: { gp: 1, tkl_solo: 4.2, sack: 0.3 } });
    assert.equal(hasProjection(idp), true);
  });
});

describe("toProjectionRows", () => {
  test("maps a projection onto its row, promoting the three scorings", () => {
    const [row] = toProjectionRows([entry()], "2025", 1);

    assert.equal(row.player_id, "4881");
    assert.equal(row.season, "2025");
    assert.equal(row.week, 1);
    assert.equal(row.company, "rotowire");
    assert.equal(row.team, "BAL");
    assert.equal(row.opponent, "BUF");
    assert.equal(row.game_id, "202510107");
    assert.equal(row.game_date, "2025-09-07");
    assert.equal(row.pts_ppr, 25.07);
    assert.equal(row.pts_half_ppr, 25.07);
    assert.equal(row.pts_std, 25.07);
    assert.deepEqual(row.stats, entry().stats);
    assert.equal(row.source_updated_at?.getTime(), 1759765502563);
  });

  test("stamps the requested season and week, not the echoed ones", () => {
    // An unknown week comes back 200 with the week echoed into every entry, so
    // trusting the payload would file placeholder junk under a plausible week.
    const [row] = toProjectionRows([entry({ season: "9999", week: 99 })], "2025", 3);
    assert.equal(row.season, "2025");
    assert.equal(row.week, 3);
  });

  test("nulls a non-numeric points value rather than storing it", () => {
    const [row] = toProjectionRows(
      [entry({ stats: { pts_ppr: "12.5" as unknown as number, rush_yd: 40 } })],
      "2025",
      1,
    );
    assert.equal(row.pts_ppr, null);
    assert.equal(row.pts_std, null);
  });

  test("drops placeholders", () => {
    const rows = toProjectionRows(
      [entry(), entry({ player_id: "9999", game_id: null, stats: { adp_dd_ppr: 1000 } })],
      "2025",
      1,
    );
    assert.deepEqual(
      rows.map((r) => r.player_id),
      ["4881"],
    );
  });

  test("keeps one row per player, the most recently revised", () => {
    // Two rows for one player would collide on (season, week, player_id) inside
    // a single upsert, which Postgres rejects — one duplicate would cost the
    // whole week.
    const rows = toProjectionRows(
      [
        entry({ company: "stale", last_modified: 1_000, stats: { pts_ppr: 1 } }),
        entry({ company: "fresh", last_modified: 2_000, stats: { pts_ppr: 2 } }),
      ],
      "2025",
      1,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].company, "fresh");
    assert.equal(rows[0].pts_ppr, 2);
  });

  test("still dedupes when neither entry carries a revision time", () => {
    const rows = toProjectionRows(
      [
        entry({ company: "first", last_modified: null }),
        entry({ company: "second", last_modified: null }),
      ],
      "2025",
      1,
    );
    assert.equal(rows.length, 1);
  });

  test("returns nothing for an all-placeholder response", () => {
    const junk = Array.from({ length: 5 }, (_, i) =>
      entry({ player_id: `p${i}`, game_id: null, stats: { adp_dd_ppr: 1000 } }),
    );
    assert.deepEqual(toProjectionRows(junk, "2025", 1), []);
  });
});

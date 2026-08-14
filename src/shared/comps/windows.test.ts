import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_WINDOWS,
  compsDimensionKey,
  compsDimensionLabel,
  compsWindow,
  isCompsWindow,
  parseCompsDimensionKey,
  withWindowValues,
} from "./windows.ts";

import type { CompsSeasonPool } from "./career.ts";
import type { CompsWindowKey } from "./windows.ts";
import type { CompsPoolRow } from "./knn.ts";

const row = (
  season: string,
  over: Partial<CompsPoolRow> = {},
): CompsPoolRow => ({
  player_id: "p",
  season,
  name: "p",
  position: "WR",
  team: null,
  games: 17,
  values: {},
  points: { ppr: 0, half_ppr: 0, std: 0 },
  ...over,
});

const pools = (rows: CompsPoolRow[]): CompsSeasonPool[] => {
  const bySeason = new Map<string, CompsPoolRow[]>();
  for (const r of rows) {
    bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);
  }
  return [...bySeason].map(([season, seasonRows]) => ({
    season,
    rows: seasonRows,
  }));
};

/** The anchor season's row after materializing one dimension. */
const read = (
  rows: CompsPoolRow[],
  anchor: string,
  key: string,
  window: CompsWindowKey,
  basis: "per_game" | "total" = "per_game",
): number | null => {
  const out = withWindowValues(pools(rows), [{ key, window }], basis);
  const enriched = out
    .find((pool) => pool.season === anchor)!
    .rows.find((r) => r.player_id === "p")!;
  return enriched.values[compsDimensionKey(key, window)] ?? null;
};

describe("the window catalogue", () => {
  test("every key resolves, and only the catalogue's keys do", () => {
    for (const window of COMPS_WINDOWS) {
      assert.equal(compsWindow(window.key)?.key, window.key);
      assert.ok(isCompsWindow(window.key));
    }
    assert.equal(compsWindow("prev4"), undefined);
    assert.ok(!isCompsWindow("last_year"));
  });

  test("only `season` reads the anchor alone; only `career_*` reach past three", () => {
    // The two halves of the naming promise, pinned against each other: what a
    // window is *called* is what it covers, which is the whole argument for
    // `prev*` being strictly prior while `career_*` includes the anchor.
    for (const window of COMPS_WINDOWS) {
      assert.equal(
        window.kind === "single",
        window.key === "season",
        `${window.key} kind`,
      );
      assert.equal(
        window.includesAnchor,
        window.key === "season" || window.key.startsWith("career"),
        `${window.key} includesAnchor`,
      );
      assert.equal(
        window.span === "career",
        window.key.startsWith("career"),
        `${window.key} span`,
      );
    }
  });
});

describe("dimension keys", () => {
  test("the default window spells as the bare field key", () => {
    // What keeps every request written before windows existed byte-for-byte
    // what it was, cache entry included.
    assert.equal(compsDimensionKey("rec_tgt", "season"), "rec_tgt");
    assert.deepEqual(parseCompsDimensionKey("rec_tgt"), {
      field: "rec_tgt",
      window: "season",
    });
  });

  test("a window round-trips through the key", () => {
    for (const window of COMPS_WINDOWS) {
      const key = compsDimensionKey("rec_tgt", window.key);
      assert.deepEqual(parseCompsDimensionKey(key), {
        field: "rec_tgt",
        window: window.key,
      });
    }
  });

  test("a key whose suffix names no window is a field, not a mislabelled one", () => {
    assert.deepEqual(parseCompsDimensionKey("rec_tgt@prev9"), {
      field: "rec_tgt@prev9",
      window: "season",
    });
  });

  test("the label carries the window, and only when there is one", () => {
    assert.equal(compsDimensionLabel("rec_tgt"), "Targets");
    assert.equal(compsDimensionLabel("rec_tgt@prev3"), "Targets · prev 3 yrs");
    assert.equal(compsDimensionLabel("snap_pct@career_best"), "Snap share % · career best");
  });
});

describe("withWindowValues", () => {
  test("a request naming no window rebuilds nothing at all", () => {
    // The common case — every default board — and the reason it is a guard
    // rather than a map that happens to write nothing: the rows come back by
    // identity, so the O(corpus) pass is genuinely skipped.
    const rows = [row("2024"), row("2025")];
    const out = withWindowValues(pools(rows), [{ key: "rec_tgt", window: "season" }], "per_game");
    assert.equal(out[0].rows[0], rows[0]);
    assert.equal(out[1].rows[0], rows[1]);
  });

  test("a pooled window is one long season, not a mean of seasons", () => {
    // 2023: 40 targets in 4 games (10/g). 2024: 80 in 16 (5/g). Pooled over
    // the two is 120/20 = 6/g — *not* 7.5, which is what averaging the two
    // rates gives and what makes a 4-game season weigh as much as a full one.
    const rows = [
      row("2023", { games: 4, values: { rec_tgt: 40 } }),
      row("2024", { games: 16, values: { rec_tgt: 80 } }),
      row("2025", { games: 17, values: { rec_tgt: 150 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "prev2"), 6);
  });

  test("the basis is applied inside the window", () => {
    const rows = [
      row("2023", { games: 4, values: { rec_tgt: 40 } }),
      row("2024", { games: 16, values: { rec_tgt: 80 } }),
      row("2025", { games: 17, values: { rec_tgt: 150 } }),
    ];
    // Totals: the two prior seasons summed, undivided.
    assert.equal(read(rows, "2025", "rec_tgt", "prev2", "total"), 120);
  });

  test("prev1 is the season before, and never the anchor", () => {
    const rows = [
      row("2024", { games: 10, values: { rec_tgt: 50 } }),
      row("2025", { games: 10, values: { rec_tgt: 90 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "prev1"), 5);
  });

  test("career_best includes the anchor and prev3_best does not", () => {
    // The one asymmetry in the set, and the reason it is not a slip: "his
    // career best" would be a lie if it excluded the season that was his best,
    // and "his previous three" would be a lie if it included this one.
    const rows = [
      row("2023", { games: 10, values: { rec_tgt: 40 } }),
      row("2024", { games: 10, values: { rec_tgt: 60 } }),
      row("2025", { games: 10, values: { rec_tgt: 100 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "career_best"), 10);
    assert.equal(read(rows, "2025", "rec_tgt", "prev3_best"), 6);
  });

  test("career_worst is the floor, anchor included", () => {
    const rows = [
      row("2024", { games: 10, values: { rec_tgt: 90 } }),
      row("2025", { games: 10, values: { rec_tgt: 20 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "career_worst"), 2);
  });

  test("no season in the span is null — the rookie rule, not a zero", () => {
    // What excludes a first-year season from a windowed comparison. A zero
    // would float exactly those players into it, which is the failure the
    // whole nullable-field discipline exists to prevent.
    const rows = [row("2025", { games: 10, values: { rec_tgt: 100 } })];
    assert.equal(read(rows, "2025", "rec_tgt", "prev1"), null);
    assert.equal(read(rows, "2025", "rec_tgt", "prev3"), null);
    assert.equal(read(rows, "2025", "rec_tgt", "prev3_best"), null);
    // Career reaches the anchor, so it answers where the prev windows can't.
    assert.equal(read(rows, "2025", "rec_tgt", "career_best"), 10);
  });

  test("a shorter career pools what it has rather than refusing", () => {
    // A second-year player's "prev 3 years" is his one prior season: honestly
    // less production over the span under totals, and the rate he actually
    // posted under per-game. Refusing would drop every young player from a
    // window most often opened to look at young players.
    const rows = [
      row("2024", { games: 10, values: { rec_tgt: 70 } }),
      row("2025", { games: 10, values: { rec_tgt: 120 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "prev3"), 7);
    assert.equal(read(rows, "2025", "rec_tgt", "prev3", "total"), 70);
  });

  test("a derived rate pools from its components, never from its seasons' rates", () => {
    // 20 of 100 targets one year, 60 of 100 the next: the pooled share is
    // 80/200 = 40%. Averaging the two seasons' shares gives the same number
    // only by coincidence, so the seasons are deliberately unequal below.
    const rows = [
      row("2023", {
        values: { tgt_share: 10 },
        rates: { tgt_share: { n: 10 * 100, d: 100 } },
      }),
      row("2024", {
        values: { tgt_share: 30 },
        rates: { tgt_share: { n: 30 * 300, d: 300 } },
      }),
      row("2025", { values: { tgt_share: 25 } }),
    ];
    // (1000 + 9000) / 400 = 25 — where the mean of 10 and 30 is 20.
    assert.equal(read(rows, "2025", "tgt_share", "prev2"), 25);
  });

  test("a row carrying no components can't pool a rate, and says so", () => {
    const rows = [
      row("2024", { values: { snap_pct: 80 } }),
      row("2025", { values: { snap_pct: 60 } }),
    ];
    assert.equal(read(rows, "2025", "snap_pct", "prev1"), null);
  });

  test("a season that can't answer the field is skipped, not counted as zero", () => {
    // A gated field outside a season's vocabulary — the 2023 feed never
    // published snaps. Pooling it as 0 would report the player off the field.
    const rows = [
      row("2023", { games: 10, values: { off_snp: null } }),
      row("2024", { games: 10, values: { off_snp: 600 } }),
      row("2025", { games: 10, values: { off_snp: 500 } }),
    ];
    assert.equal(read(rows, "2025", "off_snp", "prev3"), 60);
  });

  test("a field the catalogue reads over its own season only is never materialized", () => {
    // Pooling two seasons of KTC produces a number nobody has a name for, so
    // the parser refuses it and this refuses it again — the materialization
    // and the grammar can't disagree about which fields have windows.
    const rows = [
      row("2024", { values: { ktc_sf: 5000 } }),
      row("2025", { values: { ktc_sf: 7000 } }),
    ];
    assert.equal(read(rows, "2025", "ktc_sf", "prev1"), null);
  });

  test("a season whose label isn't a year sits on no timeline", () => {
    const rows = [
      row("preseason", { games: 10, values: { rec_tgt: 90 } }),
      row("2025", { games: 10, values: { rec_tgt: 40 } }),
    ];
    assert.equal(read(rows, "2025", "rec_tgt", "prev1"), null);
  });

  test("one player's seasons never reach another's", () => {
    const rows = [
      row("2024", { player_id: "a", games: 10, values: { rec_tgt: 100 } }),
      row("2025", { player_id: "a", games: 10, values: { rec_tgt: 20 } }),
      row("2025", { player_id: "b", games: 10, values: { rec_tgt: 20 } }),
    ];
    const out = withWindowValues(
      pools(rows),
      [{ key: "rec_tgt", window: "prev1" }],
      "per_game",
    );
    const season = out.find((pool) => pool.season === "2025")!;
    assert.equal(
      season.rows.find((r) => r.player_id === "a")!.values["rec_tgt@prev1"],
      10,
    );
    assert.equal(
      season.rows.find((r) => r.player_id === "b")!.values["rec_tgt@prev1"],
      null,
    );
  });

  test("materializing leaves the input pools untouched", () => {
    // The pools are the frozen cached ones, and a shared answer edited in
    // place is the bug that appears on the second request and never the first.
    const rows = [
      row("2024", { games: 10, values: { rec_tgt: 100 } }),
      row("2025", { games: 10, values: { rec_tgt: 20 } }),
    ];
    const input = pools(rows);
    withWindowValues(input, [{ key: "rec_tgt", window: "prev1" }], "per_game");
    assert.deepEqual(Object.keys(rows[1].values), ["rec_tgt"]);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { KnownDraftCapital } from "./draft-source.ts";
import type { PlayerRecord } from "./facts.ts";
import { buildSeasonRows, mergeSkips } from "./rows.ts";
import type { SeasonAggregate } from "./season-line.ts";

const aggregate = (over: Partial<SeasonAggregate> = {}): SeasonAggregate => ({
  player_id: "p1",
  team: "LAR",
  position: "WR",
  name: "Feed Name",
  games: 16,
  fantasy_pts: 240,
  rec: 90,
  rec_yards: 1200,
  rush_yards: 20,
  rush_att: 3,
  targets: 130,
  target_share: 26.5,
  snap_share: 88.2,
  ...over,
});

const record = (over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  player_id: "p1",
  name: "Map Name",
  position: "WR",
  birth_date: "1999-05-20",
  rookie_year: 2021,
  years_exp: 5,
  ...over,
});

const build = (
  aggregates: SeasonAggregate[],
  players: PlayerRecord[],
  over: Partial<Parameters<typeof buildSeasonRows>[0]> = {},
  draft: Record<string, KnownDraftCapital> = {},
) =>
  buildSeasonRows({
    season: 2023,
    currentSeason: 2025,
    aggregates,
    players: new Map(players.map((p) => [p.player_id, p])),
    draft: new Map(Object.entries(draft)),
    positions: ["QB", "RB", "WR", "TE"],
    minGames: 1,
    ...over,
  });

/**
 * Nothing malformed is written. Every NOT NULL column has to be answerable
 * from the two sources, and where one is not the row is skipped with a reason
 * the report counts — because the alternative is a default, and a default in
 * this table is the claim its schema spends three paragraphs refusing.
 */
describe("buildSeasonRows", () => {
  test("composes a row from the aggregate and the players map", () => {
    const built = build([aggregate()], [record()], {}, { p1: 177 });
    assert.equal(built.rows.length, 1);
    assert.deepEqual(built.rows[0], {
      player_id: "p1",
      season: 2023,
      player_name: "Map Name",
      position: "WR",
      age: 24.3,
      experience: 2,
      draft_pick: 177,
      undrafted: false,
      games: 16,
      fantasy_pts: 240,
      fantasy_ppg: 15,
      rec: 90,
      rec_yards: 1200,
      target_share: 26.5,
      rush_yards: 20,
      rush_att: 3,
      yprr: null,
      snap_share: 88.2,
    });
    assert.deepEqual(built.experience, { rookie_year: 1, years_exp: 0 });
    assert.deepEqual(built.draft, { drafted: 1, undrafted: 0, unknown: 0 });
  });

  test("draft capital is three states across two columns, and unknown is not undrafted", () => {
    // A pick beside `undrafted: true` is the state the schema's CHECK refuses,
    // and a null pick means undrafted only where the row vouches for it.
    const built = build(
      [aggregate(), aggregate({ player_id: "p2" }), aggregate({ player_id: "p3" })],
      [record(), record({ player_id: "p2" }), record({ player_id: "p3" })],
      {},
      { p1: 5, p2: "udfa" },
    );
    const byId = new Map(built.rows.map((r) => [r.player_id, r]));
    assert.deepEqual(
      [byId.get("p1")!, byId.get("p2")!, byId.get("p3")!].map((r) => [r.draft_pick, r.undrafted]),
      [
        [5, false],
        [null, true],
        [null, false],
      ],
    );
    assert.deepEqual(built.draft, { drafted: 1, undrafted: 1, unknown: 1 });
  });

  test("the position and the name come from the players map, not the feed", () => {
    // The map is what every other read in this app calls a player; a corpus
    // keyed to the feed's inline blob would classify a handful of players
    // differently from the rest of the database for no visible reason.
    const built = build(
      [aggregate({ position: "TE", name: "Feed Name" })],
      [record({ position: "WR", name: "Map Name" })],
    );
    assert.equal(built.rows[0].position, "WR");
    assert.equal(built.rows[0].player_name, "Map Name");
  });

  test("the feed's identity is a fallback where the map has none", () => {
    const built = build(
      [aggregate({ position: "TE", name: "Feed Name" })],
      [record({ position: null, name: null })],
    );
    assert.equal(built.rows[0].position, "TE");
    assert.equal(built.rows[0].player_name, "Feed Name");
  });

  test("YPRR is written null, never approximated", () => {
    // No source here publishes routes run, and a criterion the corpus cannot
    // answer narrows the comparison rather than scoring as a zero.
    assert.equal(build([aggregate()], [record()]).rows[0].yprr, null);
  });

  test("null advanced stats survive as nulls", () => {
    const built = build(
      [aggregate({ target_share: null, snap_share: null })],
      [record()],
    );
    assert.equal(built.rows[0].target_share, null);
    assert.equal(built.rows[0].snap_share, null);
  });

  test("a season with no games is not a season", () => {
    const built = build([aggregate({ games: 0 })], [record()]);
    assert.deepEqual(built.rows, []);
    assert.equal(built.skipped["no games played"], 1);
  });

  test("the activity floor is deliberately low, and is the caller's", () => {
    // The obvious shape — a top-forty corpus — makes a player who falls out of
    // the top forty next year read as having *not played*, which is exactly
    // the false outcome the corpus's did-not-play rule exists to make true.
    const marginal = aggregate({ player_id: "p2", games: 2, fantasy_pts: 6 });
    assert.equal(build([marginal], [record({ player_id: "p2" })]).rows.length, 1);
    assert.equal(
      build([marginal], [record({ player_id: "p2" })], { minGames: 5 }).rows.length,
      0,
    );
  });

  test("a position the corpus does not hold is skipped by name", () => {
    const built = build(
      [aggregate({ player_id: "k1", position: "K" })],
      [record({ player_id: "k1", position: "K" })],
    );
    assert.deepEqual(built.rows, []);
    assert.equal(built.skipped["position not loaded (K)"], 1);
  });

  test("a player the map has never heard of is skipped, not invented", () => {
    const built = build([aggregate({ player_id: "ghost" })], []);
    assert.deepEqual(built.rows, []);
    assert.equal(built.skipped["not in the players map"], 1);
  });

  test("a row whose facts cannot be resolved is skipped with the facts' own reason", () => {
    const built = build(
      [aggregate({ player_id: "a" }), aggregate({ player_id: "b" })],
      [
        record({ player_id: "a", birth_date: null }),
        record({ player_id: "b", rookie_year: null, years_exp: null }),
      ],
    );
    assert.deepEqual(built.rows, []);
    assert.equal(Object.values(built.skipped).reduce((x, y) => x + y, 0), 2);
    assert.ok(Object.keys(built.skipped).some((r) => /birth date/.test(r)));
  });

  test("counts which experience derivation each row leaned on", () => {
    // A corpus mostly built on the weaker reading should be visible rather
    // than assumed — see `./facts` on why that fallback is taken at all.
    const built = build(
      [aggregate({ player_id: "a" }), aggregate({ player_id: "b" })],
      [
        record({ player_id: "a", rookie_year: 2021 }),
        record({ player_id: "b", rookie_year: null, years_exp: 4 }),
      ],
    );
    assert.deepEqual(built.experience, { rookie_year: 1, years_exp: 1 });
  });

  test("points per game is derived from the two figures written beside it", () => {
    const built = build([aggregate({ fantasy_pts: 100, games: 8 })], [record()]);
    assert.equal(built.rows[0].fantasy_ppg, 12.5);
  });

  test("a name longer than the column is truncated rather than dropping the season", () => {
    const long = "x".repeat(400);
    const built = build([aggregate()], [record({ name: long })]);
    assert.equal(built.rows[0].player_name.length, 255);
  });

  test("rows come back in a stable order", () => {
    const built = build(
      [aggregate({ player_id: "c" }), aggregate({ player_id: "a" }), aggregate({ player_id: "b" })],
      [record({ player_id: "a" }), record({ player_id: "b" }), record({ player_id: "c" })],
    );
    assert.deepEqual(built.rows.map((r) => r.player_id), ["a", "b", "c"]);
  });
});

describe("mergeSkips", () => {
  test("adds two tallies", () => {
    const into = { "no games played": 2, "no position": 1 };
    assert.deepEqual(mergeSkips(into, { "no games played": 3, "no name": 1 }), {
      "no games played": 5,
      "no position": 1,
      "no name": 1,
    });
  });
});

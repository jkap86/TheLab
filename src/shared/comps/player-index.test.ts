import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { foldCompsPlayerIndex } from "./player-index.ts";

import type { CompsProfileInput } from "./assemble.ts";

/**
 * The picker's list, and the three things a reader would notice if it changed.
 *
 * What is *not* here is the reason this module exists — the list used to be
 * folded from the comps pools, so opening the picker assembled the whole
 * enriched corpus to print names. That claim is about which functions the read
 * calls and is pinned in `pool.test.ts`; what is left for the fold itself is
 * who it lets through and in what order, both of which the pool-derived version
 * decided too and both of which a reader depends on.
 */

const profile = (over: Partial<CompsProfileInput> = {}): CompsProfileInput => ({
  name: "Some Player",
  position: "WR",
  team: "PHI",
  birth_date: null,
  ...over,
});

const PROFILES: Record<string, CompsProfileInput> = {
  1: profile({ name: "Aaron Back", position: "RB", team: "DAL" }),
  2: profile({ name: "Zack Wideout", position: "WR", team: "PHI" }),
  3: profile({ name: "Kip Kicker", position: "K", team: "BUF" }),
  4: profile({ name: "Dee Fense", position: null }),
};

describe("foldCompsPlayerIndex", () => {
  test("a player's seasons come back newest first", () => {
    // The client reads the first as "his latest" — the season chips light index
    // 0 when nothing is chosen, and the server's own default is the latest
    // stored season. Ordered here rather than trusted from the query, so the
    // guarantee belongs to the fold.
    const [player] = foldCompsPlayerIndex(
      [
        { player_id: "1", season: "2023" },
        { player_id: "1", season: "2025" },
        { player_id: "1", season: "2024" },
      ],
      PROFILES,
    );
    assert.deepEqual(player.seasons, ["2025", "2024", "2023"]);
  });

  test("players come back alphabetically", () => {
    const players = foldCompsPlayerIndex(
      [
        { player_id: "2", season: "2025" },
        { player_id: "1", season: "2025" },
      ],
      PROFILES,
    );
    assert.deepEqual(
      players.map((p) => p.name),
      ["Aaron Back", "Zack Wideout"],
    );
  });

  test("an unsupported position is not offered", () => {
    // `COMPS_POSITIONS` is what keeps a kicker subject a hand-built-URL case
    // rather than something the UI can produce — the comps route refuses one
    // with a 400, so a row here would be a list entry that cannot be pressed.
    const players = foldCompsPlayerIndex(
      [{ player_id: "3", season: "2025" }],
      PROFILES,
    );
    assert.deepEqual(players, []);
  });

  test("a player the profiles cache doesn't know is not offered either", () => {
    // Unknown is not unsupported, but the picker offers *subjects*, and a
    // subject whose position can't be named is the same 400 wearing a row.
    const players = foldCompsPlayerIndex(
      [
        { player_id: "4", season: "2025" },
        { player_id: "999", season: "2025" },
      ],
      PROFILES,
    );
    assert.deepEqual(players, []);
  });

  test("the label is the profile's, which is where a pool row's came from too", () => {
    const [player] = foldCompsPlayerIndex(
      [{ player_id: "2", season: "2025" }],
      PROFILES,
    );
    assert.equal(player.player_id, "2");
    assert.equal(player.name, "Zack Wideout");
    assert.equal(player.position, "WR");
    assert.equal(player.team, "PHI");
  });

  test("no stats stored is an empty list, not an error", () => {
    assert.deepEqual(foldCompsPlayerIndex([], PROFILES), []);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gametimeReadout } from "./connection.ts";
import type { GametimeConnection, LeagueListState } from "./connection.ts";

const read = (
  over: Partial<Parameters<typeof gametimeReadout>[0]> = {},
) =>
  gametimeReadout({
    connection: "live",
    leagues: "ready",
    games: { pre: 0, live: 0, final: 16 },
    stale: null,
    degraded: false,
    ...over,
  });

describe("gametimeReadout", () => {
  test("nothing that is not a connection attempt reads as one", () => {
    // The whole reason this function exists: `Connecting…` was the fall-through
    // for every state two booleans could not name, including three where the
    // page is deliberately not connecting at all.
    const never: { connection: GametimeConnection; leagues: LeagueListState }[] = [
      { connection: "complete", leagues: "ready" },
      { connection: "idle", leagues: "none" },
      { connection: "idle", leagues: "loading" },
      { connection: "failed", leagues: "ready" },
      { connection: "snapshot", leagues: "ready" },
      { connection: "live", leagues: "ready" },
    ];
    for (const arm of never) {
      assert.notEqual(read(arm).text, "Connecting…", JSON.stringify(arm));
    }
    assert.equal(read({ connection: "connecting" }).text, "Connecting…");
  });

  test("a season with no week left says so, whatever else is true", () => {
    const out = read({ connection: "complete", leagues: "none", games: null });
    assert.equal(out.text, "Season complete");
    assert.equal(out.lit, false);
  });

  test("an account with no leagues says so rather than connecting", () => {
    assert.equal(read({ connection: "idle", leagues: "none" }).text, "No leagues");
  });

  test("a league list still arriving says so", () => {
    assert.equal(read({ connection: "idle", leagues: "loading" }).text, "Loading leagues…");
  });

  test("a stream that gave up names the server's reason where there is one", () => {
    assert.equal(read({ connection: "failed", stale: null }).text, "Live updates unavailable");
    assert.equal(read({ connection: "failed", stale: "Failed to load lineups" }).text, "Failed to load lineups");
  });

  test("a snapshot standing in for the stream says it is not live", () => {
    const out = read({ connection: "snapshot" });
    assert.equal(out.text, "Snapshot · not live");
    assert.equal(out.lit, false);
    assert.equal(out.pulse, false);
  });

  test("a dropped stream reads as reconnecting rather than connecting", () => {
    assert.equal(read({ connection: "reconnecting" }).text, "Reconnecting…");
  });

  test("an open stream reads the scoreboard, and only a running game pulses", () => {
    const live = read({ games: { pre: 2, live: 3, final: 1 } });
    assert.equal(live.text, "Live · 3 games in progress");
    assert.equal(live.lit, true);
    assert.equal(live.pulse, true);

    const one = read({ games: { pre: 0, live: 1, final: 0 } });
    assert.equal(one.text, "Live · 1 game in progress");

    const waiting = read({ games: { pre: 12, live: 0, final: 2 } });
    assert.equal(waiting.text, "Waiting · 12 games to come");
    assert.equal(waiting.pulse, false);

    assert.equal(read().text, "Final");
    assert.equal(read({ games: { pre: 0, live: 0, final: 0 } }).text, "No games on the board");
    assert.equal(read({ games: null }).text, "Live");
  });

  test("the room's stale note is what an open stream says", () => {
    const out = read({ stale: "Sleeper's live feeds have stopped answering" });
    assert.equal(out.text, "Sleeper's live feeds have stopped answering");
    assert.equal(out.lit, true);
    assert.equal(out.pulse, false);
  });

  test("a degraded feed is named on the pill as well as in the notes", () => {
    assert.equal(
      read({ degraded: true, games: { pre: 0, live: 4, final: 0 } }).text,
      "Degraded · 4 in progress",
    );
    assert.equal(
      read({ degraded: true, games: { pre: 9, live: 0, final: 0 } }).text,
      "Degraded · 9 to come",
    );
    assert.equal(read({ degraded: true }).text, "Degraded · final");
  });

  test("degrading and recovering move the pill without anything else changing", () => {
    const games = { pre: 0, live: 2, final: 3 };
    assert.equal(read({ games }).text, "Live · 2 games in progress");
    assert.equal(read({ games, degraded: true }).text, "Degraded · 2 in progress");
    assert.equal(read({ games }).text, "Live · 2 games in progress");
  });
});

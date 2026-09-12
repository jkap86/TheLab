import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countdownBays, countdownParts, gametimeReadout } from "./connection.ts";
import type { GametimeConnection, LeagueListState } from "./connection.ts";

const NOW = Date.UTC(2026, 8, 13, 16, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const read = (
  over: Partial<Parameters<typeof gametimeReadout>[0]> = {},
) =>
  gametimeReadout({
    connection: "live",
    leagues: "ready",
    games: { pre: 0, live: 0, final: 16 },
    nextKickoff: null,
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

describe("when the page counts down", () => {
  const kickoff = NOW + 2 * HOUR;
  const waiting = { games: { pre: 14, live: 0, final: 2 }, nextKickoff: kickoff };

  test("a quiet week with a known kickoff counts down to it, and the pill keeps its words", () => {
    // `text` is what the pill's live region announces — once — so it must not
    // be the ticking clock; the countdown is a panel of its own.
    const out = read(waiting);
    assert.equal(out.text, "Waiting · 14 games to come");
    assert.equal(out.countdownTo, kickoff);
    assert.equal(out.lit, true);
    assert.equal(out.pulse, false);
  });

  test("with no kickoff on the board there is nothing to count to", () => {
    assert.equal(read({ ...waiting, nextKickoff: null }).countdownTo, null);
  });

  test("a game in progress is the reading, even with a later window still to come", () => {
    const out = read({ ...waiting, games: { pre: 8, live: 6, final: 2 } });
    assert.equal(out.text, "Live · 6 games in progress");
    assert.equal(out.countdownTo, null);
  });

  test("a degraded or stalled page does not count down to a kickoff it may be misreading", () => {
    assert.equal(read({ ...waiting, degraded: true }).countdownTo, null);
    assert.equal(read({ ...waiting, stale: "Sleeper's live feeds have stopped answering" }).countdownTo, null);
  });

  test("a page that is not following the week has no countdown either", () => {
    for (const connection of ["snapshot", "reconnecting", "connecting", "failed", "idle"] as const) {
      assert.equal(read({ ...waiting, connection }).countdownTo, null, connection);
    }
  });

  test("a finished week counts down to nothing", () => {
    assert.equal(read({ games: { pre: 0, live: 0, final: 16 }, nextKickoff: kickoff }).countdownTo, null);
  });
});

describe("countdownParts", () => {
  test("splits the time left into days, hours, minutes and seconds", () => {
    assert.deepEqual(countdownParts(2 * DAY + 4 * HOUR + 14 * MINUTE + 5 * SECOND), {
      days: 2,
      hours: 4,
      minutes: 14,
      seconds: 5,
    });
    assert.deepEqual(countdownParts(21 * HOUR + 21 * MINUTE + 8 * SECOND), {
      days: 0,
      hours: 21,
      minutes: 21,
      seconds: 8,
    });
  });

  test("a part-second rounds up, so zero is never shown before the snap", () => {
    assert.deepEqual(countdownParts(1), { days: 0, hours: 0, minutes: 0, seconds: 1 });
    assert.deepEqual(countdownParts(59 * SECOND + 1), { days: 0, hours: 0, minutes: 1, seconds: 0 });
  });

  test("at or past zero, or unreadable, the clock has run out", () => {
    assert.equal(countdownParts(0), null);
    assert.equal(countdownParts(-5 * SECOND), null);
    assert.equal(countdownParts(Number.NaN), null);
  });
});

describe("countdownBays", () => {
  test("hours, minutes and seconds, two digits each, under a day", () => {
    assert.deepEqual(
      countdownBays({ days: 0, hours: 3, minutes: 0, seconds: 9 }).map((b) => `${b.label} ${b.value}`),
      ["Hrs 03", "Min 00", "Sec 09"],
    );
  });

  test("a days bay goes in front only where there is a day to count", () => {
    assert.deepEqual(
      countdownBays({ days: 2, hours: 4, minutes: 14, seconds: 5 }).map((b) => b.key),
      ["days", "hours", "minutes", "seconds"],
    );
    assert.equal(countdownBays({ days: 2, hours: 4, minutes: 14, seconds: 5 })[0].value, "02");
  });

  test("the instrument keeps its shape inside the last hour", () => {
    assert.deepEqual(
      countdownBays({ days: 0, hours: 0, minutes: 0, seconds: 1 }).map((b) => b.value),
      ["00", "00", "01"],
    );
  });
});

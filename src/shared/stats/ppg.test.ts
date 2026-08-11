import assert from "node:assert/strict";
import { test } from "node:test";

import { playerPpg, ppgWindow, teamPpg } from "./ppg.ts";

const PPR = { rec: 1, rec_yd: 0.1, rec_td: 6 };

test("the window is the weeks strictly before the one on screen", () => {
  assert.deepEqual(ppgWindow(5), [1, 2, 3, 4]);
  assert.deepEqual(ppgWindow(2), [1]);
});

test("week 1 has an empty window, which is what the prior season stands in for", () => {
  assert.deepEqual(ppgWindow(1), []);
  // Guarded rather than thrown on: a week out of range is a caller bug, and an
  // empty average degrades to the prior season where a throw would 500 a panel.
  assert.deepEqual(ppgWindow(0), []);
  assert.deepEqual(ppgWindow(-3), []);
});

test("the average is over games played, not weeks elapsed", () => {
  // Two weeks in a four-week window: injured for the other two.
  const ppg = playerPpg(
    [
      { week: 1, stats: { rec: 8, rec_yd: 100, rec_td: 1 } },
      { week: 3, stats: { rec: 4, rec_yd: 40, rec_td: 0 } },
    ],
    PPR,
  );

  // 24 and 8, so 16.00 a game — not 8.00, which is what dividing by the window
  // would give and would report a hurt starter as a bad player.
  assert.equal(ppg?.games, 2);
  assert.equal(ppg?.points, 32);
  assert.equal(ppg?.average, 16);
});

test("no games played is null, never zero", () => {
  assert.equal(playerPpg([], PPR), null);
});

test("a played week that scored nothing is a real zero and counts", () => {
  // Sleeper carries `gp` for a player who dressed and did nothing, so the line
  // exists and the game belongs in the denominator.
  const ppg = playerPpg(
    [
      { week: 1, stats: { rec: 10, rec_yd: 100, rec_td: 0 } },
      { week: 2, stats: { gp: 1 } },
    ],
    PPR,
  );

  assert.equal(ppg?.games, 2);
  assert.equal(ppg?.average, 10);
});

test("it scores with the league's own settings, not Sleeper's", () => {
  const half = playerPpg([{ week: 1, stats: { rec: 8, rec_yd: 80 } }], {
    rec: 0.5,
    rec_yd: 0.1,
  });
  const full = playerPpg([{ week: 1, stats: { rec: 8, rec_yd: 80 } }], PPR);

  assert.equal(half?.average, 12);
  assert.equal(full?.average, 16);
});

test("first downs score like any other category the league pays for", () => {
  const ppg = playerPpg([{ week: 1, stats: { rush_yd: 100, rush_fd: 6 } }], {
    rush_yd: 0.1,
    rush_fd: 0.5,
  });

  assert.equal(ppg?.average, 13);
});

test("a team's average is what it put on the board", () => {
  const ppg = teamPpg([{ points: 120 }, { points: 100 }, { points: 140 }]);

  assert.equal(ppg?.games, 3);
  assert.equal(ppg?.average, 120);
});

test("an unplayed matchup row is dropped from both halves, not counted as a shutout", () => {
  const ppg = teamPpg([{ points: 120 }, { points: null }, { points: 100 }]);

  assert.equal(ppg?.games, 2);
  assert.equal(ppg?.points, 220);
  assert.equal(ppg?.average, 110);
  assert.equal(teamPpg([{ points: null }]), null);
});

test("a real zero is a scored week for a team too", () => {
  // Distinct from the null above: a league that recorded 0 recorded a week.
  const ppg = teamPpg([{ points: 0 }, { points: 100 }]);

  assert.equal(ppg?.games, 2);
  assert.equal(ppg?.average, 50);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlayerSummary } from "@/shared/players";

import {
  UNKNOWN_POSITION,
  groupRosterByPosition,
} from "./roster-groups.ts";

const player = (
  player_id: string,
  name: string,
  position: string | null,
  team: string | null = "SF",
): PlayerSummary => ({ player_id, name, position, team });

const cache = (...list: PlayerSummary[]): Record<string, PlayerSummary> =>
  Object.fromEntries(list.map((p) => [p.player_id, p]));

test("groups by position in lineup order, not alphabetically", () => {
  const players = cache(
    player("1", "Aaron Arm", "WR"),
    player("2", "Bill Back", "RB"),
    player("3", "Carl Cannon", "QB"),
    player("4", "Dan Deep", "TE"),
  );

  const groups = groupRosterByPosition(["1", "2", "3", "4"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    ["QB", "RB", "WR", "TE"],
  );
});

test("orders players within a group by name", () => {
  const players = cache(
    player("1", "Zack Zenith", "WR"),
    player("2", "Adam Apex", "WR"),
    player("3", "Mike Middle", "WR"),
  );

  const [wr] = groupRosterByPosition(["1", "2", "3"], players);

  assert.deepEqual(
    wr.players.map((p) => p.name),
    ["Adam Apex", "Mike Middle", "Zack Zenith"],
  );
});

test("a position nobody is held at gets no group at all", () => {
  const players = cache(player("1", "Only Quarterback", "QB"));

  const groups = groupRosterByPosition(["1"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    ["QB"],
  );
});

test("an unresolved player is kept, named by his id, and filed last", () => {
  const players = cache(player("1", "Known Guy", "RB"));

  const groups = groupRosterByPosition(["1", "9999"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    ["RB", UNKNOWN_POSITION],
  );
  // Kept rather than dropped: he was on the roster, and the cache not knowing
  // him is a fact about the cache. Dropping him would shorten the count a reader
  // judges the roster's depth by.
  assert.deepEqual(groups[1].players, [
    { player_id: "9999", name: "9999", team: null },
  ]);
});

test("a player with a blank position is unknown, not a group of its own", () => {
  const players = cache(player("1", "Blank Position", ""));

  const groups = groupRosterByPosition(["1"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    [UNKNOWN_POSITION],
  );
});

test("IDP sorts after offense and the team unit", () => {
  const players = cache(
    player("1", "Line Backer", "LB"),
    player("2", "Team Defense", "DEF"),
    player("3", "Kick Er", "K"),
    player("4", "Quarter Back", "QB"),
  );

  const groups = groupRosterByPosition(["1", "2", "3", "4"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    ["QB", "K", "DEF", "LB"],
  );
});

test("a position this build has never seen sorts after the known ones, before unknown", () => {
  const players = cache(
    player("1", "Quarter Back", "QB"),
    player("2", "Novel Role", "EDGE"),
    player("3", "Nameless", null),
  );

  const groups = groupRosterByPosition(["1", "2", "3"], players);

  // Kept and placed rather than dropped — a spelling Sleeper adds after this was
  // written must not make players vanish off a roster.
  assert.deepEqual(
    groups.map((g) => g.position),
    ["QB", "EDGE", UNKNOWN_POSITION],
  );
});

test("two unranked positions sort alphabetically among themselves", () => {
  const players = cache(
    player("1", "Zed Role", "ZROLE"),
    player("2", "Alpha Role", "AROLE"),
  );

  const groups = groupRosterByPosition(["1", "2"], players);

  assert.deepEqual(
    groups.map((g) => g.position),
    ["AROLE", "ZROLE"],
  );
});

test("an empty roster is no groups, never a group of nobody", () => {
  assert.deepEqual(groupRosterByPosition([], {}), []);
});

test("every id handed in comes back exactly once", () => {
  const players = cache(
    player("1", "One", "QB"),
    player("2", "Two", "RB"),
    player("3", "Three", null),
  );
  const ids = ["1", "2", "3", "4"];

  const back = groupRosterByPosition(ids, players).flatMap((g) =>
    g.players.map((p) => p.player_id),
  );

  assert.deepEqual([...back].sort(), [...ids].sort());
});

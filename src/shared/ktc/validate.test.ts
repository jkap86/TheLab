import assert from "node:assert/strict";
import { test } from "node:test";

import type { KtcPlayer } from "./types.ts";
import {
  validateKtcBoard,
  KTC_MIN_PLAYERS,
  KTC_MAX_SHRINK,
} from "./validate.ts";

const player = (id: number, overrides: Partial<KtcPlayer> = {}): KtcPlayer =>
  ({
    playerID: id,
    playerName: `Player ${id}`,
    slug: `player-${id}`,
    position: "WR",
    team: "SF",
    superflexValues: { value: 5000 - id, rank: id, positionalRank: id },
    oneQBValues: { value: 4800 - id, rank: id, positionalRank: id },
    ...overrides,
  }) as KtcPlayer;

const board = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => player(from + i));

test("a complete board is accepted", () => {
  const result = validateKtcBoard(board(520), 515);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.players.length, 520);
  assert.equal(result.ok === true && result.rejected, 0);
});

test("an empty response is rejected", () => {
  const result = validateKtcBoard([], 500);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /no valid player/);
});

test("a small non-empty fragment is rejected — the case that nulls the board", () => {
  const result = validateKtcBoard(board(17), 500);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /below the .* minimum/);
  assert.equal(result.ok === false && result.previous, 500);
  assert.equal(result.ok === false && result.valid, 17);
});

test("a duplicate-heavy response is rejected", () => {
  // 500 entries, but only ten distinct players repeated fifty times each.
  const duplicates = Array.from({ length: 500 }, (_, i) => player(i % 10));
  const result = validateKtcBoard(duplicates, 500);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /duplicate id/);
});

test("a handful of duplicates in a full board is tolerated and deduplicated", () => {
  const withDupes = [...board(520), player(1), player(2)];
  const result = validateKtcBoard(withDupes, 515);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.players.length, 520);
  assert.equal(result.ok === true && result.rejected, 2);
});

test("a moderate legitimate change is accepted", () => {
  // Rookies in, retirements out: a few percent either way.
  assert.equal(validateKtcBoard(board(492), 500).ok, true);
  assert.equal(validateKtcBoard(board(530), 500).ok, true);
});

test("an excessive shrink is rejected even above the absolute minimum", () => {
  const shrunk = Math.floor(1000 * (1 - KTC_MAX_SHRINK)) - 50;
  assert.ok(shrunk > KTC_MIN_PLAYERS, "the floor must not be what rejects this");
  const result = validateKtcBoard(board(shrunk), 1000);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /below the 1000 stored/);
});

test("the first sync has nothing to shrink against — only the floor applies", () => {
  assert.equal(validateKtcBoard(board(KTC_MIN_PLAYERS), 0).ok, true);
  assert.equal(validateKtcBoard(board(KTC_MIN_PLAYERS - 1), 0).ok, false);
});

test("entries missing an id, a name or any price are dropped as invalid", () => {
  const junk = [
    player(1, { playerID: "nope" as unknown as number }),
    player(2, { playerName: "  " }),
    player(3, { superflexValues: undefined, oneQBValues: undefined }),
  ];
  const result = validateKtcBoard([...board(400, 100), ...junk], 400);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.players.length, 400);
  assert.equal(result.ok === true && result.rejected, 3);
});

test("a player priced on only one board still counts", () => {
  const oneSided = board(400).map((p) => ({ ...p, superflexValues: undefined }));
  assert.equal(validateKtcBoard(oneSided, 400).ok, true);
});

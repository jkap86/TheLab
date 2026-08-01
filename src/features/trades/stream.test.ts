import assert from "node:assert/strict";
import { test } from "node:test";

import type { TradesStreamMessage } from "@/shared/contract";

import { applyTradesMessage, EMPTY_TRADES_STREAM } from "./stream.ts";

const meta = (total: number): TradesStreamMessage => ({
  type: "meta",
  season: "2026",
  total,
});

/** A chunk naming one trade, and whatever ids the caller says are new on it. */
const chunk = (
  ids: string[],
  extra: {
    leagues?: string[];
    players?: string[];
    managers?: string[];
    ktc?: string[];
  } = {},
): TradesStreamMessage => ({
  type: "chunk",
  trades: ids.map((id) => ({
    transaction_id: id,
    league_id: "L1",
    week: 1,
    completed_at: 1_752_000_000_000,
    sides: [],
  })),
  leagues: (extra.leagues ?? []).map(
    (id) => ({ league_id: id, name: id }) as never,
  ),
  players: Object.fromEntries(
    (extra.players ?? []).map((id) => [id, { name: id } as never]),
  ),
  managers: Object.fromEntries(
    (extra.managers ?? []).map((id) => [id, { user_id: id } as never]),
  ),
  ktc: Object.fromEntries(
    (extra.ktc ?? []).map((id) => [id, { sf: 4000, oneqb: 3000 }]),
  ),
});

const fold = (messages: TradesStreamMessage[]) =>
  messages.reduce(applyTradesMessage, EMPTY_TRADES_STREAM);

test("applyTradesMessage", async (t) => {
  await t.test("meta opens the season with its total and nothing in it", () => {
    const { data } = fold([meta(46_900)]);
    assert.equal(data?.total, 46_900);
    assert.equal(data?.season, "2026");
    assert.deepEqual(data?.trades, []);
  });

  await t.test("trades append in arrival order, newest first", () => {
    const { data } = fold([meta(4), chunk(["a", "b"]), chunk(["c", "d"])]);
    assert.deepEqual(
      data?.trades.map((tr) => tr.transaction_id),
      ["a", "b", "c", "d"],
    );
  });

  await t.test("the total survives every chunk after it", () => {
    const { data } = fold([meta(46_900), chunk(["a"]), chunk(["b"])]);
    assert.equal(data?.total, 46_900);
  });

  // The rule the whole delta protocol rests on: a chunk names only what no
  // earlier one did, so replacing rather than merging silently strips the maps
  // back to whatever the last chunk happened to introduce.
  await t.test("the id maps merge across chunks, they do not replace", () => {
    const { data } = fold([
      meta(2),
      chunk(["a"], {
        leagues: ["L1"],
        players: ["p1"],
        managers: ["m1"],
        ktc: ["p1"],
      }),
      chunk(["b"], {
        leagues: ["L2"],
        players: ["p2"],
        managers: ["m2"],
        ktc: ["p2"],
      }),
    ]);
    assert.deepEqual(
      data?.leagues.map((l) => l.league_id),
      ["L1", "L2"],
    );
    assert.deepEqual(Object.keys(data?.players ?? {}), ["p1", "p2"]);
    assert.deepEqual(Object.keys(data?.managers ?? {}), ["m1", "m2"]);
    assert.deepEqual(Object.keys(data?.ktc ?? {}), ["p1", "p2"]);
  });

  // What the page's memoisation reads. Most chunks late in a season introduce no
  // league and no player, and rebuilding those halves anyway would re-run every
  // filter pass over the whole season for no change.
  await t.test("a half that gained nothing keeps its identity", () => {
    const first = fold([meta(2), chunk(["a"], { leagues: ["L1"], players: ["p1"] })]);
    const second = applyTradesMessage(first, chunk(["b"]));

    assert.notEqual(second.data?.trades, first.data?.trades, "trades grew");
    assert.equal(second.data?.leagues, first.data?.leagues);
    assert.equal(second.data?.players, first.data?.players);
    assert.equal(second.data?.managers, first.data?.managers);
    assert.equal(second.data?.ktc, first.data?.ktc);
  });

  await t.test("a chunk carrying nothing at all is not a new state", () => {
    const first = fold([meta(0), chunk(["a"])]);
    assert.equal(applyTradesMessage(first, chunk([])), first);
  });

  await t.test("a chunk before any meta is dropped rather than inventing a total", () => {
    assert.equal(fold([chunk(["a"])]).data, null);
  });

  // A read can fail partway through, and a real prefix of the season on screen
  // beats an empty page — so the error sits beside the data, never in place of it.
  await t.test("an error after chunks keeps what arrived", () => {
    const state = fold([
      meta(46_900),
      chunk(["a", "b"]),
      { type: "error", error: "Failed to load trades" },
    ]);
    assert.equal(state.error, "Failed to load trades");
    assert.equal(state.data?.trades.length, 2);
    assert.equal(state.data?.total, 46_900);
  });

  await t.test("an error before anything arrives leaves no data", () => {
    const state = fold([{ type: "error", error: "Failed to load trades" }]);
    assert.equal(state.error, "Failed to load trades");
    assert.equal(state.data, null);
  });
});

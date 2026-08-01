import assert from "node:assert/strict";
import { test } from "node:test";

import type { TradesStreamMessage } from "@/shared/contract";

import { applyTradesMessage, EMPTY_TRADES_STREAM } from "./stream.ts";

const meta = (): TradesStreamMessage => ({ type: "meta", season: "2026" });

const total = (n: number): TradesStreamMessage => ({ type: "total", total: n });

/** A chunk of trades, which is now all a chunk is. */
const chunk = (ids: string[]): TradesStreamMessage => ({
  type: "chunk",
  trades: ids.map((id) => ({
    transaction_id: id,
    league_id: "L1",
    week: 1,
    completed_at: 1_752_000_000_000,
    sides: [],
  })),
});

/** What the ids in the chunk before it stand for. */
const names = (
  extra: {
    leagues?: string[];
    players?: string[];
    managers?: string[];
    ktc?: string[];
  } = {},
): TradesStreamMessage => ({
  type: "names",
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
  await t.test("meta opens the season with nothing in it", () => {
    const { data } = fold([meta()]);
    assert.equal(data?.season, "2026");
    assert.deepEqual(data?.trades, []);
  });

  // The count is its own query, so a season being drawn before it answers is a
  // real state and not a gap to paper over with a zero.
  await t.test("the total is null until its own message arrives", () => {
    assert.equal(fold([meta(), chunk(["a"])]).data?.total, null);
    assert.equal(fold([meta(), chunk(["a"]), total(46_900)]).data?.total, 46_900);
  });

  await t.test("the total can arrive before any trade does", () => {
    const { data } = fold([meta(), total(46_900), chunk(["a"])]);
    assert.equal(data?.total, 46_900);
    assert.equal(data?.trades.length, 1);
  });

  await t.test("trades append in arrival order, newest first", () => {
    const { data } = fold([meta(), chunk(["a", "b"]), chunk(["c", "d"])]);
    assert.deepEqual(
      data?.trades.map((tr) => tr.transaction_id),
      ["a", "b", "c", "d"],
    );
  });

  await t.test("the total survives every chunk after it", () => {
    const { data } = fold([meta(), total(46_900), chunk(["a"]), chunk(["b"])]);
    assert.equal(data?.total, 46_900);
  });

  // The rule the whole delta protocol rests on: a `names` message carries only
  // what no earlier one did, so replacing rather than merging silently strips
  // the maps back to whatever the last one happened to introduce.
  await t.test("the id maps merge across messages, they do not replace", () => {
    const { data } = fold([
      meta(),
      chunk(["a"]),
      names({ leagues: ["L1"], players: ["p1"], managers: ["m1"], ktc: ["p1"] }),
      chunk(["b"]),
      names({ leagues: ["L2"], players: ["p2"], managers: ["m2"], ktc: ["p2"] }),
    ]);
    assert.deepEqual(
      data?.leagues.map((l) => l.league_id),
      ["L1", "L2"],
    );
    assert.deepEqual(Object.keys(data?.players ?? {}), ["p1", "p2"]);
    assert.deepEqual(Object.keys(data?.managers ?? {}), ["m1", "m2"]);
    assert.deepEqual(Object.keys(data?.ktc ?? {}), ["p1", "p2"]);
  });

  // What the page's memoisation reads. Trades arrive without their names now, so
  // the identity rule matters on every chunk rather than only on the late ones.
  await t.test("a half that gained nothing keeps its identity", () => {
    const first = fold([
      meta(),
      chunk(["a"]),
      names({ leagues: ["L1"], players: ["p1"] }),
    ]);
    const second = applyTradesMessage(first, chunk(["b"]));

    assert.notEqual(second.data?.trades, first.data?.trades, "trades grew");
    assert.equal(second.data?.leagues, first.data?.leagues);
    assert.equal(second.data?.players, first.data?.players);
    assert.equal(second.data?.managers, first.data?.managers);
    assert.equal(second.data?.ktc, first.data?.ktc);
  });

  await t.test("a names message adds no trades", () => {
    const first = fold([meta(), chunk(["a"])]);
    const second = applyTradesMessage(first, names({ players: ["p1"] }));
    assert.equal(second.data?.trades, first.data?.trades);
    assert.deepEqual(Object.keys(second.data?.players ?? {}), ["p1"]);
  });

  await t.test("a message carrying nothing at all is not a new state", () => {
    const first = fold([meta(), chunk(["a"])]);
    assert.equal(applyTradesMessage(first, chunk([])), first);
    assert.equal(applyTradesMessage(first, names()), first);
  });

  await t.test("anything before meta is dropped rather than inventing a season", () => {
    assert.equal(fold([chunk(["a"])]).data, null);
    assert.equal(fold([names({ players: ["p1"] })]).data, null);
    assert.equal(fold([total(10)]).data, null);
  });

  // A read can fail partway through, and a real prefix of the season on screen
  // beats an empty page — so the error sits beside the data, never in place of it.
  await t.test("an error after chunks keeps what arrived", () => {
    const state = fold([
      meta(),
      total(46_900),
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

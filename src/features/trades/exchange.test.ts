import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Trade, TradeSide } from "@/shared/trades";

import { isEmptyBundle, isPairedExchange, tradeExchange } from "./exchange.ts";

const side = (roster_id: number, over: Partial<TradeSide> = {}): TradeSide => ({
  roster_id,
  user_id: `user${roster_id}`,
  players: [],
  picks: [],
  faab: 0,
  ...over,
});

const trade = (sides: TradeSide[]): Trade => ({
  transaction_id: "t1",
  league_id: "l1",
  week: 2,
  completed_at: Date.parse("2026-07-15T12:00:00Z"),
  sides,
});

describe("tradeExchange", () => {
  test("a two-sided trade's giving half is the other side's take", () => {
    const pick = { season: "2027", round: 3, roster_id: 2 };
    const exchange = tradeExchange(
      trade([
        side(1, { players: ["p1"] }),
        side(2, { picks: [pick], faab: 25 }),
      ]),
    );

    assert.equal(exchange.length, 2);
    assert.deepEqual(exchange[0].received.players, ["p1"]);
    assert.deepEqual(exchange[0].given?.picks, [pick]);
    assert.equal(exchange[0].given?.faab, 25);
    assert.deepEqual(exchange[1].given?.players, ["p1"]);
    assert.deepEqual(exchange[1].received.picks, [pick]);
    assert.ok(isPairedExchange(exchange));
  });

  test("a side that only gave things up still has an empty take", () => {
    const exchange = tradeExchange(
      trade([side(1, { players: ["p1"] }), side(2)]),
    );

    assert.ok(isEmptyBundle(exchange[1].received));
    assert.deepEqual(exchange[1].given?.players, ["p1"]);
    assert.ok(exchange[0].given && isEmptyBundle(exchange[0].given));
  });

  test("a three-way trade has no attributable giving half", () => {
    const exchange = tradeExchange(
      trade([side(1, { players: ["p1"] }), side(2), side(3, { faab: 5 })]),
    );

    assert.equal(exchange.length, 3);
    assert.ok(exchange.every((e) => e.given === null));
    assert.equal(isPairedExchange(exchange), false);
  });
});

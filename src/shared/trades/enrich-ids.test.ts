import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { collectEnrichmentIds } from "./enrich-ids.ts";
import { draftOrderKey } from "./pick-slots.ts";
import type { Trade, TradeSide } from "./types.ts";

/**
 * Which ids a page asks Postgres to name.
 *
 * The bug this replaced was one `Set` shared by three kinds of thing. Sleeper's
 * player ids and user ids are both bare digit strings, so nothing but their
 * usual lengths kept them apart — and a page naming player `4034` and manager
 * `4034` collected whichever came first and dropped the other. It never errors:
 * it is one card with a missing player name, or a side labelled by a roster
 * number, on one page of one board.
 */

const side = (over: Partial<TradeSide> = {}): TradeSide => ({
  roster_id: 1,
  user_id: null,
  players: [],
  picks: [],
  faab: 0,
  ...over,
});

const trade = (sides: TradeSide[], leagueId = "L1"): Trade => ({
  transaction_id: "t1",
  league_id: leagueId,
  week: null,
  completed_at: 1_700_000_000_000,
  sides,
});

describe("collectEnrichmentIds", () => {
  test("a player id and a manager id that read the same are both collected", () => {
    // The regression. Both are digit strings; nothing promises they cannot
    // collide, and a shared `Set` is one collision away from a nameless card.
    const ids = collectEnrichmentIds([
      trade([side({ user_id: "4034", players: ["4034"] })]),
    ]);
    assert.deepEqual(ids.players, ["4034"]);
    assert.deepEqual(ids.managers, ["4034"]);
  });

  test("a draft key that reads like an id is its own namespace too", () => {
    const key = draftOrderKey("L1", "2027");
    const ids = collectEnrichmentIds([
      trade([
        side({
          players: [key],
          user_id: key,
          picks: [{ season: "2027", round: 1, roster_id: 2, user_id: null }],
        }),
      ]),
    ]);
    assert.deepEqual(ids.players, [key]);
    assert.deepEqual(ids.managers, [key]);
    assert.deepEqual(ids.draftKeys, [key]);
  });

  test("deduplicates within a namespace", () => {
    // The point of the `Set` in the first place: a busy league's page carries
    // dozens of picks out of the same two drafts, and the same player can move
    // in more than one trade on one page.
    const ids = collectEnrichmentIds([
      trade([
        side({ user_id: "u1", players: ["p1", "p1"] }),
        side({ user_id: "u1", players: ["p1"] }),
      ]),
      trade([side({ user_id: "u1", players: ["p1"] })]),
    ]);
    assert.deepEqual(ids.players, ["p1"]);
    assert.deepEqual(ids.managers, ["u1"]);
  });

  test("collects a pick's original owner, who need not be in the trade", () => {
    // Exactly the case the card names an owner for — a side-only walk misses it.
    const ids = collectEnrichmentIds([
      trade([
        side({
          user_id: "u1",
          picks: [{ season: "2027", round: 1, roster_id: 9, user_id: "u9" }],
        }),
      ]),
    ]);
    assert.deepEqual(ids.managers, ["u1", "u9"]);
  });

  test("a draft key is per league and per season", () => {
    const ids = collectEnrichmentIds([
      trade(
        [
          side({
            picks: [
              { season: "2027", round: 1, roster_id: 1, user_id: null },
              { season: "2028", round: 1, roster_id: 1, user_id: null },
            ],
          }),
        ],
        "L1",
      ),
      trade([
        side({ picks: [{ season: "2027", round: 2, roster_id: 3, user_id: null }] }),
      ]),
    ]);
    assert.deepEqual(ids.draftKeys, [
      draftOrderKey("L1", "2027"),
      draftOrderKey("L1", "2028"),
    ]);
  });

  test("an empty page asks for nothing", () => {
    assert.deepEqual(collectEnrichmentIds([]), {
      players: [],
      managers: [],
      draftKeys: [],
    });
  });

  test("keeps arrival order, so a lookup's answer zips back to its request", () => {
    const ids = collectEnrichmentIds([
      trade([side({ players: ["p3", "p1"] }), side({ players: ["p2"] })]),
    ]);
    assert.deepEqual(ids.players, ["p3", "p1", "p2"]);
  });
});

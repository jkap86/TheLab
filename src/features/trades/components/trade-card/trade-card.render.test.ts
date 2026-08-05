import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

import { TRADE_METRICS } from "../../trade-metrics";
import type { KtcValue, PlayerSummary, Trade, TradeManager } from "../../types";
import { TradeCard } from "./trade-card";

/**
 * The card without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees* — React runs on the
 * server, so this needs no browser and no dependency — which is the whole of
 * what this component is: it holds no state, no effect and no handler, so there
 * is nothing here a press could reach and nothing an effect owns.
 *
 * What it is for is the half of the card that no type can hold. The material
 * classes, the breakpoints, the two tones and the rules about when a line is
 * drawn at all are strings and conditionals, so every one of them survives a
 * refactor silently or not at all — a give track that lost its groove, an odd
 * side that stopped spanning the row, or an origin line that started printing on
 * every pick would all typecheck.
 */

const ktcMetric = TRADE_METRICS[0];
const playersMetric = TRADE_METRICS.find((m) => m.key === "players")!;

const players: Record<string, PlayerSummary> = {
  p1: { name: "Christian McCaffrey", position: "RB", team: "SF" } as PlayerSummary,
  p2: { name: "Ja'Marr Chase", position: "WR", team: "CIN" } as PlayerSummary,
  // Off KTC's board entirely — the em dash rather than a zero.
  p3: { name: "Justin Tucker", position: "K", team: "BAL" } as PlayerSummary,
};

const managers: Record<string, TradeManager> = {
  u1: { user_id: "u1", display_name: "jkap", avatar_url: null } as TradeManager,
  u2: {
    user_id: "u2",
    display_name: "DarksideEmperors",
    avatar_url: null,
  } as TradeManager,
  u3: { user_id: "u3", display_name: "ThirdParty", avatar_url: null } as TradeManager,
};

const ktc: Record<string, KtcValue> = {
  p1: { sf: 8000, oneqb: 8600 },
  p2: { sf: 9100, oneqb: 9900 },
};

const pickKtc: Record<string, KtcValue> = {
  "2027|1|early": { sf: 6000, oneqb: 5200 },
  "2027|1|": { sf: 4700, oneqb: 4000 },
};

/** Roster 2's 2027 pick has a place; nothing else does. */
const pickSlots: Record<string, number> = { "L1|2027|2": 3 };

const league: ManagerLeague = {
  league_id: "L1",
  name: "The Lab Dynasty",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: { type: 2 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
} as ManagerLeague;

/**
 * The ordinary card: two sides, one holding two players and two picks — one of
 * them the counterparty's own, one from a third party.
 */
const twoSided: Trade = {
  transaction_id: "t1",
  league_id: "L1",
  week: 3,
  completed_at: new Date(2026, 6, 15, 15, 7).getTime(),
  sides: [
    {
      roster_id: 1,
      user_id: "u1",
      players: ["p1", "p3"],
      picks: [
        // From the roster handing it over — no origin line.
        { season: "2027", round: 1, roster_id: 2, user_id: "u2" },
        // From somebody not in this trade — worth every character.
        { season: "2028", round: 2, roster_id: 9, user_id: "u3" },
      ],
      faab: 55,
    },
    { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
  ],
};

const threeSided: Trade = {
  transaction_id: "t2",
  league_id: "L1",
  week: null,
  completed_at: new Date(2026, 0, 2, 3, 5).getTime(),
  sides: [
    { roster_id: 1, user_id: "u1", players: ["p1"], picks: [], faab: 0 },
    { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
    // Came away with nothing, which the card says in words.
    { roster_id: 3, user_id: null, players: [], picks: [], faab: 0 },
  ],
};

function card(over: Partial<Parameters<typeof TradeCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TradeCard, {
      trade: twoSided,
      league,
      players,
      managers,
      metric: ktcMetric,
      ktc,
      pickKtc,
      pickSlots,
      ...over,
    }),
  );
}

/** How many times a class appears — the tracks and plates are counted, not found. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the card's material", () => {
  test("the slab and its face both carry the chamfer", () => {
    const html = card();
    // A wall that turns two corners shows a square one wherever the clip
    // doesn't follow it, so the notch is on both layers.
    assert.match(html, /class="lab-slab lab-notch-lg"/);
    assert.match(html, /class="lab-slab-face lab-notch-lg/);
  });

  test("each side is a plate seated in that face", () => {
    assert.equal(count(card(), "lab-plate-sm lab-plate-brushed"), 2);
    assert.equal(count(card({ trade: threeSided }), "lab-plate-sm lab-plate-brushed"), 3);
  });

  test("the leading edge carries the accent rail, and it is decoration", () => {
    assert.match(card(), /<span aria-hidden="true" class="lab-billet-rail/);
  });

  test("the header's instant and each side's total are under glass", () => {
    const html = card();
    assert.match(html, /class="lab-readout ml-auto/);
    assert.match(html, /class="lab-readout lab-lens ml-auto/);
  });
});

describe("what the header says", () => {
  test("the league's name, and the id only until the list answers", () => {
    assert.match(card(), /The Lab Dynasty/);
    assert.match(card({ league: null }), />L1</);
  });

  test("the date and the clock time, in that order and in one readout", () => {
    assert.match(card(), /Jul 15, 2026 · 3:07 PM/);
  });

  test("an undated trade says so and adds no dangling separator", () => {
    const html = card({ trade: { ...twoSided, completed_at: null } });
    assert.match(html, /date unknown/);
    assert.doesNotMatch(html, /date unknown ·/);
  });

  test("the scoring week is not on the card — the instant replaced it", () => {
    assert.doesNotMatch(card(), /Wk 3/);
  });
});

describe("the two tracks", () => {
  test("the give track is a groove; the take track is the plate's own face", () => {
    // One per side on a two-sided trade: each side's give is the other's take.
    assert.equal(count(card(), "lab-groove"), 2);
  });

  test("a three-way draws no give track at all", () => {
    // Nothing Sleeper stores says which participant an asset came through, so a
    // column of guessed `−` lines is not drawn.
    assert.equal(count(card({ trade: threeSided }), "lab-groove"), 0);
  });

  test("the tracks split from `sm` up and stack below it", () => {
    assert.match(card(), /sm:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/);
  });

  test("a side whose counterparty took nothing draws no groove", () => {
    const lopsided: Trade = {
      ...twoSided,
      sides: [
        { roster_id: 1, user_id: "u1", players: ["p1", "p2"], picks: [], faab: 0 },
        { roster_id: 2, user_id: "u2", players: [], picks: [], faab: 0 },
      ],
    };
    // Only the side that received nothing has a give half worth drawing.
    assert.equal(count(card({ trade: lopsided }), "lab-groove"), 1);
  });

  test("both signs are drawn, and neither is announced", () => {
    const html = card();
    assert.match(html, /aria-hidden="true" class="mr-1 inline-block w-\[0\.7em\] tabular-nums text-active\/50">\+/);
    assert.match(html, /aria-hidden="true" class="mr-1 inline-block w-\[0\.7em\] tabular-nums text-foreground\/25">−/);
  });
});

describe("what a line names", () => {
  test("a take line carries the player's position and team", () => {
    assert.match(card(), /Christian McCaffrey<span class="ml-1\.5 whitespace-nowrap text-\[11px\] text-foreground\/45">RB · SF/);
  });

  test("a give line names the player and nothing else", () => {
    // Ja'Marr Chase is roster 2's take and roster 1's give; the give spelling
    // carries no position, since the take one a column over always does.
    const html = card();
    assert.equal(count(html, "WR · CIN"), 1);
    assert.equal(count(html, "Chase"), 2);
  });

  test("an unknown player id stands in for itself rather than blanking", () => {
    const html = card({ players: {} });
    assert.match(html, />p1</);
  });

  test("a placed pick is named by its slot, an unplaced one by its round", () => {
    const html = card();
    // Roster 2's 2027 pick has an order; the 2028 one does not.
    assert.match(html, /2027 1\.03/);
    assert.match(html, /2028 2nd/);
  });

  test("a pick's origin is drawn only where it is a surprise", () => {
    const html = card();
    // The third party's pick names them; the counterparty's own does not.
    assert.match(html, /from ThirdParty/);
    assert.doesNotMatch(html, /from DarksideEmperors/);
  });

  test("an uncached owner falls back to the roster number", () => {
    assert.match(card({ managers: {} }), /from roster 9/);
  });

  test("FAAB is spelled with its currency and its unit", () => {
    assert.match(card(), /\$55 FAAB/);
  });
});

describe("what a value column says", () => {
  test("a side's total is labelled where it sits", () => {
    assert.match(card(), /KTC/);
  });

  test("a multi-line track prices each line", () => {
    // Roster 1 took four assets, so the breakdown says something the total
    // doesn't and each covered line carries its own number.
    assert.match(card(), /title="Dynasty KTC, superflex board"/);
  });

  test("a breakdown of one is the total, so a single-line track has none", () => {
    const single: Trade = {
      ...twoSided,
      sides: [
        { roster_id: 1, user_id: "u1", players: ["p1"], picks: [], faab: 0 },
        { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
      ],
    };
    assert.equal(count(card({ trade: single }), 'title="Dynasty KTC, superflex board"'), 0);
  });

  test("covered and unpriced is an em dash, never a zero", () => {
    const html = card();
    assert.match(html, /Not priced on the superflex board/);
    assert.match(html, /—/);
    assert.doesNotMatch(html, />0<\/span>/);
  });

  test("a metric with no per-asset form prices no line", () => {
    const html = card({ metric: playersMetric });
    assert.doesNotMatch(html, /title="Dynasty KTC/);
    // The side total is still there — it is the per-line column that isn't.
    assert.match(html, /players received/);
  });

  test("the board follows the league's own lineup", () => {
    assert.match(card(), /superflex board/);
    assert.match(
      card({ league: { ...league, roster_positions: ["QB", "RB", "WR", "BN"] } }),
      /1QB board/,
    );
    // An unsynced lineup falls to 1QB rather than guessing the richer board.
    assert.match(card({ league: null }), /1QB board/);
  });
});

describe("how the sides are laid out", () => {
  test("two sides share the row from `sm` up", () => {
    assert.match(card(), /class="grid gap-2 sm:grid-cols-2"/);
  });

  test("the odd side of a three-way spans the row", () => {
    // An empty cell beside it would read as a participant who came away with
    // nothing, which is a state this card draws in words instead.
    assert.equal(count(card({ trade: threeSided }), "sm:col-span-2"), 1);
    assert.equal(count(card(), "sm:col-span-2"), 0);
  });

  test("a side that took nothing says so", () => {
    assert.match(card({ trade: threeSided }), /Nothing<\/p>/);
  });

  test("an unnamed participant is a roster rather than a blank", () => {
    assert.match(card({ trade: threeSided }), /Roster 3/);
  });
});

describe("the card as a document", () => {
  test("the league is the card's heading and each track is a list", () => {
    const html = card();
    assert.match(html, /<article/);
    assert.match(html, /<h3/);
    assert.match(html, /<ul/);
    assert.match(html, /<li/);
  });

  test("nothing carries an id, so forty thousand cards cannot collide", () => {
    assert.deepEqual(card().match(/ id="[^"]*"/g) ?? [], []);
  });

  test("every card renders for every metric in the catalogue", () => {
    for (const metric of TRADE_METRICS) {
      for (const trade of [twoSided, threeSided]) {
        assert.ok(card({ metric, trade }).length > 200, metric.key);
      }
    }
  });
});

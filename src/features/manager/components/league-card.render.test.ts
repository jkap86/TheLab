import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { LeagueRankSet, ManagerLeague } from "../types";
import { LeagueCard, OPEN, REST } from "./league-card";

/**
 * The card without a DOM — the trade card's own test, for the card that now
 * shares its material.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is most of what the
 * move to a slab changed: the surface, the nameplate, the status lamp, the head's
 * insets and where the disclosure semantics live are strings and conditionals, so
 * every one of them survives a refactor silently or not at all.
 *
 * **Only the resting card is rendered, and that is a boundary rather than a
 * gap.** An expanded one mounts the whole league detail panel, which wants a
 * query client and the shared ADP board around it — so rendering that state here
 * would be a markup test dragging a fetch-shaped thing behind it, and the panel
 * has its own tests. What the open state actually owes this file is that its
 * *geometry* still agrees with the heading rail, which is a fact about two class
 * strings — so those are asserted as strings.
 */

const league: ManagerLeague = {
  league_id: "L1",
  name: "The Lab Dynasty",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins: 9, losses: 4, ties: 0 },
  settings: { type: 2 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
} as ManagerLeague;

/**
 * A standing and nothing else. The card's four stat columns are pointed at the
 * ranks this leaves null, so they draw their em dashes and what is left on
 * screen is the ledge — which is the part these tests are about.
 */
const RANKS: LeagueRankSet = {
  standing: { rank: 2, of: 12 },
  points: null,
  proj: null,
  proj_bench: null,
};

function card(over: Partial<Parameters<typeof LeagueCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(LeagueCard, {
      league,
      ranks: null,
      weeks: [],
      ktc: null,
      valuedAt: null,
      adp: null,
      columns: ["record_rank", "points_rank", "ktc_starters_rank", "proj_rank"],
      expanded: false,
      // The card's one handler. Nothing here presses it — `renderToStaticMarkup`
      // has no DOM to press with — so it is a stub, and what these tests are
      // about is the markup.
      onToggle: () => {},
      ...over,
    }),
  );
}

describe("the card's material", () => {
  test("the slab and its face both carry the chamfer", () => {
    // A wall that turns two corners shows a square one wherever the clip
    // doesn't follow it, so the notch is on both layers.
    const html = card();
    assert.match(html, /lab-slab lab-notch-lg/);
    assert.match(html, /lab-slab-face lab-notch-lg/);
  });

  test("a resting card is a slab and never the panel's plate", () => {
    assert.doesNotMatch(card(), /lab-plate/);
  });

  test("the glass the other lists wear is gone from this one", () => {
    // `LIST_ROW_SURFACE`, which the share cards and the lineup rows still wear.
    // A card carrying both would be wearing two materials at once.
    assert.doesNotMatch(card(), /backdrop-blur/);
  });

  test("only an open card wears the sheen", () => {
    // A slab has a specular sweep of its own and a bloom under it, so a second
    // travelling band would be the one part of the card claiming to be glass —
    // and the rail it draws is what the nameplate's own already says. Open, it
    // is worth having for the half the plate can't do: marking which league is
    // being worked in.
    assert.doesNotMatch(card(), /from-active\/55/);
    assert.match(OPEN.face, /group/); // what that sheen reads its hover from
  });

  test("both plates ride the edge, outside the clip that would cut them", () => {
    // `clip-path` clips its whole subtree, so a plate inside the notched face
    // would be severed at the exact edge it exists to straddle. The card's
    // `pt-3` is the overhang they straddle into, and the row that holds the two
    // of them is the card's first child — before the wall, never inside it.
    const html = card({ ranks: RANKS });
    assert.match(html, /pt-3[^"]*"><div class="pointer-events-none absolute/);
    assert.doesNotMatch(html, /lab-slab-face[\s\S]*lab-nameplate/);
  });

  test("the row spanning the edge does not take the card's presses", () => {
    // It spans the whole edge and sits over the head's top inset, so without
    // this every press landing between the two plates would hit the row rather
    // than the toggle underneath. Each plate takes them back for itself.
    const html = card({ ranks: RANKS });
    assert.match(html, /class="pointer-events-none absolute[^"]*"/);
    assert.equal(html.split("pointer-events-auto").length - 1, 2);
  });

  test("the nameplate carries the accent rail, and it is decoration", () => {
    assert.match(card(), /<span aria-hidden="true" class="lab-billet-rail/);
  });

  test("the record is a readout, and it is not engraved with it", () => {
    // A cut inside a cut is a smudge rather than machining — the rule the trade
    // card's give track keeps.
    const html = card({ ranks: RANKS });
    assert.match(html, /class="lab-readout [^"]*">9-4</);
    assert.doesNotMatch(html, /class="lab-readout lab-engraved|lab-engraved[^"]*">9-4/);
  });
});

/**
 * The record and the standing, on a plate holding the card's trailing corner.
 *
 * Both used to sit in the head between the chevron and the stat columns, which
 * is the one part of the card that has to stay quiet — so what these pin is that
 * they are on the *edge*, that the plate is a housing rather than a second name,
 * and that "absent is not zero" survived the move.
 */
describe("the record ledge", () => {
  test("both facts are on the edge, and neither is left in the head", () => {
    const html = card({ ranks: RANKS });
    const row = html.indexOf("pointer-events-none absolute");
    const wall = html.indexOf("lab-slab lab-notch-lg");
    // Everything the ledge says is before the card's own wall begins.
    assert.ok(row >= 0 && row < wall);
    assert.ok(html.indexOf("9-4") < wall);
    assert.ok(html.indexOf("2nd") < wall);
  });

  test("the record keeps the readout it wore in the head", () => {
    // The move is a change of seat, not of material: a reader has nothing to
    // relearn, and a cut into the plate's lit face is what makes the plate a
    // housing rather than a label.
    assert.match(card({ ranks: RANKS }), /lab-nameplate[\s\S]*lab-readout[^"]*">9-4</);
  });

  test("the standing is engraved, and it is the rank alone", () => {
    // Engraved rather than lit for the arithmetic the trade card's values
    // answer: there is one of these per card down the whole list, and a numeral
    // in the accent at that count is wallpaper.
    const html = card({ ranks: RANKS });
    assert.match(html, /class="lab-engraved[^"]*">2nd/);
    // The denominator is what the stat columns' rank cells spend their width on;
    // here it would come out of the league name's own truncation budget.
    assert.doesNotMatch(html, />2nd of 12</);
  });

  test("the denominator survives where it costs no width", () => {
    // A bare ordinal is a rank out of nothing, and this is the one reading of
    // the card that has no hover to fall back on.
    const html = card({ ranks: RANKS });
    assert.match(html, /title="#2 of 12 by record"/);
    assert.match(html, /<span class="sr-only"> of 12 by record<\/span>/);
  });

  test("a preseason league states the record and no standing", () => {
    // `0-0` is a true count; a rank there would place a season nobody has
    // played. The same rule the stat columns' rank cells keep.
    const html = card({
      league: { ...league, record: { wins: 0, losses: 0, ties: 0 } },
      ranks: { standing: null, points: null, proj: null, proj_bench: null },
    });
    assert.match(html, /lab-readout[^"]*">0-0</);
    assert.doesNotMatch(html, /lab-engraved/);
  });

  test("a league with neither fact has no plate at all", () => {
    // An empty housing on the edge is the card reporting that it has nothing to
    // report. The name's own plate is untouched.
    const html = card({ league: { ...league, record: null } });
    assert.equal(html.split("lab-nameplate").length - 1, 1);
    assert.doesNotMatch(html, /lab-readout/);
  });
});

describe("the press", () => {
  test("the league's name is the card's one button, inside the heading", () => {
    // `role="button"` on the head would take presentational children, flattening
    // four stat columns and their screen-reader labels into one string. A
    // `<button>` takes phrasing content and a heading is flow, so the button is
    // inside the `h2` rather than around it.
    const html = card();
    assert.match(html, /<h2 [^>]*><button type="button"/);
    assert.equal(html.split("<button").length - 1, 1);
    assert.doesNotMatch(html, /role="button"/);
  });

  test("that button carries the disclosure state", () => {
    assert.match(card(), /aria-expanded="false"/);
  });

  test("a collapsed card points at no panel, because there is none to point at", () => {
    // A reference to an id that isn't in the document is a broken relationship
    // rather than an absent one.
    assert.doesNotMatch(card(), /aria-controls/);
  });
});

describe("the status lamp", () => {
  test("it rides on the nameplate, after the name", () => {
    // It says something about the *league*, and the plate is what names the
    // league — so it is up there rather than in the head, which opens with the
    // chevron and the record.
    const html = card();
    const plate = html.indexOf("lab-nameplate");
    const lamp = html.indexOf("in season");
    assert.ok(plate >= 0 && lamp > plate);
    assert.ok(lamp < html.indexOf("lab-readout"));
  });

  test("a finished league's lamp is a dark recess, not a dimmed fill", () => {
    // The plate is the lightest surface on the card, so a grey dot on it reads
    // as a lamp that is on and grey.
    const html = card({ league: { ...league, status: "complete" } });
    assert.match(html, /class="h-2 w-2 rounded-full lab-readout"/);
    assert.match(html, /complete<\/span>/);
  });

  test("the live states keep their glow", () => {
    assert.match(card(), /bg-active shadow-\[0_0_8px_rgba\(0,255,229,0\.7\)\]/);
    assert.match(
      card({ league: { ...league, status: "drafting" } }),
      /bg-amber-300/,
    );
  });
});

describe("where the stat columns land", () => {
  /**
   * The heading rail above the list is laid on the cards' geometry
   * (`border border-transparent px-4 pl-5`), so a card's content starts 21px in
   * and ends 17px off the trailing edge. A heading a hair off the number under it
   * reads as a misaligned table, and no type can carry that agreement — which is
   * what these are for.
   */
  const RAIL_LEFT = 21;
  const RAIL_RIGHT = 17;
  /** What `.lab-slab` spends on its wall, out of that trailing gutter. */
  const WALL = 6;
  /** What a bordered box spends on each of its own, which the plate is. */
  const BORDER = 1;

  test("a resting card gives its wall back out of the head's own inset", () => {
    const html = card();
    assert.equal(REST.head, `pl-[${RAIL_LEFT}px] pr-[${RAIL_RIGHT - WALL}px]`);
    assert.match(html, new RegExp(`pl-\\[${RAIL_LEFT}px\\] pr-\\[${RAIL_RIGHT - WALL}px\\]`));
  });

  test("an open card arrives at the same two edges through its border", () => {
    // Which is what keeps the columns from stepping sideways as a card opens.
    assert.equal(OPEN.head, `pl-${(RAIL_LEFT - BORDER) / 4} pr-${(RAIL_RIGHT - BORDER) / 4}`);
    assert.match(OPEN.face, /border /);
  });

  test("both spend the same total, so a stacked row is the same width", () => {
    // Below `sm` the columns divide the head's own width rather than taking a
    // fixed one, so landing the trailing edge in the same place is not enough on
    // its own.
    assert.equal(RAIL_LEFT + (RAIL_RIGHT - WALL) + WALL, RAIL_LEFT + RAIL_RIGHT);
  });

  /**
   * The same arithmetic one edge up. The plates are siblings of the *card*, so
   * their offset is measured from the card's box while the ledge has to land
   * against the *face's* trailing edge — which is 6px in at rest, where that
   * gutter is the slab's wall, and 1px in when the card is open and the face is a
   * bordered box at full width. One number would put the ledge in two places.
   */
  const PLATE_INSET = 14; // what the nameplate holds off the leading edge

  test("the ledge sits the nameplate's own inset off the face, in both states", () => {
    assert.equal(REST.edge, `right-${(PLATE_INSET + WALL) / 4}`);
    assert.equal(OPEN.edge, `right-[${PLATE_INSET + BORDER}px]`);
  });

  test("the leading edge needs no such pair", () => {
    // A slab's padding is bottom and trailing only, so the card's left edge is
    // the face's left edge in both states — which is why the row's `left-3.5` is
    // written once rather than carried by REST/OPEN.
    assert.match(card(), new RegExp(`left-${PLATE_INSET / 4} top-0`));
  });
});

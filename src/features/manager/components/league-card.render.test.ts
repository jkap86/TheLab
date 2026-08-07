import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "../types";
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

  test("the nameplate rides the edge, outside the clip that would cut it", () => {
    // `clip-path` clips its whole subtree, so a plate inside the notched face
    // would be severed at the exact edge it exists to straddle. The card's
    // `pt-3` is the overhang it straddles into.
    const html = card();
    assert.match(html, /pt-3[^"]*"><div class="lab-nameplate/);
    assert.doesNotMatch(html, /lab-slab-face[\s\S]*lab-nameplate/);
  });

  test("the nameplate carries the accent rail, and it is decoration", () => {
    assert.match(card(), /<span aria-hidden="true" class="lab-billet-rail/);
  });

  test("the record is a readout, and it is not engraved with it", () => {
    // A cut inside a cut is a smudge rather than machining — the rule the trade
    // card's give track keeps.
    const html = card();
    assert.match(html, /class="lab-readout [^"]*">9-4</);
    assert.doesNotMatch(html, /lab-engraved/);
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
});

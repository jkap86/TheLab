import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayerRow } from "./player-row.tsx";
import { SPLIT_LAYOUT } from "./roster-layout.ts";

/**
 * What a roster row promises about its two marks, without a DOM.
 *
 * The row carried a lineup slot on a chip *and* a position on a badge, and the
 * two were the same part in two colours stacked one above the other. What
 * replaced them is a rule rather than a component: **a chip is a lineup slot and
 * a position is letters**, and the letters are drawn only where the chip does
 * not already say the position. Every part of that is a string or a class this
 * file can check and a refactor can drop silently — none of it is expressible in
 * a type, and the failure mode is a row that renders perfectly well while saying
 * the same thing twice or not at all.
 *
 * The two *shapes* are deliberately not asserted here. Which of them a width
 * gets is a container query, so it is a fact about a browser rather than about
 * this markup, and it is measured where it can be measured — the tier
 * arithmetic and the strings it rests on are written out in `roster-layout`.
 */

const player = (over: Record<string, unknown> = {}) => ({
  player_id: "7",
  name: "Ashton Jeanty",
  position: "RB",
  team: "LV",
  ...over,
});

const row = (over: Partial<Parameters<typeof PlayerRow>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PlayerRow, {
      player: player(),
      playerId: "7",
      layout: SPLIT_LAYOUT,
      columns: [],
      values: {
        ktc: {},
        adp: {},
        adp_position: {},
        superflex: true,
        adp_draft_count: 0,
        adp_board: "dynasty",
        ktc_updated_at: null,
      },
      weekView: null,
      ...over,
    } as Parameters<typeof PlayerRow>[0]),
  );

/** How many times a bare position appears as its own word in the markup. */
const mentions = (html: string, word: string) =>
  html.match(new RegExp(`>${word}<`, "g"))?.length ?? 0;

describe("a chip is a lineup slot, never a position", () => {
  test("a starter in a dedicated slot says its position once, on the chip", () => {
    // The whole point: `QB` over `QB` was one fact drawn twice, and it cost the
    // row a line to say so.
    const html = row({
      slot: "QB",
      player: player({ name: "Matthew Stafford", position: "QB", team: "LAR" }),
    });
    assert.equal(mentions(html, "QB"), 1);
  });

  test("a flex starter says both, because the chip doesn't say the position", () => {
    // `FLEX` in emerald is a colour claim; the letters are the text behind it,
    // and this is the row a reader is actually asking "what is he?" about.
    const html = row({ slot: "FLEX" });
    assert.match(html, />FLEX</);
    assert.match(html, />RB</);
  });

  test("a slot Sleeper fills with another position says both", () => {
    // The IDP case: a league starts a player at `DL` whose position reads `LB`,
    // which is exactly the disagreement worth printing.
    const html = row({
      slot: "DL",
      player: player({ name: "Jeremiah Owusu-Koramoah", position: "LB", team: "CLE" }),
    });
    assert.match(html, />DL</);
    assert.match(html, />LB</);
  });

  test("a bench player has no slot, so he has no chip", () => {
    // `.lab-tab` is the chip's material and it is slot vocabulary: a bench row
    // wearing one would be claiming a lineup place it doesn't hold.
    const html = row({ slot: undefined });
    assert.doesNotMatch(html, /lab-tab/);
    assert.match(html, />RB</);
  });

  test("no row draws a position badge", () => {
    // `PositionBadge` is a fixed 32px filled pill and still correct on the
    // shares lists, where it is the only mark on the row. Here it is the part
    // that collided with the chip.
    for (const slot of ["QB", "FLEX", undefined]) {
      assert.doesNotMatch(row({ slot }), /w-8 shrink-0/);
    }
  });
});

describe("the abbreviation is a label, not the question being asked", () => {
  test("a superflex started by a quarterback still says both", () => {
    // `SLOT_LABEL` shortens `SUPER_FLEX` to `SFLX`, and comparing the *label*
    // to the position rather than the slot would be comparing against a string
    // no position is ever equal to — right by accident here, and wrong the
    // moment a label is ever shortened to a position's own spelling.
    const html = row({
      slot: "SUPER_FLEX",
      player: player({ name: "Bo Nix", position: "QB", team: "DEN" }),
    });
    assert.match(html, />SFLX</);
    assert.match(html, />QB</);
  });
});

describe("what an unfilled slot draws", () => {
  test("keeps its chip and offers no position", () => {
    // Sleeper pads an unfilled starting slot with an empty id: the slot is real
    // and there is nobody in it, so the chip stays and there is no position to
    // print — an em dash's worth of nothing, not a guess.
    const html = row({ slot: "TE", playerId: "", player: undefined });
    assert.match(html, />TE</);
    assert.match(html, />Empty</);
  });
});

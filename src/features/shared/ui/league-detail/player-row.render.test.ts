import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayerRow } from "./player-row.tsx";
import { SPLIT_LAYOUT } from "./roster-layout.ts";

/**
 * What a roster row promises about its marks, without a DOM.
 *
 * The row carried a lineup slot on a chip *and* a position on a badge, and the
 * two were the same part in two colours stacked one above the other. What
 * replaced them is a rule rather than a component: **a chip is a lineup slot,
 * and what a player is — his position and his NFL team — is letters beside his
 * name.** Every part of that is a string or a class this file can check and a
 * refactor can drop silently: none of it is expressible in a type, and the
 * failure mode is a row that renders perfectly well while saying nothing about
 * the player on it.
 *
 * The two *shapes* are deliberately not asserted here. Which of them a width
 * gets is a container query, so it is a fact about a browser rather than about
 * this markup, and it is measured where it can be measured — the tier
 * arithmetic and the strings it rests on are written out in `roster-layout`.
 *
 * The one width claim that *is* asserted here is the absence of one: the
 * position and the team must carry no responsive variant at all, because they
 * were each conditional once (the team on the two-line shape, the position on
 * disagreeing with the chip) and a column that only speaks up sometimes is a
 * column you cannot read down. A variant creeping back onto either span is
 * invisible in review and invisible in the type, so it is checked as a class.
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

/** How many times a bare word appears as its own text node in the markup. */
const mentions = (html: string, word: string) =>
  html.match(new RegExp(`>${word}<`, "g"))?.length ?? 0;

/** The class list of the span whose whole content is `word`. */
const classesFor = (html: string, word: string) =>
  html.match(new RegExp(`<span class="([^"]*)">${word}</span>`))?.[1] ?? null;

describe("every row says what the player is", () => {
  test("the position and the team ride beside the name, whatever the slot", () => {
    // A quarterback in the QB slot does say `QB` twice, and the two are not one
    // fact: the chip is a fact about the *lineup* and the letters are a fact
    // about the *player*. Suppressing the second is what left a reader unable
    // to read the position down the list.
    const html = row({
      slot: "QB",
      player: player({ name: "Matthew Stafford", position: "QB", team: "LAR" }),
    });
    assert.equal(mentions(html, "QB"), 2);
    assert.match(html, />LAR</);
  });

  test("a flex starter says both, and the chip still says the slot", () => {
    // `FLEX` in emerald is a colour claim; the letters are the text behind it,
    // and this is the row a reader is most obviously asking "what is he?" about.
    const html = row({ slot: "FLEX" });
    assert.match(html, />FLEX</);
    assert.match(html, />RB</);
    assert.match(html, />LV</);
  });

  test("a slot Sleeper fills with another position says both", () => {
    // The IDP case: a league starts a player at `DL` whose position reads `LB`,
    // which is exactly the disagreement the two marks exist to show.
    const html = row({
      slot: "DL",
      player: player({ name: "Jeremiah Owusu-Koramoah", position: "LB", team: "CLE" }),
    });
    assert.match(html, />DL</);
    assert.match(html, />LB</);
    assert.match(html, />CLE</);
  });

  test("a bench player has no slot, so he has no chip — and still says both", () => {
    // `.lab-tab` is the chip's material and it is slot vocabulary: a bench row
    // wearing one would be claiming a lineup place it doesn't hold. What it
    // says about the player is the same as any starter's, which is what lets
    // the two sections be read as one list.
    const html = row({ slot: undefined });
    assert.doesNotMatch(html, /lab-tab/);
    assert.match(html, />RB</);
    assert.match(html, />LV</);
  });

  test("neither is behind a width", () => {
    // The regression this guards is a quiet one: a `hidden`/`@3xl:` variant
    // back on either span renders fine and takes the fact off half the
    // viewports it is supposed to be on.
    for (const slot of ["QB", "FLEX", undefined]) {
      for (const word of ["RB", "LV"]) {
        const classes = classesFor(row({ slot, player: player() }), word);
        assert.ok(classes !== null, `no span drawing ${word} at slot ${slot}`);
        assert.doesNotMatch(classes, /(^|\s|:)hidden(\s|$)|@(lg|xl|2xl|3xl):/);
      }
    }
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
    // and there is nobody in it, so the chip stays and there is no position and
    // no team to print — an em dash's worth of nothing, not a guess.
    const html = row({ slot: "TE", playerId: "", player: undefined });
    assert.match(html, />TE</);
    assert.match(html, />Empty</);
    assert.equal(mentions(html, "TE"), 1);
    assert.doesNotMatch(html, />LV</);
  });
});

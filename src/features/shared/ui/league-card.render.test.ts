import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CardLedge,
  LeagueCard,
  OPEN,
  OPEN_BOX,
  REST,
  SCROLL_OFFSET,
} from "./league-card.tsx";

/**
 * The card without a DOM — the trade card's own test, for the card that shares
 * its material.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is most of what the
 * move to a slab changed: the surface, the nameplate, the status lamp, the head's
 * insets and where the disclosure semantics live are strings and conditionals, so
 * every one of them survives a refactor silently or not at all.
 *
 * **This is the shell, so it is rendered with stand-ins for the three things it
 * does not own** — the trailing plate, the specs bezel and the stat columns. What
 * each of its two callers puts there is that caller's own test (the leagues list's
 * record ledge and league specs, the lineup checker's opponent); what is pinned
 * here is the box they land in.
 *
 * **Only the resting card is rendered, and that is a boundary rather than a
 * gap.** An expanded one mounts the whole league detail panel, which wants a
 * query client and the shared ADP board around it — so rendering that state here
 * would be a markup test dragging a fetch-shaped thing behind it, and the panel
 * has its own tests. What the open state actually owes this file is that its
 * *geometry* still agrees with the heading rail, which is a fact about two class
 * strings — so those are asserted as strings.
 */

function card(over: Partial<Parameters<typeof LeagueCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(LeagueCard, {
      leagueId: "L1",
      name: "The Lab Dynasty",
      status: "in_season",
      // A stand-in for whatever a caller seats here, built from the same plate —
      // the assertions below are about the plate and the row it sits in.
      ledge: createElement(CardLedge, null, "2nd"),
      // Deliberately holds no control: the card's one button is the league's
      // name, and a stand-in with a press of its own would hide a regression.
      columns: createElement("span", null, "—"),
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
    // `LIST_ROW_SURFACE`, which the share cards still wear. A card carrying both
    // would be wearing two materials at once.
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
    const html = card();
    assert.match(html, /pt-3[^"]*"><div class="pointer-events-none absolute/);
    assert.doesNotMatch(html, /lab-slab-face[\s\S]*lab-nameplate/);
  });

  test("the row spanning the edge does not take the card's presses", () => {
    // It spans the whole edge and sits over the head's top inset, so without
    // this every press landing between the two plates would hit the row rather
    // than the toggle underneath. Each plate takes them back for itself.
    const html = card();
    assert.match(html, /class="pointer-events-none absolute[^"]*"/);
    assert.equal(html.split("pointer-events-auto").length - 1, 2);
  });

  test("the nameplate carries the accent rail, and it is decoration", () => {
    assert.match(card(), /<span aria-hidden="true" class="lab-billet-rail/);
  });

  test("a card with nothing to seat draws one plate, not an empty second", () => {
    // An empty housing on the edge is the card reporting that it has nothing to
    // report. Whether there is anything to say is the caller's call; that
    // `undefined` draws nothing is this shell's.
    const html = card({ ledge: undefined });
    assert.equal(html.split("lab-nameplate").length - 1, 1);
  });
});

describe("the specs line", () => {
  /** A stand-in for the specs bezel — what this shell owes it is a line. */
  const specs = createElement("span", { "data-specs": "" }, "1QB + SF");

  test("it is a line under the head, not a seat inside it", () => {
    // Measured rather than reasoned: seated in the head's leading half — which
    // is a `flex-1` holding nothing but the chevron, and looks free — the run has
    // 144px at `sm` beside four fixed 96px columns, and wraps to three rows there
    // for an ordinary league and five for a fully-specified one. On its own line
    // it is one row at every width from `sm` up. See {@link specs}.
    const html = card({ specs });
    const columns = html.indexOf("<span>—</span>");
    const line = html.indexOf("data-specs");
    assert.ok(columns >= 0 && columns < line, "the stat columns still lead");
    // Inside the face, so it is part of the card's own surface rather than a
    // second object under it.
    assert.ok(line < html.lastIndexOf("</div></div></li>"));
  });

  test("the line carries the head's own inset, so the two share an edge", () => {
    // A bezel that started at a different x from the chevron above it would read
    // as a part laid on the card rather than machined into it — and the inset is
    // per-state, which is why the box is this shell's and not the caller's.
    const html = card({ specs });
    assert.match(html, new RegExp(`class="flex shrink-0 ${literal(REST.head)} pb-3"`));
  });

  test("it is under the head's own press and never a second one", () => {
    // The head is the mouse affordance over the card's one toggle, and the
    // league's name on the plate is the button. A line that grew a control would
    // be a press inside a press.
    assert.equal(card({ specs }).split("<button").length - 1, 1);
  });

  test("a caller with nothing to say costs the card no line at all", () => {
    // Not an empty one: the box is 12px of padding whatever is in it, and a
    // league the sync has not answered for has no settings to report. The lineup
    // checker passes none at any time — its list is about one week's matchups.
    assert.equal(card({ specs: undefined }), card());
  });
});

/** A class list as a regex literal — the arbitrary values are full of brackets. */
const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    // chevron.
    const html = card();
    const plate = html.indexOf("lab-nameplate");
    const lamp = html.indexOf("in season");
    assert.ok(plate >= 0 && lamp > plate);
  });

  test("a finished league's lamp is a dark recess, not a dimmed fill", () => {
    // The plate is the lightest surface on the card, so a grey dot on it reads
    // as a lamp that is on and grey.
    const html = card({ status: "complete" });
    assert.match(html, /class="h-2 w-2 rounded-full lab-readout"/);
    assert.match(html, /complete<\/span>/);
  });

  test("the live states keep their glow", () => {
    assert.match(card(), /bg-active shadow-\[0_0_8px_rgba\(0,255,229,0\.7\)\]/);
    assert.match(card({ status: "drafting" }), /bg-amber-300/);
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

describe("where an open card pins", () => {
  /**
   * The chrome an open card has to clear, in the order it is stacked: the app
   * bar, then the list's heading rail pinned under it. The rail's term is
   * published at runtime (`usePinnedHeight`) because its height is whatever the
   * width being read makes it — it takes a second line below `sm` — so there is
   * no constant to assert against, which is exactly why the three places that
   * *name* it have to be asserted against each other.
   *
   * Three class strings carry it and none of them can be checked by a type: the
   * card sticks at this offset, the open-scroll aims at it, and the cap subtracts
   * it from the screen. Each failure is silent and different — a `top` short of
   * it puts the card's head under the rail, a `scroll-mt` short of it scrolls to
   * a position the card then refuses to hold, and a cap missing a term hangs the
   * panel's last rows off the bottom of the screen.
   */
  const CHROME = ["var(--site-header-h)", "var(--list-ledge-h)"];

  /** The body of one arbitrary value, e.g. `top-[…]` → what is in the brackets. */
  const arbitrary = (classes: string, prefix: string): string =>
    classes.match(new RegExp(`(?:^| )${prefix}-\\[([^\\]]+)\\]`))?.[1] ?? "";

  test("it sticks at exactly the offset it was scrolled to", () => {
    // Aimed at one position and holding another is a card that lands where it
    // was asked to and then jumps a plate's height the moment the reader
    // scrolls.
    const top = arbitrary(OPEN_BOX, "top");
    assert.equal(top, arbitrary(SCROLL_OFFSET, "scroll-mt"));
    assert.equal(top, `calc(${CHROME.join("+")})`);
  });

  test("the cap subtracts every term the offset adds", () => {
    // The two are one subtraction: whatever the card is pushed down by is
    // whatever the screen has less of for it.
    const cap = arbitrary(OPEN_BOX, "max-h");
    assert.match(cap, /^calc\(100svh/);
    for (const term of CHROME) {
      assert.ok(cap.includes(`-${term}`), `the cap does not subtract ${term}`);
    }
  });

  test("it stays under the pinned heading rail rather than over it", () => {
    // The rail is `z-30` and the subject rail's search panel floats down over
    // this card at `z-40`, so a card that outranked either would paint over it.
    // What keeps the *other* cards from painting over this one is that they
    // carry no `z` at all.
    assert.match(OPEN_BOX, /(?:^| )z-20(?: |$)/);
    assert.doesNotMatch(card(), /z-[234]0/);
  });
});

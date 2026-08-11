import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ManagerHeader } from "./manager-header.tsx";

/**
 * The plate without a DOM — the league card's own test, for the part that moved
 * to the same family of materials.
 *
 * **The slab is four class strings that have to agree with each other, and every
 * way of getting it wrong is invisible in review.** A wall wrapper whose chamfer
 * the face doesn't repeat shows a square corner behind a bevelled one; a face
 * that keeps `.lab-slab-face`'s corner-lit fill degenerates at this part's
 * proportions and leaves its trailing third sitting on the page ground; a slab
 * without `.lab-slab-fixed` lifts and blooms under the cursor, promising a press
 * that lands on nothing. None of the three is a type error, none changes the
 * content, and each reads as "the header looks a bit off" rather than as a bug
 * with a name. So they are pinned as strings, which is the only thing that can
 * hold an agreement no compiler can see.
 *
 * Rendered with the countdown off, because {@link HeaderReadout}'s clock half
 * mounts `useKickoff` — a query hook, which in a markup test is a fetch-shaped
 * thing dragged in behind a class assertion. The dial is the other half of the
 * same slot and the surface under it is identical either way.
 */

function plate(over: Partial<Parameters<typeof ManagerHeader>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ManagerHeader, {
      user: {
        user_id: "1",
        username: "jkap",
        display_name: "jkap",
        // Both halves: the stored id and the resolved URL. Null here so
        // {@link Avatar} draws its initial rather than an <img> this test has no
        // network for — the fallback is what carries the ring the surface
        // assertion below had to learn to look past.
        avatar: null,
        avatar_url: null,
      },
      season: "2026",
      record: { wins: 72, losses: 48, ties: 1, games: 121, pct: 0.54, leagues: 113 },
      scope: "dynasty leagues",
      leagueCount: 121,
      stat: { label: "Leagues", value: "121", sub: "of 121 total" },
      // The dial rather than the clock — see the note above.
      countdown: false,
      ...over,
    }),
  );
}

describe("the plate's material", () => {
  test("is a slab, and the wall and the face carry the same chamfer", () => {
    const html = plate();

    // A wall that turns four corners has to be cut on all four, on *both*
    // layers: the wrapper is the wall and the child is the lit face, so a notch
    // on one of them alone leaves the other showing a square corner behind it.
    assert.match(html, /class="lab-slab lab-slab-fixed lab-notch-all"/);
    assert.match(html, /class="lab-slab-face lab-slab-face-rail lab-notch-all[^"]*"/);
  });

  test("the face is the rail's fill, not a card's", () => {
    const html = plate();

    // `.lab-slab-face-rail` has to come *with* `.lab-slab-face` — it overrides
    // only the fill and the two falloffs, and inherits the brushed grain and the
    // specular sweep — and it has to come after it, since they collide on
    // `background` and `box-shadow` and source order decides.
    const face = html.match(/class="(lab-slab-face[^"]*)"/);
    assert.ok(face, "the plate should render a slab face");
    assert.ok(
      face[1].indexOf("lab-slab-face") < face[1].indexOf("lab-slab-face-rail"),
      "the rail fill must be declared after the face it overrides",
    );
  });

  test("it does not lift under the cursor", () => {
    // The header holds readouts; it is not a card you press. `.lab-slab-fixed`
    // is what cancels `.lab-slab`'s hover lift and bloom, and it only wins
    // because it is declared after `.lab-slab:hover` in `globals.css` — so its
    // presence here is half of an agreement whose other half is in that file.
    assert.match(plate(), /lab-slab-fixed/);
  });

  test("no glass survives on the surface itself", () => {
    const html = plate();

    // The marks of the surface this replaced, asserted as absences because the
    // failure they describe is a *partial* revert — a border or a
    // translucent-white fill left on a milled face reads as a seam in the part
    // rather than as an obvious mistake.
    //
    // **Scoped to the plate's own two boxes, not to the document.** The first
    // spelling of this asserted `border-foreground/10` was absent from the whole
    // render and failed on {@link Avatar}'s fallback ring — a different
    // component, several levels in, whose border is nothing to do with this
    // card's material. A surface assertion that reaches past its own surface
    // fails on whatever a child legitimately does.
    const surfaces = [...html.matchAll(/class="(lab-slab[^"]*)"/g)].map((m) => m[1]);
    assert.equal(surfaces.length, 2, "the plate is a wall and a face");
    for (const cls of surfaces) {
      assert.doesNotMatch(cls, /rounded/);
      assert.doesNotMatch(cls, /border/);
      assert.doesNotMatch(cls, /bg-\[/);
      assert.doesNotMatch(cls, /shadow-\[/);
    }
  });
});

describe("what the corners and the body owe the wall", () => {
  test("the corner tabs carry no outer radius", () => {
    const html = plate();

    // The plate's own `clip-path` cuts these tabs on its 9px diagonal, because a
    // clip applies to the whole subtree. A radius under that cut is a curve
    // inside a bevel — the tab reads as *almost* fitting its corner, which is
    // worse than either alone.
    assert.doesNotMatch(html, /rounded-tl-\[15px\]/);
    assert.doesNotMatch(html, /rounded-tr-\[15px\]/);
    // The inner returns stay: those corners are in the face, not on its edge.
    assert.match(html, /rounded-br-lg/);
    assert.match(html, /rounded-bl-lg/);
  });

  test("the body clears the face's own sweep", () => {
    // `.lab-slab-face::after` is generated last, so with everything on `auto` it
    // paints over the content. This plate's sweep has always sat *under* it.
    assert.match(plate(), /class="relative z-\[1\] flex items-center/);
  });

  test("the trailing inset pays for the wall", () => {
    const html = plate();

    // 21px from the leading edge and 17px from the trailing one is what the
    // bordered box gave (20+1 and 16+1). The trailing 6px is wall now, so the
    // padding gives it back — otherwise the part is 20px in on one side and
    // 26px in on the other, which reads as not square.
    assert.match(html, /pl-\[21px\] pr-\[11px\]/);
    assert.match(html, /sm:pl-\[25px\] sm:pr-\[15px\]/);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewSwitchRow } from "./view-switch.tsx";

/**
 * The manager's view switch.
 *
 * **What it is here to pin is a pair of claims the compiler cannot make.** The
 * first is the app's own grammar — raised means press me, recessed means you are
 * here — which is two class names and an element choice, so a "simplification"
 * that made the current cell a link to itself, or gave all three the same
 * material, would typecheck, render, and silently turn the switch into three
 * identical keys one of which does nothing. The second is that the two links go
 * to the *searched* manager: the tools menu resolves the same three entries
 * against the connected account, so a copy of its call would compile and quietly
 * navigate away from the account on screen.
 *
 * The words, the destinations and the patterns are the catalogue's and are
 * tested in `tools.test.ts`; what is asserted here is that this part reads them
 * rather than carrying a list of its own.
 */

const LEAGUES = "/manager/jkap86/leagues";

function row(pathname: string, searched = "jkap86"): string {
  return renderToStaticMarkup(
    createElement(ViewSwitchRow, { searched, pathname }),
  );
}

/** Every `href` in the markup, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

/**
 * The one cell marked current, as its own markup.
 *
 * Sliced per `<li>` rather than probed with a window around `aria-current`,
 * because the distance from that attribute to the label is the glyph seat and
 * its whole inline SVG — a number that changes whenever the icon does, which is
 * a test failing on an unrelated edit.
 */
function currentCell(html: string): string {
  const cells = html.split("<li").filter((cell) => cell.includes("aria-current"));
  assert.equal(cells.length, 1, "expected exactly one current cell");
  return cells[0];
}

describe("which cell is which", () => {
  test("three cells, one per manager view, in catalogue order", () => {
    const html = row(LEAGUES);
    assert.equal((html.match(/<li/g) ?? []).length, 3);
    const order = ["Leagues", "Players", "Leaguemates"].map((name) =>
      html.indexOf(`>${name}<`),
    );
    for (const at of order) assert.ok(at > -1, "expected every view named");
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test("the current view is sunk and is not a link", () => {
    // The grammar, spelled out: the cell you are on wears the cut (`.lab-seat`)
    // and the two you are not wear the block (`.lab-billet`). A current cell
    // that were a link to itself would travel under the finger and do nothing —
    // the one press this control must not offer.
    const html = row(LEAGUES);
    assert.equal((html.match(/lab-seat/g) ?? []).length, 1);
    assert.equal((html.match(/lab-billet-key/g) ?? []).length, 2);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.equal(hrefs(html).length, 2, "expected only the two you can go to");
    // …and it is the cell naming the view whose route we are on.
    assert.match(currentCell(html), />Leagues</);
  });

  test("the switch follows the route rather than a prop", () => {
    // Same component, a different path: the sunk cell moves to Players and
    // Leagues becomes one of the two doors.
    const html = row("/manager/jkap86/players");
    assert.match(currentCell(html), />Players</);
    assert.ok(
      hrefs(html).includes("/manager/jkap86/leagues"),
      "expected Leagues to be offered from the Players tab",
    );
  });
});

describe("where the two doors go", () => {
  test("to the searched manager, not to whoever is connected", () => {
    const html = row(LEAGUES);
    assert.deepEqual(hrefs(html), [
      "/manager/jkap86/players",
      "/manager/jkap86/leaguemates",
    ]);
  });

  test("a username needing encoding is encoded once", () => {
    // `toolHref` owns this, and owning it once is the point: `hrefFor`
    // interpolates the name bare, so a second call site encoding it again 404s
    // any account whose name is not plain ASCII.
    const html = row("/manager/a%20b/leagues", "a b");
    assert.deepEqual(hrefs(html), [
      "/manager/a%20b/players",
      "/manager/a%20b/leaguemates",
    ]);
  });
});

describe("a pathname the router could not give", () => {
  test("no cell is current, and all three are offered", () => {
    // `usePathname` is typed `string` and answers null outside the App Router,
    // which is what {@link ViewSwitch} folds to `""` before handing it here. A
    // switch that cannot say where you are should hand you every door rather
    // than light the wrong one — and must not, as it first did, throw.
    const html = row("");
    assert.doesNotMatch(html, /aria-current/);
    assert.doesNotMatch(html, /lab-seat/);
    assert.equal(hrefs(html).length, 3);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PanelTabs,
  panelBodyId,
  panelTabId,
  PANEL_TABS,
} from "./panel-tabs.tsx";

/**
 * What the panel's tab strip promises, none of which a type can carry.
 *
 * A tablist is an agreement between two boxes drawn in different components: the
 * tab has to name the body it switches and the body has to name the tab that is
 * lit, and every way of getting that wrong renders perfectly well — a reader
 * sees two keys that work, and a screen reader is told about a tab controlling
 * nothing. The roving `tabIndex` is the same kind of invisible: get it wrong and
 * the strip is either two tab stops in the middle of a card or none at all.
 *
 * The material is asserted for the reason the app's other render tests assert
 * class strings. The lit tab is a recessed well and the other a raised key —
 * "you are here" against "press me", the app bar's own grammar — and swapping
 * them is a strip that invites a press on the tab already showing.
 */

const strip = (tab: "standings" | "settings") =>
  renderToStaticMarkup(
    createElement(PanelTabs, { tab, onTab: () => {}, baseId: ":r1:" }),
  );

describe("panel tab strip", () => {
  test("every tab points at the one body, which names the lit tab", () => {
    // The body is rendered by the panel rather than here, so what this can pin
    // is the half the strip owns: both keys address the same id, and the id
    // arithmetic the panel labels that body with is the same function.
    const html = strip("standings");
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(controls, [
      panelBodyId(":r1:"),
      panelBodyId(":r1:"),
    ]);
    assert.match(html, new RegExp(`id="${panelTabId(":r1:", "standings")}"`));
    assert.match(html, new RegExp(`id="${panelTabId(":r1:", "settings")}"`));
  });

  test("one tab is selected and it is the one the panel is showing", () => {
    for (const { id } of PANEL_TABS) {
      const html = strip(id);
      assert.equal([...html.matchAll(/aria-selected="true"/g)].length, 1);
      // The selected attribute lands on the key whose own id names that tab —
      // adjacent in the markup, so a strip that lit the wrong key fails here.
      assert.match(
        html,
        new RegExp(`id="${panelTabId(":r1:", id)}"[^>]*aria-selected="true"`),
      );
    }
  });

  test("the strip is one stop in the tab order, not two and not none", () => {
    const html = strip("settings");
    assert.equal([...html.matchAll(/tabindex="0"/g)].length, 1);
    assert.equal([...html.matchAll(/tabindex="-1"/g)].length, 1);
  });

  test("the lit tab is recessed and the other is a raised key", () => {
    const html = strip("standings");
    // Whichever key carries the well must be the selected one: recessed is "you
    // are here" everywhere else in the app, and a raised lit tab would be a
    // control promising a press that does nothing.
    assert.match(html, /aria-selected="true"[^>]*class="[^"]*lab-well/);
    assert.match(html, /aria-selected="false"[^>]*class="[^"]*lab-chip/);
    assert.doesNotMatch(html, /aria-selected="true"[^>]*class="[^"]*lab-chip/);
  });

  test("the rail is a housing as wide as its keys, never the head's full width", () => {
    // A run that reached both walls would have to be filled, which is the trade
    // card's bezel rule and the reason this is `inline-flex`: two keys stretched
    // across a card read as a table header rather than as a control.
    assert.match(strip("standings"), /role="tablist"[^>]*class="[^"]*inline-flex/);
  });
});

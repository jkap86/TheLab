import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ColumnHeading } from "./column-heading.tsx";

/**
 * What a column heading in the league detail panel promises, without a DOM.
 *
 * The heading used to own a menu and now opens a dialog, and the difference is
 * carried almost entirely by strings a refactor can drop silently: the label is
 * the column's only name, `aria-haspopup` is what says which kind of thing opens,
 * and the caret is the one mark saying this is a control at all — it was drawn on
 * `group-hover` once, which meant a touch reader saw nothing.
 */

const heading = (over: Partial<Parameters<typeof ColumnHeading>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ColumnHeading, {
      label: "Optimal",
      // `renderToStaticMarkup` has no DOM to press with, so this is a stub and
      // what these tests are about is the markup.
      onOpen: () => {},
      ...over,
    }),
  );

describe("the heading as a trigger", () => {
  test("opens a dialog, not a menu", () => {
    // The menu is what went: a flat catalogue under the label could show no
    // preview, offer no named pair and say nothing about which other slot held
    // the metric being picked.
    const html = heading();
    assert.match(html, /aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /aria-haspopup="menu"/);
    assert.doesNotMatch(html, /role="menu"/);
  });

  test("is a button and carries the metric's label", () => {
    const html = heading({ label: "Bench" });
    assert.match(html, /<button/);
    assert.match(html, />Bench</);
  });

  test("titles itself, since a truncated heading is the column's only name", () => {
    assert.match(heading({ label: "Optimal" }), /title="Optimal"/);
  });

  test("draws its caret at rest rather than on hover alone", () => {
    // There is no hover on a touch device, which is where the control that
    // changes the column was left with nothing to say it was one.
    assert.match(heading(), /▾/);
    assert.match(heading(), /text-foreground\/25 transition-colors group-hover/);
  });
});

describe("the type treatment", () => {
  test("is the caller's, because a rail's tier decides it", () => {
    // `Optimal` measures 43.8px uppercase and tracked against a 42px standings
    // track, so both rails set sentence case at their narrow tiers — and two
    // `text-transform` utilities on one element are decided by their order in
    // the stylesheet, not in the attribute.
    const html = heading({ className: "normal-case tracking-normal @lg:uppercase" });
    assert.match(html, /normal-case tracking-normal @lg:uppercase/);
    assert.doesNotMatch(html, /class="[^"]*\buppercase tracking-wide\b/);
  });

  test("defaults to the uppercase rail treatment", () => {
    assert.match(heading(), /uppercase tracking-wide/);
  });
});

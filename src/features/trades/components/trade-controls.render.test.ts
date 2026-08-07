import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_LEAGUE_FILTERS } from "../../shared/league-filters/index.ts";
import { DEFAULT_TRADE_FILTERS } from "../filters.ts";
import type { TradeCircle, TradeFilters } from "../filters.ts";
import { TradeControls } from "./trade-controls.tsx";

/**
 * The scope instrument without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is nearly all of
 * what the move from four keys to a stepper changed: which circle the readout
 * names, which step keys are live, how many pips there are and where the lit one
 * is, and whether the sentence under it speaks. Every one of those is a string
 * or a conditional, so each survives a refactor silently or not at all — and the
 * ordering they all read from is asserted in `filters.test.ts`, one layer down.
 *
 * The two presses themselves are not tested here (there is no DOM to press
 * with); what a press *resolves to* is `stepCircle`, which is pure and tested.
 */

const ACCOUNT = {
  user_id: "1",
  username: "jkap",
  display_name: "jkap",
  avatar: null,
  avatar_url: null,
};

function controls(
  over: { circle?: TradeCircle; account?: typeof ACCOUNT | null } = {},
): string {
  const filters: TradeFilters = {
    ...DEFAULT_TRADE_FILTERS,
    circle: over.circle ?? DEFAULT_TRADE_FILTERS.circle,
  };
  return renderToStaticMarkup(
    createElement(TradeControls, {
      filters,
      onChange: () => {},
      leagueFilters: DEFAULT_LEAGUE_FILTERS,
      season: "2026",
      account: over.account === undefined ? ACCOUNT : over.account,
      names: { player: (id) => id, manager: (id) => id },
    }),
  );
}

/** How many pips the instrument drew, lit or not. */
function pips(markup: string): number {
  return (markup.match(/h-\[5px\] w-\[5px\]/g) ?? []).length;
}

/** Whether a step key with this label is the inert spelling. */
function dead(markup: string, label: string): boolean {
  const key = markup.slice(markup.indexOf(`aria-label="${label}"`));
  return key.slice(0, 400).includes("cursor-not-allowed");
}

describe("the scope instrument", () => {
  test("the readout names the circle the board is on", () => {
    assert.ok(controls().includes("Every league"));
    assert.ok(controls({ circle: "leaguemates" }).includes("Leaguemate trades"));
    assert.ok(
      controls({ circle: "leaguemate-leagues" }).includes("Leaguemate leagues"),
    );
  });

  test("there is one pip per circle, at every circle", () => {
    // The pips are the ordering made visible, so a circle added to the table
    // without one is a ladder that reads as shorter than it is.
    for (const circle of ["mine", "leaguemates", "leaguemate-leagues", "all"] as const) {
      assert.equal(pips(controls({ circle })), 4, circle);
    }
  });

  test("the lit pip moves with the circle", () => {
    // Lit is the accent plus its glow; unlit is a plain fill. Counting the
    // unlit ones is how the lit one's *position* is pinned without asserting a
    // whole class string.
    const unlit = (markup: string) =>
      (markup.match(/bg-foreground\/20/g) ?? []).length;
    assert.equal(unlit(controls({ circle: "mine" })), 3);
    assert.equal(unlit(controls({ circle: "all" })), 3);
  });

  test("a step with nowhere to go is drawn inert, not hidden", () => {
    // Both keys are always in the markup — `aria-disabled` rather than
    // `disabled`, so the sentence saying why stays reachable — and the ends of
    // the ladder are where each one goes dead.
    const widest = controls({ circle: "all" });
    assert.ok(widest.includes('aria-label="Widen the scope"'));
    assert.ok(dead(widest, "Widen the scope"));
    assert.ok(!dead(widest, "Narrow the scope"));

    const narrowest = controls({ circle: "mine" });
    assert.ok(dead(narrowest, "Narrow the scope"));
    assert.ok(!dead(narrowest, "Widen the scope"));
  });

  test("with no account stored both keys are inert", () => {
    // Every circle but the widest is drawn around an account, so there is
    // nowhere to step — and the keys stay in the document carrying the sentence
    // that says how to fix it.
    const anon = controls({ account: null });
    assert.ok(dead(anon, "Narrow the scope"));
    assert.ok(dead(anon, "Widen the scope"));
    assert.ok(anon.includes("Look your Sleeper account up"));
  });

  test("the circle's sentence is drawn on every circle", () => {
    // The four keys this replaced printed each circle's full name, so a note
    // repeating the selected one was a restatement and went quiet on the widest.
    // A readout has room for the name and not for what the name means, so the
    // sentence is now what the control cannot say — including on `all`.
    assert.ok(controls().includes("The whole crawled market."));
    assert.ok(
      controls({ circle: "leaguemates" }).includes(
        "Trades a leaguemate was party to",
      ),
    );
  });

  test("a narrowed circle says whose it is", () => {
    // The account is stored on the device and may not be the one the reader has
    // in mind, so a circle drawn around it names it.
    assert.ok(controls({ circle: "mine" }).includes("Drawn around @jkap."));
    // Nothing to attribute on the widest circle, which belongs to nobody.
    assert.ok(!controls().includes("Drawn around"));
  });

  test("the seek is not in this block", () => {
    // It is a position rather than a setting, and it lives on a pinned key over
    // the board now. A date field back in here is the regression that puts it
    // three screens above the reader again.
    assert.ok(!controls().includes('type="date"'));
    assert.ok(!controls().includes("Jump to"));
  });
});

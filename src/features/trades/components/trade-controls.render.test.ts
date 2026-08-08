import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_LEAGUE_FILTERS } from "../../shared/league-filters/index.ts";
import { DEFAULT_TRADE_FILTERS } from "../filters.ts";
import type { TradeCircle, TradeFilters } from "../filters.ts";
import {
  CIRCLE_NOTE_ID,
  TRADE_RAIL_BOX,
  TradeControls,
  TradeIdentity,
} from "./trade-controls.tsx";

/**
 * The two halves of the board's controls, without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is nearly all of
 * what these parts are: which circle the readout names, which step keys are
 * live, how many pips there are and where the lit one is, and what the plate
 * says about the board. Every one of those is a string or a conditional, so each
 * survives a refactor silently or not at all — and the ordering they all read
 * from is asserted in `filters.test.ts`, one layer down.
 *
 * **What this file gained when the block split in two is the agreement between
 * them.** The plate carries the sentence and the rail carries the keys that
 * point at it, so the reference crosses a component boundary as a bare string
 * ({@link CIRCLE_NOTE_ID}) that no type checks. Both ends are asserted here,
 * because a rename on one side leaves an `aria-describedby` aimed at nothing and
 * nothing else in the build will say so.
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

type Over = { circle?: TradeCircle; account?: typeof ACCOUNT | null };

function filtersFor(over: Over): TradeFilters {
  return {
    ...DEFAULT_TRADE_FILTERS,
    circle: over.circle ?? DEFAULT_TRADE_FILTERS.circle,
  };
}

/** The pinned rail: the stepper, what is narrowing the board, and the keys. */
function rail(over: Over = {}): string {
  return renderToStaticMarkup(
    createElement(TradeControls, {
      filters: filtersFor(over),
      onChange: () => {},
      leagueFilters: DEFAULT_LEAGUE_FILTERS,
      season: "2026",
      account: over.account === undefined ? ACCOUNT : over.account,
      names: { player: (id: string) => id, manager: (id: string) => id },
    }),
  );
}

/** The identity plate: what board this is, in words. */
function plate(over: Over = {}): string {
  return renderToStaticMarkup(
    createElement(TradeIdentity, {
      filters: filtersFor(over),
      account: over.account === undefined ? ACCOUNT : over.account,
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
    // The plate naming it in words scrolls away, so from there on this readout
    // is the only place on screen the answer is written.
    assert.ok(rail().includes("Every league"));
    assert.ok(rail({ circle: "leaguemates" }).includes("Leaguemate trades"));
    assert.ok(
      rail({ circle: "leaguemate-leagues" }).includes("Leaguemate leagues"),
    );
  });

  test("there is one pip per circle, at every circle", () => {
    // The pips are the ordering made visible, so a circle added to the table
    // without one is a ladder that reads as shorter than it is.
    for (const circle of [
      "mine",
      "leaguemates",
      "leaguemate-leagues",
      "all",
    ] as const) {
      assert.equal(pips(rail({ circle })), 4, circle);
    }
  });

  test("the lit pip moves with the circle", () => {
    // Lit is the accent plus its glow; unlit is a plain fill. Counting the
    // unlit ones is how the lit one's *position* is pinned without asserting a
    // whole class string.
    const unlit = (markup: string) =>
      (markup.match(/bg-foreground\/20/g) ?? []).length;
    assert.equal(unlit(rail({ circle: "mine" })), 3);
    assert.equal(unlit(rail({ circle: "all" })), 3);
  });

  test("a step with nowhere to go is drawn inert, not hidden", () => {
    // Both keys are always in the markup — `aria-disabled` rather than
    // `disabled`, so the sentence saying why stays reachable — and the ends of
    // the ladder are where each one goes dead.
    const widest = rail({ circle: "all" });
    assert.ok(widest.includes('aria-label="Widen the scope"'));
    assert.ok(dead(widest, "Widen the scope"));
    assert.ok(!dead(widest, "Narrow the scope"));

    const narrowest = rail({ circle: "mine" });
    assert.ok(dead(narrowest, "Narrow the scope"));
    assert.ok(!dead(narrowest, "Widen the scope"));
  });

  test("with no account stored both keys are inert", () => {
    // Every circle but the widest is drawn around an account, so there is
    // nowhere to step — and the keys stay in the document carrying the pointer
    // to the sentence that says how to fix it.
    const anon = rail({ account: null });
    assert.ok(dead(anon, "Narrow the scope"));
    assert.ok(dead(anon, "Widen the scope"));
  });
});

describe("the identity plate", () => {
  test("the circle's sentence is drawn on every circle", () => {
    // The four keys this replaced printed each circle's full name, so a note
    // repeating the selected one was a restatement and went quiet on the widest.
    // A readout has room for the name and not for what the name means, so the
    // sentence is what the control cannot say — including on `all`.
    assert.ok(plate().includes("The whole crawled market."));
    assert.ok(
      plate({ circle: "leaguemates" }).includes(
        "Trades a leaguemate was party to",
      ),
    );
  });

  test("a narrowed circle says whose it is", () => {
    // The account is stored on the device and may not be the one the reader has
    // in mind, so a circle drawn around it names it.
    assert.ok(plate({ circle: "mine" }).includes("Drawn around @jkap."));
    // Nothing to attribute on the widest circle, which belongs to nobody.
    assert.ok(!plate().includes("Drawn around"));
  });

  test("with no account the sentence carries the way out", () => {
    // It is what the rail's two inert keys point at, so it has to say what to
    // do about them rather than only what the circle is.
    assert.ok(plate({ account: null }).includes("Look your Sleeper account up"));
  });

  test("what is narrowing the board is on the rail, not the plate", () => {
    // It reads as description and is the one part of it a press *moves* —
    // pressing Leagues changes it — so it is feedback, and feedback belongs
    // where the control is rather than on a plate that has scrolled away.
    assert.ok(rail().includes("2026 · all leagues"));
    assert.ok(!plate().includes("2026"));
  });

  test("the narrowing line contracts before the row wraps", () => {
    // Flex wraps on hypothetical sizes and only shrinks *within* a line
    // afterwards, so a basis of `auto` here puts the whole sentence on the row
    // before anything gives way and the trailing key drops to a second line —
    // 40px of permanently pinned band, spent on the one member of this row that
    // is neither a control nor the feedback for one. A basis of zero is what
    // makes this the part that gives way, which is what its own note claims.
    const line = rail().slice(rail().indexOf("2026 · all leagues") - 300);
    assert.ok(line.includes("min-w-0 flex-1 truncate"));
    assert.ok(!line.slice(0, 300).includes("basis-"));
  });

  test("the plate holds no controls at all", () => {
    // It is the half that is read once and scrolls away; every press on this
    // page is on the rail below, which is what makes pinning that rail worth
    // its permanent coverage. A control here is one that scrolls out of reach.
    assert.ok(!plate().includes("<button"));
    assert.ok(!plate().includes('type="date"'));
  });
});

describe("the two halves agree", () => {
  test("the inert keys point at the sentence the plate draws", () => {
    // The one reference in this pair that crosses a component boundary, and the
    // only thing holding it together is a shared string constant — so a rename
    // on either side is caught here or not at all.
    assert.ok(plate().includes(`id="${CIRCLE_NOTE_ID}"`));
    assert.ok(
      rail({ account: null }).includes(`aria-describedby="${CIRCLE_NOTE_ID}"`),
    );
  });

  test("the rail pins under the app bar and clips nothing", () => {
    // Pinned is the whole point of the split: the plate scrolls, this stays.
    assert.ok(TRADE_RAIL_BOX.includes("sticky"));
    assert.ok(TRADE_RAIL_BOX.includes("top-[var(--site-header-h)]"));
    // **No clip-path.** The seek key's date plate hangs below this rail's bottom
    // edge and its panel opens beneath it, and `clip-path` clips a whole
    // subtree — the trade card's nameplate rule, which this is the third part to
    // meet. A notch added here severs both, and neither is in this markup to
    // catch it (the page seats them as `trailing`).
    assert.ok(!TRADE_RAIL_BOX.includes("lab-notch"));
  });
});

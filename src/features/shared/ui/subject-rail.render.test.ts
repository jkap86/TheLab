import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";

import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "../league-filters/defaults.ts";
import { createQueryClient } from "../query-client.ts";
import type { SubjectView } from "../subject-view.ts";
import { SubjectRail } from "./subject-rail.tsx";

/**
 * The filter row, and the two doors on it.
 *
 * **What this file is here to pin is an absence.** The rail latched its lazy
 * sheets *during render* —
 * `if (sheet && !mounted.includes(sheet)) setMounted([...mounted, sheet])` —
 * which is a render-phase update, and the frame it lands in is already the most
 * expensive one in the app: a `<dialog>` mounting, two lazy chunks evaluating,
 * and the roster and ADP reads starting. The latch is a fold called from the
 * press handler now ({@link latchSheet}, tested beside itself), so the two
 * writes are one batched update and this component's body is a function of its
 * props.
 *
 * What a static render can reach is the half of that claim about the markup: at
 * rest neither sheet is mounted, so neither chunk is asked for, and each key is
 * a real control with a handler behind it. The other half — that a press
 * produces one update rather than two passes — is the fold's, which is why it is
 * a fold.
 */

const league = (id: string): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: { type: 2 },
  roster_positions: ["QB", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
});

const LEAGUES = [league("a"), league("b"), league("c")];

const view: SubjectView = {
  searched: "jkap",
  userId: "1",
  leagues: LEAGUES,
  leagueFiltered: LEAGUES,
  filtered: LEAGUES,
  filters: DEFAULT_LEAGUE_FILTERS,
  setFilters: () => {},
  subjects: { subjects: [], match: "all" },
  setSubjects: () => {},
  subjectDisplay: () => null,
  subjectsLoading: false,
};

/**
 * A client for the dispatcher, retired the moment it has answered.
 *
 * The two sub-resource reads are React Query hooks gated on the search panel
 * being open, so nothing is ever fetched — which is also the claim that a tab
 * this rail is never opened on costs no request. What a rendered observer *does*
 * leave behind is the app's half-hour `gcTime` as a live timer, which on a
 * server render nothing ever unmounts: the runner would sit there for thirty
 * minutes after the last assertion. `overrides` exists for exactly this.
 */
function withClient(node: ReactNode): string {
  const client = createQueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, node),
    );
  } finally {
    client.clear();
  }
}

/** The rail's markup. */
function rail(over: Partial<SubjectView> = {}): string {
  return withClient(createElement(SubjectRail, { view: { ...view, ...over } }));
}

/** Every element in a returned tree, depth-first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (child: ReactNode) => {
    for (const next of Children.toArray(child)) {
      if (!isValidElement<Record<string, unknown>>(next)) continue;
      found.push(next);
      visit((next.props as { children?: ReactNode }).children);
    }
  };
  visit(node);
  return found;
}

/**
 * The rail's tree, unrendered.
 *
 * A probe puts the call inside `renderToStaticMarkup` so React's dispatcher is
 * live and the component's own hooks bind to the probe's slots — the same helper
 * the ADP drawer's render test uses, and for the same reason: markup carries the
 * words and the states, but not the handlers.
 */
function tree(): ReactNode {
  let captured: ReactNode = null;
  function Probe() {
    captured = SubjectRail({ view });
    return null;
  }
  withClient(createElement(Probe));
  return captured;
}

describe("the two doors", () => {
  test("both keys are on the row, each announcing a dialog", () => {
    const html = rail();
    // They name the *act*, not the list: "Players" and "Leaguemates" are two
    // whole views of the account, and are the words the switch above this row
    // carries. A key naming a destination it does not go to is what made both
    // of these hard to place — what they open is a picker over the list you are
    // already on.
    assert.match(html, />Browse players</);
    assert.match(html, />Browse leaguemates</);
    assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
  });

  test("neither sheet is mounted until one is pressed", () => {
    // The chunk-splitting intent, seen from the markup: a reader who never opens
    // a browse downloads neither the players half's ADP apparatus nor the
    // leaguemates half's catalogue, and a reader who opens one downloads one.
    const html = rail();
    for (const inside of [
      "Search player shares",
      "Search leaguemate shares",
      "Reading rosters…",
      "Reading member lists…",
      "<dialog",
    ]) {
      assert.ok(
        !html.includes(inside),
        `expected no sheet at rest, found ${inside}`,
      );
    }
  });

  test("each key carries a handler, and pressing one does not throw", () => {
    // What a static render can say about the latch: the press path is a function
    // this component owns, rather than a state update the render body makes on
    // the way past. The update itself is `latchSheet`, pinned beside itself.
    const keys = elements(tree()).filter(
      (el) => el.type === "button" && el.props["aria-haspopup"] === "dialog",
    );
    assert.equal(keys.length, 2, "expected a key per kind");
    for (const key of keys) {
      const press = key.props.onClick;
      assert.equal(typeof press, "function");
      (press as () => void)();
    }
  });
});

describe("the row itself", () => {
  test("the search is one field over both kinds", () => {
    // A reader typing a name already knows which kind it is, so making them pick
    // a field first is a question with no purpose — the opposite half of the
    // argument that gives each *browse* its own key.
    const html = rail();
    assert.match(html, />Player or leaguemate</);
  });

  // The plate's corner tab already states the account's total a few pixels up,
  // so an unnarrowed rail printing it again is the numerator twice — the second
  // time with its only label `sr-only` and announced by a `role="status"` on a
  // page where nothing changed.
  test("prints no count while nothing has narrowed", () => {
    const html = rail();
    assert.doesNotMatch(html, /role="status"/);
    assert.doesNotMatch(html, /<span class="sr-only"> leagues<\/span>/);
  });

  test("a narrowed list states both halves", () => {
    const narrowed = rail({ filtered: [LEAGUES[0]] });
    assert.match(narrowed, /role="status"/);
    assert.match(narrowed, /1 of 3<span class="sr-only"> leagues<\/span>/);
  });
});

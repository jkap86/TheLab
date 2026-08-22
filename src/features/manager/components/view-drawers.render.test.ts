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

import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "@/features/shared/league-filters/defaults";
import type { SubjectView } from "@/features/shared/subject-view";
import { ManagerViewDrawers } from "./view-drawers.tsx";

/**
 * The leagues page's own view row: two keys, no cell for the page you are on.
 *
 * **What is worth pinning here is what is *absent*, and why it is absent.** The
 * Leagues cell is gone because a league is the page rather than a subject on it
 * — spelled in the tools catalogue as the two other views declaring what they
 * browse and Leagues declaring nothing — so a test that only counted two keys
 * would pass equally for a file that filtered the third out by name. It asserts
 * the names against the catalogue instead, which is what makes a rename here a
 * failure rather than a drift.
 *
 * The rest is the drawer contract a static render can reach: both keys are
 * buttons rather than links (nothing here navigates), each announces a dialog
 * and reports itself shut, and neither browse is mounted until one is pressed —
 * the chunk-splitting claim `useSharesBrowse` exists for, seen from the markup.
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

const row = () =>
  renderToStaticMarkup(createElement(ManagerViewDrawers, { view }));

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
 * The row's tree, unrendered — a probe, so React's dispatcher is live and the
 * component's hooks bind to the probe's slots. Markup carries the words and the
 * states; only this carries the handlers.
 */
function tree(): ReactNode {
  let captured: ReactNode = null;
  function Probe() {
    captured = ManagerViewDrawers({ view });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return captured;
}

describe("the row the switch becomes on the leagues page", () => {
  test("the two other views are keys, and Leagues is not one of them", () => {
    const html = row();
    assert.match(html, />Players</);
    assert.match(html, />Leaguemates</);
    // The page you are on has no cell: the switch draws one as a cut-in seat
    // that does nothing when pressed, which is a cell spent on nothing once the
    // other two stop being routes to leave by.
    assert.doesNotMatch(html, />Leagues</);
    assert.doesNotMatch(html, /aria-current/);
  });

  test("Players leads, which is the side each browse comes in from", () => {
    // Players opens from the left and Leaguemates from the right — `SharesSheet`
    // owns that, and what this row owes it is the matching order. A left key
    // opening a right drawer is a panel arriving from nowhere.
    const html = row();
    assert.ok(
      html.indexOf(">Players<") < html.indexOf(">Leaguemates<"),
      "expected the left-hand browse's key to lead the row",
    );
  });

  test("nothing here navigates", () => {
    const html = row();
    assert.doesNotMatch(html, /<a /);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  });

  test("the keys are the switch's own cells", () => {
    // Imported rather than retyped: a reader crossing from the Players route
    // back to Leagues should meet the same part, not a second part shaped like
    // it. The wall and the face are what carry that.
    const html = row();
    assert.equal((html.match(/lab-billet lab-billet-key/g) ?? []).length, 2);
    assert.equal((html.match(/lab-billet-face/g) ?? []).length, 2);
  });

  test("neither browse is mounted until one is pressed", () => {
    const html = row();
    for (const inside of [
      "Search player shares",
      "Search leaguemate shares",
      "Reading rosters…",
      "Reading member lists…",
      "<dialog",
    ]) {
      assert.ok(
        !html.includes(inside),
        `expected no browse at rest, found ${inside}`,
      );
    }
  });

  test("each key carries a handler, and pressing one does not throw", () => {
    const keys = elements(tree()).filter(
      (el) => el.type === "button" && el.props["aria-haspopup"] === "dialog",
    );
    assert.equal(keys.length, 2, "expected a key per browsable view");
    for (const key of keys) {
      const press = key.props.onClick;
      assert.equal(typeof press, "function");
      (press as () => void)();
    }
  });
});

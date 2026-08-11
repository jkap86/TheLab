import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RosterDetail } from "./roster-detail.tsx";
import { RosterHeading } from "./roster-heading.tsx";

/**
 * What a week panel's two halves promise about *whose* they are.
 *
 * The panel drew a standings beside one roster, and on a week it draws two
 * rosters instead — so the one thing the standings used to supply, the name of
 * the team the rows belong to, now has to come from each half. Everything below
 * is a string or a class: none of it is expressible in a type, and every failure
 * renders perfectly well. A half that loses its heading is two identical lists
 * side by side; a half that loses its surface is two lineups that look equally
 * editable when only one of them is.
 *
 * Which arrangement a panel gets is not asserted here — that is
 * {@link headToHead}, which is pure and tested beside this. What is asserted is
 * that each half, handed its half of that answer, draws it.
 */

const team = (id: number, name: string) => ({
  roster_id: id,
  owner_id: `u${id}`,
  manager: {
    user_id: `u${id}`,
    display_name: name,
    team_name: `${name} FC`,
    avatar_url: null,
  },
  record: { wins: 9, losses: 4, ties: 0 },
  fpts: 1234.56,
  fpts_against: 1100,
  players: ["7"],
  starters: ["7"],
  reserve: [],
  taxi: [],
  picks: [],
});

const weekView = {
  week: 5,
  ppg_source: { season: "2026", weeks: 4, prior: false },
  projection: { "7": 18.4 },
  ppg: {},
  team_projection: {
    // A lineup with something left on the bench, and one already optimal.
    "1": { optimal: 142.6, current: 131.2, points_left: 11.4 },
    "2": { optimal: 128.05, current: 128.05, points_left: 0 },
  },
  team_ppg: {},
} as never;

const values = {
  ktc: {},
  adp: {},
  adp_position: {},
  superflex: true,
  adp_draft_count: 0,
  adp_board: "dynasty",
  ktc_updated_at: null,
};

/** One half of a week panel, as the panel composes it. */
const half = (id: number, name: string, opponent: boolean) =>
  renderToStaticMarkup(
    createElement(RosterDetail, {
      team: team(id, name),
      teams: [team(1, "jkap"), team(2, "Darkside")],
      players: {
        "7": { player_id: "7", name: "Ashton Jeanty", position: "RB", team: "LV" },
      },
      rosterPositions: ["QB", "RB", "BN"],
      outlook: null,
      values,
      weekView,
      columns: ["week_proj"],
      onOpenColumn: () => {},
      surface: opponent ? "recessed" : "raised",
      heading: createElement(RosterHeading, {
        team: team(id, name),
        weekView,
        opponent,
      }),
    } as never),
  );

describe("a week panel's own half", () => {
  test("is a raised plate, names the reader, and states its best lineup", () => {
    const html = half(1, "jkap", false);
    assert.match(html, /lab-plate lab-plate-sm/);
    assert.doesNotMatch(html, /lab-trough/);
    assert.match(html, />jkap</);
    assert.match(html, />142\.60</);
    // The layout says which half this is and the `vs` says it on the other one;
    // neither is available to a screen reader, so the heading says it outright.
    assert.match(html, /Your team: /);
    assert.doesNotMatch(html, />vs</);
  });

  test("carries what is currently set on the hover, not in a second column", () => {
    // The same spelling the `week_proj` column uses, because it is that number
    // at the team's grain — one figure written two ways is the drift this
    // codebase keeps closing.
    const html = half(1, "jkap", false);
    assert.match(html, /142\.60 from the best lineup available/);
    assert.match(html, /131\.20 as currently set/);
    assert.match(html, /11\.40 left on the bench/);
  });
});

describe("the opponent's half", () => {
  test("is the recessed field, and says whose it is twice over", () => {
    // Recessed is the app's own grammar for a part that is read rather than
    // acted on, which is exactly the difference between the two lineups: a
    // reader can move their own players and not these.
    const html = half(2, "Darkside", true);
    assert.match(html, /lab-trough/);
    assert.doesNotMatch(html, /lab-plate/);
    assert.match(html, />vs</);
    assert.match(html, />Darkside</);
    assert.match(html, /Opponent: /);
  });

  test("states its own total, and says nothing about a bench with nothing on it", () => {
    const html = half(2, "Darkside", true);
    assert.match(html, />128\.05</);
    assert.doesNotMatch(html, /left on the bench/);
  });
});

describe("a season panel is untouched by any of it", () => {
  test("no heading, raised, and both value tracks", () => {
    // The leagues list and the trades board pass neither prop, and the plate
    // this half used to head itself with stays gone — the standings beside it
    // names the team, which is the argument that removed it.
    const html = renderToStaticMarkup(
      createElement(RosterDetail, {
        team: team(1, "jkap"),
        teams: [team(1, "jkap")],
        players: {},
        rosterPositions: ["QB"],
        outlook: null,
        values: { ...values, ktc: { "7": 8200 } },
        weekView: null,
        columns: ["start", "bench"],
        onOpenColumn: () => {},
      } as never),
    );
    assert.match(html, /lab-plate lab-plate-sm/);
    assert.doesNotMatch(html, /lab-trough/);
    assert.doesNotMatch(html, />jkap</);
    assert.match(html, /grid-cols-\[minmax\(0,1fr\)_2\.875rem_2\.875rem\]/);
  });
});

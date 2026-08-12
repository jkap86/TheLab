import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RosterDetail } from "./roster-detail.tsx";
import { RosterHeading } from "./roster-heading.tsx";

/**
 * What a week panel's two halves promise: whose they are, and which lineup they
 * are listing.
 *
 * The panel drew a standings beside one roster, and on a week it draws two
 * rosters instead — so the one thing the standings used to supply, the name of
 * the team the rows belong to, now has to come from each half. Everything below
 * is a string or a class: none of it is expressible in a type, and every failure
 * renders perfectly well. A half that loses its heading is two identical lists
 * side by side; a half that loses its surface is two lineups that look equally
 * editable when only one of them is.
 *
 * The lineup half of it is the same kind of invisible. A week panel lists what a
 * team is **actually** starting and marks what to change about it; a season panel
 * lists the best lineup available and marks nothing. Both are lists of players
 * under the word `Starters`, so a half reading the wrong source, or drawing the
 * right source with the marks lost, is a panel that answers the other question
 * fluently — which is the one failure mode a reader cannot catch.
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
  // A quarterback and two backs, one of them benched — the smallest roster that
  // can hold a lineup worth changing.
  players: ["9", "7", "8"],
  // Deliberately not the best lineup: Bijan outprojects Jeanty and is sitting.
  starters: ["9", "7"],
  reserve: [],
  taxi: [],
  picks: [],
});

const players = {
  "9": { player_id: "9", name: "Josh Allen", position: "QB", team: "BUF" },
  "7": { player_id: "7", name: "Ashton Jeanty", position: "RB", team: "LV" },
  "8": { player_id: "8", name: "Bijan Robinson", position: "RB", team: "ATL" },
};

/** The lineup a team is starting, as the server's own comparison reports it. */
const lineup = (rb: string) => [
  { slot: "QB", player_id: "9" },
  { slot: "RB", player_id: rb },
];

const weekView = {
  week: 5,
  ppg_source: { season: "2026", weeks: 4, prior: false },
  projection: { "9": 22.1, "7": 12.4, "8": 18.4 },
  ppg: {},
  team_projection: {
    // A lineup with something left on the bench, and one already optimal.
    "1": {
      optimal: 142.6,
      current: 131.2,
      points_left: 11.4,
      lineup: lineup("7"),
      sit: ["7"],
      start: ["8"],
    },
    "2": {
      optimal: 128.05,
      current: 128.05,
      points_left: 0,
      lineup: lineup("8"),
      sit: [],
      start: [],
    },
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
const half = (id: number, name: string, opponent: boolean, bestBall = false) =>
  renderToStaticMarkup(
    createElement(RosterDetail, {
      team: team(id, name),
      teams: [team(1, "jkap"), team(2, "Darkside")],
      players,
      rosterPositions: ["QB", "RB", "BN"],
      outlook: null,
      values,
      weekView,
      columns: ["week_proj"],
      onOpenColumn: () => {},
      surface: opponent ? "recessed" : "raised",
      bestBall,
      heading: createElement(RosterHeading, {
        team: team(id, name),
        weekView,
        opponent,
      }),
    } as never),
  );

/** Which of the two marks, if either, a name is wearing. */
const marked = (html: string, name: string): "sit" | "start" | null => {
  // A row's name span carries the `title` *and* the tone, so one opening tag
  // answers both halves of the question — and finding it by the title is what
  // keeps this from matching the position and team spans nested beside the name.
  const at = html.indexOf(`<span title="${name}`);
  assert.notEqual(at, -1, `${name} is not on this half at all`);
  const tag = html.slice(at, html.indexOf(">", at));
  if (tag.includes("text-amber-300")) return "sit";
  if (tag.includes("text-active")) return "start";
  return null;
};

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

  test("lists what the team is actually starting, not the best lineup", () => {
    // Jeanty is in the RB slot and Bijan outprojects him. A half reading the
    // optimal lineup instead would seat Bijan and read as a settled lineup — the
    // one wrong answer here that looks like a working one.
    const html = half(1, "jkap", false);
    const starters = html.slice(html.indexOf("Starters"), html.indexOf("Bench"));
    assert.match(starters, /Ashton Jeanty/);
    assert.doesNotMatch(starters, /Bijan Robinson/);
  });

  test("marks both ends of the swap, and only those two rows", () => {
    const html = half(1, "jkap", false);
    // Amber is the app's needs-attention tone and the accent is where the points
    // are; a swap has two ends in two lists, so neither mark alone is readable.
    assert.equal(marked(html, "Ashton Jeanty"), "sit");
    assert.equal(marked(html, "Bijan Robinson"), "start");
    assert.equal(marked(html, "Josh Allen"), null);
    // Colour is the whole of the mark at this width, so what it means has to be
    // written down somewhere a reader who cannot see it will reach.
    assert.match(html, /Swap out: /);
    assert.match(html, /Swap in: /);
  });

  test("says nothing about a lineup that is already right", () => {
    const html = half(2, "Darkside", true);
    assert.equal(marked(html, "Bijan Robinson"), null);
    assert.doesNotMatch(html, /Swap out: /);
    assert.doesNotMatch(html, /Best ball/);
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

describe("a best-ball week", () => {
  test("draws the lineup Sleeper seats and marks nothing on it", () => {
    // Roster 2's lineup is the optimal one, which is what a best-ball league
    // actually starts however its `starters` array reads.
    const html = half(2, "Darkside", true, true);
    const starters = html.slice(html.indexOf("Starters"), html.indexOf("Bench"));
    assert.match(starters, /Bijan Robinson/);
    assert.doesNotMatch(starters, /Ashton Jeanty/);
    assert.doesNotMatch(html, /Swap out: /);
  });

  test("says why, because an unmarked lineup is otherwise ambiguous", () => {
    // Nothing marked reads identically to a lineup the manager got right, and
    // the players listed differ from the ones Sleeper shows under Starters.
    assert.match(half(2, "Darkside", true, true), /Best ball/);
  });
});

describe("a season panel is untouched by any of it", () => {
  test("no heading, raised, both value tracks, and no marks", () => {
    // The leagues list and the trades board pass neither prop, and the plate
    // this half used to head itself with stays gone — the standings beside it
    // names the team, which is the argument that removed it. The marks stay gone
    // too: that list *is* the best lineup, so there is nothing to disagree with.
    const html = renderToStaticMarkup(
      createElement(RosterDetail, {
        team: team(1, "jkap"),
        teams: [team(1, "jkap")],
        players,
        rosterPositions: ["QB", "RB", "BN"],
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
    assert.equal(marked(html, "Ashton Jeanty"), null);
    assert.doesNotMatch(html, /Swap out: /);
  });
});

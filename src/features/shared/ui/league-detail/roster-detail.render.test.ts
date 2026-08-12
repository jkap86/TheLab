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

/** Sunday 1:05 PM local, so the rendered string is the same in any zone. */
const SUNDAY = new Date(2026, 8, 13, 13, 5).getTime();

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
    // Neither carries a kickoff ordering, which is "no answer" and draws no
    // re-seat marks — the marked case has its own fixtures below.
    "1": {
      optimal: 142.6,
      current: 131.2,
      points_left: 11.4,
      lineup: lineup("7"),
      sit: ["7"],
      start: ["8"],
      kickoff_order: null,
    },
    "2": {
      optimal: 128.05,
      current: 128.05,
      points_left: 0,
      lineup: lineup("8"),
      sit: [],
      start: [],
      kickoff_order: null,
    },
  },
  team_ppg: {},
  // Two of the three clubs on these rosters play; ATL is on a bye, which is an
  // absence from a non-empty map rather than an entry saying so.
  games: {
    BUF: { opponent: "MIA", home: true, kickoff: SUNDAY },
    LV: { opponent: "KC", home: false, kickoff: SUNDAY },
  },
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

/** The same half as the leagues list and the trades board draw it: no week at all. */
const seasonHalf = () =>
  renderToStaticMarkup(
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

  test("gives every player his NFL game, and a bye where there isn't one", () => {
    // The two facts a lineup is set on. Whether they are *drawn* is what this
    // asserts; what each one says is `playerGame`, pure and tested beside this.
    const html = half(1, "jkap", false);
    assert.match(html, /vs MIA/);
    assert.match(html, /@ KC/);
    assert.match(html, /Sun 1:05p/);
    // Bijan's club plays no game in this fixture, which is a bye — and a bye is
    // an absence from the week rather than an entry saying so, so a row reading
    // it as "not known" would quietly say nothing at all.
    assert.match(html, />BYE</);
  });

  test("a season panel names no game, because there is no week to read one from", () => {
    // The one thing that must not follow this feature onto the leagues list and
    // the trades board: those panels are a rest-of-season shape with no Sunday
    // in them, so an opponent there would be a claim about a week nobody asked
    // about.
    const html = seasonHalf();
    assert.doesNotMatch(html, />BYE</);
    assert.doesNotMatch(html, /Sun 1:05p/);
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
    const html = seasonHalf();
    assert.match(html, /lab-plate lab-plate-sm/);
    assert.doesNotMatch(html, /lab-trough/);
    assert.doesNotMatch(html, />jkap</);
    assert.match(html, /grid-cols-\[minmax\(0,1fr\)_2\.875rem_2\.875rem\]/);
    assert.equal(marked(html, "Ashton Jeanty"), null);
    assert.doesNotMatch(html, /Swap out: /);
  });
});

describe("the kickoff re-seat marks", () => {
  // Two backs the seats can trade: Jeanty at RB, Bijan in the flex, and the
  // ordering wanting them the other way around.
  const reseatTeam = { ...team(3, "jkap"), players: ["7", "8"], starters: ["7", "8"] };

  const view = (over: object = {}) =>
    ({
      week: 5,
      ppg_source: { season: "2026", weeks: 4, prior: false },
      projection: { "7": 12.4, "8": 18.4 },
      ppg: {},
      team_projection: {
        "3": {
          optimal: 30.8,
          current: 30.8,
          points_left: 0,
          lineup: [
            { slot: "RB", player_id: "7" },
            { slot: "FLEX", player_id: "8" },
          ],
          sit: [],
          start: [],
          kickoff_order: [
            { slot: "RB", player_id: "8" },
            { slot: "FLEX", player_id: "7" },
          ],
          ...over,
        },
      },
      team_ppg: {},
      games: {},
    }) as never;

  const renderHalf = (weekView: never) =>
    renderToStaticMarkup(
      createElement(RosterDetail, {
        team: reseatTeam,
        teams: [reseatTeam],
        players,
        rosterPositions: ["RB", "FLEX", "BN"],
        outlook: null,
        values,
        weekView,
        columns: ["week_proj"],
        onOpenColumn: () => {},
      } as never),
    );

  test("marks both ends of a seat trade with the seat each should take", () => {
    // A trade has two ends in one list — unlike a swap, whose ends sit in two —
    // and half a trade is advice a reader cannot follow.
    const html = renderHalf(view());
    assert.match(html, /seat him at FLEX/);
    assert.match(html, /seat him at RB/);
    // What the arrow means, written where a reader who cannot see it will reach.
    assert.equal(html.split("Re-seat at ").length - 1, 2);
  });

  test("a swap out outranks a re-seat, so a name never wears two marks", () => {
    // Re-seating a player the solve would bench is polishing the wrong lineup;
    // the other end of the trade keeps its mark.
    const html = renderHalf(view({ sit: ["7"] }));
    assert.equal(marked(html, "Ashton Jeanty"), "sit");
    assert.equal(html.split("Re-seat at ").length - 1, 1);
    assert.match(html, /seat him at RB/);
    assert.doesNotMatch(html, /seat him at FLEX/);
  });

  test("no ordering draws no marks — null is never `already ordered`", () => {
    // Best ball, or a week the schedule names no instants for: claiming either
    // lineup is already in order would be the wrong answer that looks right.
    assert.doesNotMatch(renderHalf(view({ kickoff_order: null })), /Re-seat at /);
  });
});

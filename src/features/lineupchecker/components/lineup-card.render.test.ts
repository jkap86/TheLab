import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

import type { LeagueMatchup } from "../types.ts";
import { LineupCard } from "./lineup-card.tsx";
import { LineupStatHeadings } from "./lineup-columns.tsx";

/**
 * The card without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is the half of this
 * component no type can hold: the four states of the opponent are strings chosen
 * by a conditional, and the columns' alignment with the headings above them is a
 * shared class that a refactor can silently retype. `opponent.ts` pins which
 * state a row is *in*; this pins that the card spends it.
 *
 * The card's own material — the slab, the plates, the press, the geometry it
 * shares with the heading rail — is `features/shared/ui/league-card` and is
 * tested there. What is left for this file is the one thing that is this list's:
 * what rides on the trailing plate, and the four columns.
 */

const league: ManagerLeague = {
  league_id: "L1",
  name: "Dynasty Warriors",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins: 3, losses: 1, ties: 0 },
  settings: null,
  roster_positions: null,
  scoring_settings: null,
};

const matchup = (over: Partial<LeagueMatchup> = {}): LeagueMatchup => ({
  roster_id: 1,
  opponent: null,
  projection: null,
  opponent_projection: null,
  ...over,
});

const render = (week: number | null, matchup: LeagueMatchup | undefined) =>
  renderToStaticMarkup(
    createElement(LineupCard, {
      league,
      week,
      matchup,
      expanded: false,
      onToggle: () => {},
    }),
  );

describe("the opponent ledge", () => {
  test("names the opponent by username, with the team name on the hover", () => {
    const html = render(
      3,
      matchup({
        opponent: {
          roster_id: 7,
          user_id: "42",
          display_name: "jkap86",
          team_name: "Team Chaos",
          avatar_url: null,
        },
      }),
    );

    assert.match(html, /jkap86/);
    assert.match(html, /title="Team Chaos"/);
    // The team name is demoted to the hover, not printed on the card beside it.
    assert.equal(html.includes(">Team Chaos<"), false);
  });

  test("it rides the trailing plate, opposite the league's name", () => {
    // Where the leagues list seats the record. Both plates are on the card's top
    // edge, before the wall — so the opponent is stated before the slab begins,
    // and there are two plates rather than the one a card with nothing to seat
    // would draw.
    const html = render(
      3,
      matchup({
        opponent: {
          roster_id: 7,
          user_id: "42",
          display_name: "jkap86",
          team_name: null,
          avatar_url: null,
        },
      }),
    );
    assert.equal(html.split("lab-nameplate").length - 1, 2);
    assert.ok(html.indexOf("jkap86") < html.indexOf("lab-slab lab-notch-lg"));
  });

  test("spells the three kinds of nothing differently", () => {
    // Three different facts — a real bye, a week the crawler has not reached,
    // and a season with nothing stored ahead of today. Collapsing them would
    // tell a reader their league has no game when what it has is no data.
    assert.match(render(3, matchup()), />Bye</);
    assert.match(render(3, undefined), />Not synced yet</);
    assert.match(render(null, undefined), />No week scheduled</);
  });

  test("the plate is drawn even when there is no opponent to name", () => {
    // Where the leagues list's record ledge draws nothing rather than an empty
    // housing: here "nothing" is itself the answer the card exists to give.
    assert.equal(render(3, undefined).split("lab-nameplate").length - 1, 2);
  });
});

describe("the stat columns", () => {
  test("draws four stat cells on every card, whatever the matchup says", () => {
    for (const html of [render(3, matchup()), render(null, undefined)]) {
      // Three em dashes for the reserved slots, and a fourth for a bench gap
      // there is no projection to form.
      assert.equal(html.split("—").length - 1, 4);
    }
  });

  test("the bench gap says what to do, or that there is nothing to do", () => {
    const gap = render(
      3,
      matchup({ projection: { optimal: 132.5, current: 120.16, points_left: 12.34 } }),
    );
    // Amber and signed: the one number on the card that is a verdict rather than
    // a count, spelled as the expanded panel's own `Lineup gap` spells it.
    assert.match(gap, /\+12\.34/);
    assert.match(gap, /text-amber-300/);

    // Zero is a real answer and a good one, so it reads as a word rather than as
    // `+0.00`, which down a list looks like a number that failed to arrive.
    const set = render(
      3,
      matchup({ projection: { optimal: 120, current: 120, points_left: 0 } }),
    );
    assert.match(set, />set</);
    assert.equal(set.includes("text-amber-300"), false);
    // And it is not the em dash a *missing* projection prints: three left, for
    // the reserved slots.
    assert.equal(set.split("—").length - 1, 3);
  });

  test("the cells and the headings resolve to one column width", () => {
    const headings = renderToStaticMarkup(createElement(LineupStatHeadings));
    const row = render(3, undefined);

    // The shared geometry, spelled once in `ui/stat-columns` and worn by both
    // ends. A rail a hair wider than the numbers under it reads as a misaligned
    // table, and nothing but this catches a retyped width.
    const width = "sm:w-24";
    assert.equal(headings.split(width).length - 1, 4);
    assert.equal(row.split(width).length - 1, 4);
  });
});

describe("the press", () => {
  test("the card opens into the league, and its name is the control", () => {
    // It was a glass row that opened into nothing and deliberately did not lift
    // under the pointer. It is the leagues list's card now, so the press is
    // real: the league's name is the one button, carrying the disclosure state.
    const html = render(3, undefined);
    assert.match(html, /<h2 [^>]*><button type="button"/);
    assert.match(html, /aria-expanded="false"/);
    assert.equal(html.split("<button").length - 1, 1);
  });
});

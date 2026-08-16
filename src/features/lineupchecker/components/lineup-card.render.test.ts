import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

import { withQueryClient } from "@/features/shared/query-test-support";
import { MetricHeadings } from "@/features/shared/ui/metric-column";

import {
  DEFAULT_LINEUP_COLUMNS,
  LINEUP_METRICS,
} from "../lineup-metrics.ts";
import type { LeagueMatchup } from "../types.ts";
import { LineupCard } from "./lineup-card.tsx";

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
  median_projection: null,
  ...over,
});

const render = (week: number | null, matchup: LeagueMatchup | undefined) =>
  renderToStaticMarkup(
    withQueryClient(createElement(LineupCard, {
      league,
      week,
      matchup,
      columns: DEFAULT_LINEUP_COLUMNS,
      expanded: false,
      onToggle: () => {},
    })),
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

/** A week projecting `current`, against the bars given. */
const projected = (
  current: number,
  bars: { opponent?: number | null; median?: number | null },
): LeagueMatchup =>
  matchup({
    opponent: {
      roster_id: 7,
      user_id: "42",
      display_name: "jkap86",
      team_name: null,
      avatar_url: null,
    },
    projection: { optimal: current, current, points_left: 0, kickoff_moves: null },
    opponent_projection: bars.opponent ?? null,
    median_projection: bars.median ?? null,
  });

/** The letters on the ledge's readouts, in the order they are drawn. */
const marks = (html: string) =>
  [...html.matchAll(/aria-hidden="true">([WLT])</g)].map((m) => m[1]);

describe("the projected verdict", () => {
  test("an ordinary league prints one mark, after the opponent's name", () => {
    const html = render(3, projected(120, { opponent: 100 }));

    assert.deepEqual(marks(html), ["W"]);
    // After the name, which is the seat that says what it is a result against.
    assert.ok(html.indexOf("jkap86") < html.indexOf('aria-hidden="true">W<'));
  });

  test("a median league prints two, the head-to-head first", () => {
    // Nothing on the plate is written to explain the pair, so the order is what
    // says which mark is which — and both readings travel for the hover.
    const html = render(3, projected(110, { opponent: 100, median: 120 }));

    assert.deepEqual(marks(html), ["W", "L"]);
    assert.match(html, /Projected winning against jkap86/);
    assert.match(html, /Projected losing against the league median/);
  });

  test("a win is lit and a loss is not", () => {
    // The accent is what this app says for *on*, and it is free on this card:
    // amber is spent one column over on the shortfall, which is the number here
    // a reader can act on. Read off each mark's own class rather than by
    // position, so a tone landing on the wrong letter cannot pass.
    const html = render(3, projected(110, { opponent: 100, median: 120 }));
    const tones = [
      ...html.matchAll(
        /class="([^"]*lab-readout[^"]*)"><span class="sr-only">[^<]*<\/span><span aria-hidden="true">([WLT])</g,
      ),
    ].map(([, cls, mark]) => [mark, cls] as const);

    assert.equal(tones.length, 2);
    assert.match(tones[0][1], /text-active/);
    assert.equal(tones[0][0], "W");
    assert.match(tones[1][1], /text-foreground\/40/);
    assert.equal(tones[1][0], "L");
  });

  test("a bye in a median league still prints the field's result", () => {
    // The mark is read off the matchup rather than off `matchupState`: an
    // odd-sized median league byes somebody every week and they still have the
    // field to beat, so the plate says `Bye` and `W` at once.
    const html = render(
      3,
      matchup({
        projection: { optimal: 130, current: 130, points_left: 0, kickoff_moves: null },
        median_projection: 120,
      }),
    );

    assert.match(html, />Bye</);
    assert.deepEqual(marks(html), ["W"]);
  });

  test("nothing to project prints no mark, rather than a blank housing", () => {
    // A league with no slots or scoring on file, and a week the crawler has not
    // reached. An em dash here would report a result that does not exist.
    assert.deepEqual(marks(render(3, projected(120, {}))), []);
    assert.deepEqual(marks(render(3, matchup({ opponent_projection: 100 }))), []);
    assert.deepEqual(marks(render(3, undefined)), []);
  });
});

describe("the stat columns", () => {
  test("draws four stat cells on every card, whatever the matchup says", () => {
    for (const html of [render(3, matchup()), render(null, undefined)]) {
      // Three em dashes for the blank slots, and a fourth for a shortfall there
      // is no projection to form.
      assert.equal(html.split("—").length - 1, 4);
    }
  });

  test("the shortfall reads against the optimal lineup, not toward it", () => {
    const gap = render(
      3,
      matchup({
        projection: {
          optimal: 132.5,
          current: 120.16,
          points_left: 12.34,
          kickoff_moves: null,
        },
      }),
    );
    // `current − optimal`: a lineup with points on its bench is *behind* the best
    // one available, so the number carries a minus and never a plus. Amber
    // because it is the one figure on the row that is a verdict rather than a
    // count.
    assert.match(gap, /-12\.34/);
    assert.equal(gap.includes("+12.34"), false);
    assert.match(gap, /text-amber-300/);

    // Zero is a real answer and a good one, so it reads as a word rather than as
    // `-0.00`, which down a list looks like a number that failed to arrive.
    const set = render(
      3,
      matchup({
        projection: { optimal: 120, current: 120, points_left: 0, kickoff_moves: null },
      }),
    );
    assert.match(set, />set</);
    assert.equal(set.includes("text-amber-300"), false);
    // And it is not the em dash a *missing* projection prints: three left, for
    // the blank slots.
    assert.equal(set.split("—").length - 1, 3);
  });

  test("the cells and the headings resolve to one column width", () => {
    const headings = renderToStaticMarkup(
      createElement(MetricHeadings, {
        metrics: LINEUP_METRICS,
        columns: DEFAULT_LINEUP_COLUMNS,
        subject: "League",
        onOpen: () => {},
      }),
    );
    const row = render(3, undefined);

    // The shared geometry, spelled once in `ui/stat-columns` and worn by both
    // ends. A rail a hair wider than the numbers under it reads as a misaligned
    // table, and nothing but this catches a retyped width.
    const width = "sm:w-24";
    assert.equal(headings.split(width).length - 1, 4);
    assert.equal(row.split(width).length - 1, 4);
  });

  test("every heading is a trigger, blank columns included", () => {
    // The rail used to draw flat labels because there was nothing behind a
    // press — three of them an em dash, hidden from the accessibility tree.
    // Every column is aimable now, so every heading is a button naming what its
    // column holds, and `Blank` is a name a reader can read before pressing it.
    const headings = renderToStaticMarkup(
      createElement(MetricHeadings, {
        metrics: LINEUP_METRICS,
        columns: DEFAULT_LINEUP_COLUMNS,
        subject: "League",
        onOpen: () => {},
      }),
    );
    assert.equal(headings.split("<button").length - 1, 4);
    assert.equal(headings.split('aria-haspopup="dialog"').length - 1, 4);
    assert.equal(headings.split(">Blank<").length - 1, 2);
    assert.match(headings, />Vs optimal</);
    assert.match(headings, />Kickoff</);
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

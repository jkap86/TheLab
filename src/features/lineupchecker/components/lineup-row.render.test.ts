import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

import type { LeagueMatchup } from "../types.ts";
import { LineupStatHeadings } from "./lineup-columns.tsx";
import { LineupRow } from "./lineup-row.tsx";

/**
 * The row without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees*, which is the half of this
 * component no type can hold: the four states of the opponent line are strings
 * chosen by a conditional, and the columns' alignment with the headings above
 * them is a shared class that a refactor can silently retype. `opponent.ts` pins
 * which state a row is *in*; this pins that the row spends it.
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

const render = (week: number | null, matchup: LeagueMatchup | undefined) =>
  renderToStaticMarkup(createElement(LineupRow, { league, week, matchup }));

describe("LineupRow", () => {
  test("names the opponent by username, with the team name on the hover", () => {
    const html = render(3, {
      roster_id: 1,
      opponent: {
        roster_id: 7,
        user_id: "42",
        display_name: "jkap86",
        team_name: "Team Chaos",
        avatar_url: null,
      },
    });

    assert.match(html, /jkap86/);
    assert.match(html, /title="Team Chaos"/);
    // The team name is demoted to the hover, not printed on the row beside it.
    assert.equal(html.includes(">Team Chaos<"), false);
  });

  test("spells the three kinds of nothing differently", () => {
    assert.match(render(3, { roster_id: 1, opponent: null }), /Bye this week/);
    assert.match(render(3, undefined), /Matchup not synced yet/);
    assert.match(render(null, undefined), /No week scheduled/);
  });

  test("draws four stat cells on every row, whatever the matchup says", () => {
    for (const html of [
      render(3, { roster_id: 1, opponent: null }),
      render(null, undefined),
    ]) {
      // The em dash the blank columns print — one per reserved slot.
      assert.equal(html.split("—").length - 1, 4);
    }
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

  test("the row does not lift under the pointer — it opens into nothing", () => {
    assert.equal(render(3, undefined).includes("hover:-translate-y-0.5"), false);
  });
});

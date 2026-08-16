import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { LeagueWeekViewPayload } from "@/shared/contract";

import { WeekMedianBar } from "./week-median.tsx";

/**
 * What the median bar promises, none of which a type carries.
 *
 * Two of the three are about *absence* — the states this app keeps separating —
 * and both render perfectly well when they are wrong: a bar drawn for a league
 * that plays no median is a rule invented out of nothing, and an em dash where
 * the bar would be reports a hole in a number the league never had.
 *
 * The third is which reading is printed. `optimal` and `current` are both real
 * numbers and either would render, so nothing but an assertion says the figure
 * on the band is in the same units as the two roster headings beside it.
 */

const view = (
  median: LeagueWeekViewPayload["median"],
): LeagueWeekViewPayload => ({
  week: 3,
  ppg_source: { season: "2026", weeks: 2, prior: false },
  projection: {},
  ppg: {},
  team_projection: {},
  median,
  team_ppg: {},
  games: {},
});

const render = (weekView: LeagueWeekViewPayload | null) =>
  renderToStaticMarkup(createElement(WeekMedianBar, { weekView }));

describe("the week median bar", () => {
  test("names the bar and prints it", () => {
    const html = render(view({ optimal: 118.4, current: 112.35 }));

    assert.match(html, />median</);
    assert.match(html, />118\.40</);
  });

  test("prints the best lineups' median, with the set ones on the hover", () => {
    // The roster headings beside it show each team's *best* lineup, so the bar
    // has to be the middle of that same reading or the three figures on the
    // band cannot be compared. What the week comes to untouched is the other
    // question, and it is a hover away here exactly as it is on both halves.
    const html = render(view({ optimal: 118.4, current: 112.35 }));

    assert.equal(html.includes(">112.35<"), false);
    assert.match(
      html,
      /title="118\.40 from the best lineups available · 112\.35 as currently set"/,
    );
  });

  test("a league that plays no median draws nothing at all", () => {
    // Not an em dash: that reports a hole in a number, and a league whose
    // scoring never applies a median has no number to be missing.
    assert.equal(render(view(null)), "");
  });

  test("a season panel and a failed week read draw nothing either", () => {
    assert.equal(render(null), "");
  });
});

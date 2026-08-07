import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { LeagueRankSet, ManagerLeague } from "../types";
import { LeagueCard } from "./league-card";

/**
 * What this list puts on the card's trailing plate: the manager's record here,
 * and where that record places them.
 *
 * The card itself — the slab, the two plates, the head's insets, the press and
 * the geometry it shares with the heading rail — is
 * `features/shared/ui/league-card` and is tested there. What is left for this
 * file is the one thing that is *this* list's: the ledge. The lineup checker
 * seats this week's opponent in the same box and tests its own.
 *
 * Both facts used to sit in the head between the chevron and the stat columns,
 * which is the one part of the card that has to stay quiet — so what these pin is
 * that they are on the *edge*, that the plate is a housing rather than a second
 * name, and that "absent is not zero" survived the move.
 */

const league: ManagerLeague = {
  league_id: "L1",
  name: "The Lab Dynasty",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins: 9, losses: 4, ties: 0 },
  settings: { type: 2 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
} as ManagerLeague;

/**
 * A standing and nothing else. The card's four stat columns are pointed at the
 * ranks this leaves null, so they draw their em dashes and what is left on
 * screen is the ledge — which is the part these tests are about.
 */
const RANKS: LeagueRankSet = {
  standing: { rank: 2, of: 12 },
  points: null,
  proj: null,
  proj_bench: null,
};

function card(over: Partial<Parameters<typeof LeagueCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(LeagueCard, {
      league,
      ranks: null,
      weeks: [],
      ktc: null,
      valuedAt: null,
      adp: null,
      columns: ["record_rank", "points_rank", "ktc_starters_rank", "proj_rank"],
      expanded: false,
      onToggle: () => {},
      ...over,
    }),
  );
}

describe("the record ledge", () => {
  test("both facts are on the edge, and neither is left in the head", () => {
    const html = card({ ranks: RANKS });
    const row = html.indexOf("pointer-events-none absolute");
    const wall = html.indexOf("lab-slab lab-notch-lg");
    // Everything the ledge says is before the card's own wall begins.
    assert.ok(row >= 0 && row < wall);
    assert.ok(html.indexOf("9-4") < wall);
    assert.ok(html.indexOf("2nd") < wall);
  });

  test("the record keeps the readout it wore in the head", () => {
    // The move is a change of seat, not of material: a reader has nothing to
    // relearn, and a cut into the plate's lit face is what makes the plate a
    // housing rather than a label.
    assert.match(card({ ranks: RANKS }), /lab-nameplate[\s\S]*lab-readout[^"]*">9-4</);
  });

  test("the record is a readout, and it is not engraved with it", () => {
    // A cut inside a cut is a smudge rather than machining — the rule the trade
    // card's give track keeps.
    const html = card({ ranks: RANKS });
    assert.match(html, /class="lab-readout [^"]*">9-4</);
    assert.doesNotMatch(html, /class="lab-readout lab-engraved|lab-engraved[^"]*">9-4/);
  });

  test("the standing is engraved, and it is the rank alone", () => {
    // Engraved rather than lit for the arithmetic the trade card's values
    // answer: there is one of these per card down the whole list, and a numeral
    // in the accent at that count is wallpaper.
    const html = card({ ranks: RANKS });
    assert.match(html, /class="lab-engraved[^"]*">2nd/);
    // The denominator is what the stat columns' rank cells spend their width on;
    // here it would come out of the league name's own truncation budget.
    assert.doesNotMatch(html, />2nd of 12</);
  });

  test("the denominator survives where it costs no width", () => {
    // A bare ordinal is a rank out of nothing, and this is the one reading of
    // the card that has no hover to fall back on.
    const html = card({ ranks: RANKS });
    assert.match(html, /title="#2 of 12 by record"/);
    assert.match(html, /<span class="sr-only"> of 12 by record<\/span>/);
  });

  test("a preseason league states the record and no standing", () => {
    // `0-0` is a true count; a rank there would place a season nobody has
    // played. The same rule the stat columns' rank cells keep.
    const html = card({
      league: { ...league, record: { wins: 0, losses: 0, ties: 0 } },
      ranks: { standing: null, points: null, proj: null, proj_bench: null },
    });
    assert.match(html, /lab-readout[^"]*">0-0</);
    assert.doesNotMatch(html, /lab-engraved/);
  });

  test("a league with neither fact has no plate at all", () => {
    // An empty housing on the edge is the card reporting that it has nothing to
    // report — where the lineup checker's ledge parts company, since there
    // "nothing to report" is itself an answer worth printing. The name's own
    // plate is untouched.
    const html = card({ league: { ...league, record: null } });
    assert.equal(html.split("lab-nameplate").length - 1, 1);
    assert.doesNotMatch(html, /lab-readout/);
  });
});

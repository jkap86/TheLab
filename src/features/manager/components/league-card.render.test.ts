import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { withQueryClient } from "../query-test-support";

import type { LeagueRankSet, ManagerLeague } from "../types";
import { LeagueCard } from "./league-card";

/**
 * What this list puts in the card's two seats: the manager's record and standing
 * on the trailing plate, and what kind of league it is in the head's quiet half.
 *
 * The card itself — the slab, the two plates, the head's two lines and their
 * insets, the press and the geometry it shares with the heading rail — is
 * `features/shared/ui/league-card` and is tested there, including which of those
 * lines a seated node lands on. What is left for this file is what *this* list
 * seats. The lineup checker puts this week's opponent in the same plate, seats no
 * specs, and tests its own.
 *
 * Both record facts used to sit in the head in front of the stat columns, which is
 * the one part of the card that has to stay quiet — so what these pin is that they
 * are on the *edge*, that the plate is a housing rather than a second name, and
 * that "absent is not zero" survived the move. The specs pin the same rule read
 * the other way: the run says nothing rather than guessing where a league has not
 * answered.
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
    withQueryClient(createElement(LeagueCard, {
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
    })),
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
    // Probed by what the standing *says* rather than by its finish: the specs
    // bezel seated in the head cuts its captions into the floor the same way, so
    // `lab-engraved` alone stopped being this plate's own mark the moment a
    // second part on the card wore one.
    assert.doesNotMatch(html, /by record/);
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

describe("the league specs", () => {
  test("what kind of league it is, on the card rather than in the filters", () => {
    // An account here is a hundred leagues most of which differ in exactly these
    // ways, and the only thing that answered "which of these is my superflex
    // dynasty" was the filter dialog — which narrows a list rather than
    // describing a row of it.
    const html = card();
    assert.match(html, /Dynasty/);
    assert.match(html, /12 Team/);
    assert.match(html, /1QB \+ SF/);
    assert.match(html, /1TE/);
  });

  test("it is the trades board's bezel, not a second drawing of one", () => {
    // The part moved to `features/shared/ui` when this list became its second
    // caller. A copy would be two answers to what a league's settings look like,
    // and the material is what a reader crossing between the tools recognises.
    const html = card();
    assert.equal(html.split("lab-bezel").length - 1, 1);
    assert.equal(html.split("lab-gauge").length - 1, 4);
  });

  test("it is on the card's own face, above the four columns", () => {
    // The columns *measure* the league and the run says which game the league is,
    // so the qualifier reads before the number it qualifies: `#2 of 10` means one
    // thing in a 3QB best-ball auction and another in a plain redraft. It is the
    // trade card's rank for the same run, which leads that card's interior too.
    const html = card();
    const wall = html.indexOf("lab-slab lab-notch-lg");
    const bezel = html.indexOf("lab-bezel");
    const columns = html.indexOf("divide-x divide-foreground/10");
    assert.ok(wall >= 0 && bezel > wall, "the run is inside the card's face");
    assert.ok(columns >= 0 && bezel < columns, "and before the stat columns");
  });

  test("a league the sync has not answered for draws no line", () => {
    // Whether there is anything to say is this list's call, not the shell's: an
    // empty line is 12px of padding on every card of an account still syncing,
    // and a bezel of em dashes would report six holes instead of one absence.
    const html = card({
      league: {
        ...league,
        settings: { type: 9 },
        roster_positions: null,
        total_rosters: 0,
      },
    });
    assert.doesNotMatch(html, /lab-bezel/);
    // The head's two lines each carry its inset, so a card drawing one line wears
    // it once — which is a probe for the *box* rather than for the bezel inside
    // it, since an empty line is exactly what costs the padding.
    assert.equal(html.split("pl-[21px] pr-[11px]").length - 1, 1);
  });

  test("an unsynced lineup drops the lineup gauges rather than reading them as zero", () => {
    // The rule this list shares with the filters it is drawn from: null is not
    // zero. The league is still a 12-team dynasty and still says so.
    const html = card({ league: { ...league, roster_positions: null } });
    assert.match(html, /Dynasty/);
    assert.match(html, /12 Team/);
    assert.doesNotMatch(html, /0QB|0TE/);
  });
});

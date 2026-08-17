import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PlayerSummary } from "@/shared/players";

import { AdpControlsProvider } from "../../adp-controls-context.tsx";
import { withQueryClient } from "../../query-test-support.ts";
import type { TimelineRoster } from "../../timeline.ts";
import { TimelineRosters, type TimelineManager } from "./timeline-rosters.tsx";

/**
 * The historical half's own markup.
 *
 * What lives here and nowhere else is the *pairing*: which manager the left half
 * lights, which roster the right half therefore draws, and what happens when the
 * two disagree. `../timeline` owns which players are on a roster at a stop and
 * pins that separately; this is what a reader sees of it.
 */

const players: Record<string, PlayerSummary> = {
  qb: { player_id: "qb", name: "Joe Burrow", position: "QB", team: "CIN" },
  rb: { player_id: "rb", name: "Bijan Robinson", position: "RB", team: "ATL" },
  def: {
    player_id: "def",
    name: "Pittsburgh Steelers",
    position: "DEF",
    team: "PIT",
  },
};

const managers: Record<string, TimelineManager> = {
  u1: { display_name: "DarksideEmperors", avatar_url: null },
  u2: { display_name: "jkap", avatar_url: null },
  u3: { display_name: "ThePhotonicBoom", avatar_url: null },
};

const rosters: TimelineRoster[] = [
  {
    roster_id: 1,
    user_id: "u1",
    players: ["qb", "rb", "def"],
    picks: [
      { season: "2027", round: 1, roster_id: 1 },
      { season: "2027", round: 1, roster_id: 3 },
    ],
    dealt: true,
  },
  { roster_id: 2, user_id: "u2", players: ["rb"], picks: [], dealt: true },
  { roster_id: 3, user_id: "u3", players: [], picks: [], dealt: false },
];

/**
 * The two providers this half reads through, which are the panel's own.
 *
 * It prices its rosters on the ADP drawer's board and reads the panel's stored
 * column selection, so it needs a query client and an `AdpControlsProvider` the
 * way the panel does. `renderToStaticMarkup` runs no effects, so neither issues
 * a request here — what they supply is the context, not an answer, which is why
 * every column below reads as an unpriced em dash.
 */
function view(selectedId: number | null, over: TimelineRoster[] = rosters): string {
  // The children go positionally, which is the same call at runtime — the cast
  // is what lets it be written that way, since `createElement` insists a
  // required `children` prop be in the props object. `timeline-view`'s own test
  // spells it the same way for the same reason.
  const provider = { season: "2026" } as Parameters<typeof AdpControlsProvider>[0];
  return renderToStaticMarkup(
    withQueryClient(
      createElement(
        AdpControlsProvider,
        provider,
        createElement(TimelineRosters, {
          leagueId: "L1",
          rosters: over,
          players,
          managers,
          selectedId,
          onSelect: () => {},
          caveat: "Every roster as it stood on Apr 12, 2026.",
        }),
      ),
    ),
  );
}

/**
 * The lit manager row's own name, which is what the right half is drawn from.
 *
 * Read off the row's `title` rather than out of its markup: the first text in a
 * row is the avatar's fallback *initial*, so a regex over the spans answers `J`
 * for `jkap` — which is a true string and the wrong question.
 */
function litManager(html: string): string | null {
  return /title="([^"]+)"[^>]*aria-current="true"/.exec(html)?.[1] ?? null;
}

describe("the historical half's selection", () => {
  test("the selected manager is lit and their roster is the one drawn", () => {
    const html = view(2);
    assert.equal(litManager(html), "jkap");
    // Roster 2 holds only the back, so the quarterback must not be on screen.
    assert.match(html, /Bijan Robinson/);
    assert.doesNotMatch(html, /Joe Burrow/);
  });

  test("a manager the league no longer holds falls back to the first row", () => {
    // A trade whose participants have since been replaced — the panel's own
    // reading of a `focusRosterId` naming nobody, rather than an empty half.
    const html = view(99);
    assert.equal(litManager(html), "DarksideEmperors");
    assert.match(html, /Joe Burrow/);
  });

  test("nothing selected yet opens on the first row rather than on nothing", () => {
    assert.equal(litManager(view(null)), "DarksideEmperors");
  });

  test("exactly one row is lit", () => {
    // Two lit rows would be two claims about which roster the half beside them
    // is showing.
    assert.equal(view(2).split('aria-current="true"').length - 1, 1);
  });

  test("a league with no rosters says so rather than drawing empty halves", () => {
    const html = view(1, []);
    assert.match(html, /No rosters stored for this league yet/);
    assert.doesNotMatch(html, /lab-trough/);
  });
});

describe("the historical half's rows", () => {
  test("the trade's own sides are marked and the others are not", () => {
    const html = view(1);
    assert.equal(html.split("in this trade").length - 1, 2);
  });

  test("the roster count is the one number, and it agrees in the singular", () => {
    const html = view(1);
    assert.match(html, /3 players/);
    assert.match(html, /1 player</);
  });

  test("the chip carries the player's position, since a past roster has no lineup", () => {
    // A lineup is a solve over projections and this league's slots, none of which
    // is a fact about a past roster — so the lane the panel gives a slot carries
    // what is knowable instead.
    const html = view(1);
    assert.match(html, /lab-tab lab-tab-pos[^>]*>QB</);
    assert.match(html, /lab-tab lab-tab-pos[^>]*>DEF</);
  });

  test("rows run in lineup order rather than alphabetically", () => {
    const html = view(1);
    assert.ok(html.indexOf(">QB<") < html.indexOf(">RB<"));
    assert.ok(html.indexOf(">RB<") < html.indexOf(">DEF<"));
  });

  test("a name is drawn both ways, and a team defence only one", () => {
    // Contracted below `@lg` and whole above it. `P. Steelers` is nothing, so
    // `shortPlayerName` returns a defence whole and only one span is drawn.
    const html = view(1);
    assert.match(html, /@lg:hidden">J\. Burrow</);
    assert.match(html, /hidden @lg:inline">Joe Burrow</);
    assert.match(html, /truncate">Pittsburgh Steelers</);
  });

  test("a held pick names its origin only when it came from elsewhere", () => {
    const html = view(1);
    // Roster 1's own first: naming the holder beside their own pick is noise.
    assert.match(html, /2027 1st<\/span>/);
    // Roster 3's, acquired: named by whoever holds that roster now.
    assert.match(html, /from ThePhotonicBoom/);
  });
});

/**
 * The panel's stat columns, read at a past moment.
 *
 * The selection is the panel's own — same stored keys — so with nothing written
 * these are the two tables' defaults, every one of which is a projection or a
 * record. That is the case worth pinning: the columns are *drawn* rather than
 * dropped, they say why they are empty, and the note under the halves points at
 * the two that can answer.
 */
describe("the historical half's columns", () => {
  test("both halves head the columns the panel is showing", () => {
    const html = view(1);
    // The standings' defaults and the roster's, each over its own half.
    assert.match(html, />Proj</);
    assert.match(html, />Start</);
    // Two catalogues, one label — the standings' Bench and the roster's.
    assert.equal(html.match(/>Bench</g)?.length, 2);
  });

  test("a heading is the control that aims the column, not a label", () => {
    // The panel's own rule: a heading opens the columns editor armed on its
    // slot, so it has to be a button rather than a caption.
    const html = view(1);
    assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*>/);
  });

  test("a metric the moment cannot answer is an em dash that says why", () => {
    const html = view(1);
    assert.match(html, /title="Proj is a fact about the league today — press Now to read it"/);
    assert.match(html, /title="Start is a fact about the league today — press Now to read it"/);
  });

  test("the note names those columns and points at the two that rewind", () => {
    const html = view(1);
    assert.match(html, /read the league as it stands today/);
    assert.match(html, /aim a column at KTC or ADP/);
  });

  test("a league with no rosters draws no columns and no note", () => {
    const html = view(1, []);
    assert.doesNotMatch(html, /aim a column at KTC or ADP/);
    assert.doesNotMatch(html, /aria-haspopup="dialog"/);
  });
});

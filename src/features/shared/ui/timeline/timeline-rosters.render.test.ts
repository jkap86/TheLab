import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PlayerSummary } from "@/shared/players";

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

function view(selectedId: number | null, over: TimelineRoster[] = rosters): string {
  return renderToStaticMarkup(
    createElement(TimelineRosters, {
      rosters: over,
      players,
      managers,
      selectedId,
      onSelect: () => {},
      caveat: "Every roster as it stood on Apr 12, 2026.",
    }),
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

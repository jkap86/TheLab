import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractPlayerHistory, extractPlayersArray, int } from "./parse.ts";

/**
 * KTC's markup is outside our control and will change without warning, so these
 * exercise the parsers against page-shaped fixtures rather than live HTML.
 */

/** A rankings page carrying `players`, wrapped in enough noise to be realistic. */
const rankingsPage = (players: unknown[]) =>
  `<html><head><script>var somethingElse = {"a":[1,2]};</script></head>` +
  `<body><script>var playersArray = ${JSON.stringify(players)};` +
  `var trailing = [9];</script></body></html>`;

const PLAYER = {
  playerID: 12,
  playerName: "Ja'Marr Chase",
  slug: "jamarr-chase",
  position: "WR",
  team: "CIN",
  superflexValues: { value: 9001, rank: 1, positionalRank: 1 },
};

describe("int", () => {
  test("truncates finite numbers", () => {
    assert.equal(int(12.9), 12);
    assert.equal(int(-3.2), -3);
    assert.equal(int(0), 0);
  });

  test("rejects anything that isn't a finite number", () => {
    for (const bad of ["12", null, undefined, NaN, Infinity, {}, []]) {
      assert.equal(int(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

describe("extractPlayersArray", () => {
  test("pulls the array out of a surrounding page", () => {
    const parsed = extractPlayersArray(rankingsPage([PLAYER]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].playerName, "Ja'Marr Chase");
    assert.equal(parsed[0].superflexValues?.value, 9001);
  });

  test("is not confused by brackets inside string values", () => {
    // A bare bracket-counting scan would stop early on the "]" in this name.
    const tricky = { ...PLAYER, playerName: 'Weird ] Name [ "quoted"' };
    const parsed = extractPlayersArray(rankingsPage([tricky, PLAYER]));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].playerID, 12);
  });

  test("survives escaped quotes and backslashes in string values", () => {
    const tricky = { ...PLAYER, playerName: 'back\\slash and \\" quote' };
    const parsed = extractPlayersArray(rankingsPage([tricky]));
    assert.equal(parsed[0].playerName, 'back\\slash and \\" quote');
  });

  test("throws when the marker is missing", () => {
    assert.throws(
      () => extractPlayersArray("<html>no data here</html>"),
      /playersArray.*not found/,
    );
  });

  test("throws when the literal never closes", () => {
    assert.throws(
      () => extractPlayersArray('<script>var playersArray = [{"a":1}'),
      /unterminated/,
    );
  });

  test("throws on an empty board rather than storing nothing", () => {
    assert.throws(() => extractPlayersArray(rankingsPage([])), /was empty/);
  });
});

describe("extractPlayerHistory", () => {
  const page = (sf: unknown, oneQB: unknown) =>
    `<script>var playerSuperflex = ${JSON.stringify(sf)};` +
    `var playerOneQB = ${JSON.stringify(oneQB)};</script>`;

  test("merges the two formats on date and sorts ascending", () => {
    const points = extractPlayerHistory(
      page(
        {
          overallValue: [
            { d: "260102", v: 200 },
            { d: "260101", v: 100 },
          ],
          overallRankHistory: [{ d: "260101", v: 5 }],
          positionalRankHistory: [{ d: "260101", v: 2 }],
        },
        { overallValue: [{ d: "260101", v: 90 }] },
      ),
    );

    assert.deepEqual(
      points.map((p) => p.date),
      ["2026-01-01", "2026-01-02"],
    );
    assert.equal(points[0].sfValue, 100);
    assert.equal(points[0].sfRank, 5);
    assert.equal(points[0].sfPositionRank, 2);
    assert.equal(points[0].oneqbValue, 90);
    // Day two exists only on the superflex board.
    assert.equal(points[1].sfValue, 200);
    assert.equal(points[1].oneqbValue, null);
  });

  test("keeps a date the 1QB board has but superflex doesn't", () => {
    const points = extractPlayerHistory(
      page(
        { overallValue: [{ d: "260101", v: 100 }] },
        { overallValue: [{ d: "260202", v: 80 }] },
      ),
    );
    assert.deepEqual(
      points.map((p) => p.date),
      ["2026-01-01", "2026-02-02"],
    );
    assert.equal(points[1].sfValue, null);
    assert.equal(points[1].oneqbValue, 80);
  });

  test("drops malformed dates and non-numeric values", () => {
    const points = extractPlayerHistory(
      page(
        {
          overallValue: [
            { d: "not-a-date", v: 1 },
            { d: "26011", v: 2 },
            { d: "260101", v: "500" },
          ],
        },
        {},
      ),
    );
    assert.equal(points.length, 1);
    assert.equal(points[0].date, "2026-01-01");
    assert.equal(points[0].sfValue, null);
  });

  test("handles a pick with no positional-rank series", () => {
    const points = extractPlayerHistory(
      page({ overallValue: [{ d: "260101", v: 100 }] }, {}),
    );
    assert.equal(points[0].sfPositionRank, null);
  });

  test("throws when neither format block is present", () => {
    assert.throws(
      () => extractPlayerHistory("<html>nothing</html>"),
      /no `playerSuperflex`\/`playerOneQB`/,
    );
  });
});

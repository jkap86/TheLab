import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { orderByProjectedPoints, projectedRank } from "./rank.ts";

const points = (entries: [number, number][]) => new Map(entries);

describe("projectedRank", () => {
  test("ranks a roster among the league's totals", () => {
    const league = points([
      [1, 100],
      [2, 250],
      [3, 175],
    ]);

    assert.deepEqual(projectedRank(league, 2), { rank: 1, of: 3, points: 250 });
    assert.deepEqual(projectedRank(league, 3), { rank: 2, of: 3, points: 175 });
    assert.deepEqual(projectedRank(league, 1), { rank: 3, of: 3, points: 100 });
  });

  test("ties share the better rank", () => {
    const league = points([
      [1, 200],
      [2, 200],
      [3, 150],
    ]);

    assert.deepEqual(projectedRank(league, 1), { rank: 1, of: 3, points: 200 });
    assert.deepEqual(projectedRank(league, 2), { rank: 1, of: 3, points: 200 });
    // Competition style: after two tied for 1st, the next rank is 3rd.
    assert.deepEqual(projectedRank(league, 3), { rank: 3, of: 3, points: 150 });
  });

  test("a roster with no total has no rank", () => {
    assert.equal(projectedRank(points([[1, 100]]), 2), null);
  });

  test("a league projecting zero everywhere has no ranks", () => {
    // Pre-draft: every roster totals 0.00, and "1st of 12" there would dress an
    // empty league up as a lead.
    const league = points([
      [1, 0],
      [2, 0],
    ]);
    assert.equal(projectedRank(league, 1), null);
  });

  test("a zero total still ranks when others are projected", () => {
    const league = points([
      [1, 0],
      [2, 100],
    ]);
    assert.deepEqual(projectedRank(league, 1), { rank: 2, of: 2, points: 0 });
  });
});

describe("orderByProjectedPoints", () => {
  const team = (roster_id: number) => ({ roster_id });

  test("orders by projected points, highest first", () => {
    const ordered = orderByProjectedPoints(
      [team(1), team(2), team(3)],
      points([
        [1, 100],
        [2, 250],
        [3, 175],
      ]),
    );
    assert.deepEqual(
      ordered.map((t) => t.roster_id),
      [2, 3, 1],
    );
  });

  test("teams without a total follow, keeping their standings order", () => {
    const ordered = orderByProjectedPoints(
      [team(4), team(1), team(5), team(2)],
      points([
        [1, 100],
        [2, 250],
      ]),
    );
    assert.deepEqual(
      ordered.map((t) => t.roster_id),
      [2, 1, 4, 5],
    );
  });

  test("ties keep their standings order", () => {
    const ordered = orderByProjectedPoints(
      [team(1), team(2), team(3)],
      points([
        [1, 200],
        [2, 200],
        [3, 300],
      ]),
    );
    assert.deepEqual(
      ordered.map((t) => t.roster_id),
      [3, 1, 2],
    );
  });

  test("no totals at all leaves the standings order alone", () => {
    const teams = [team(3), team(1), team(2)];
    assert.deepEqual(orderByProjectedPoints(teams, null), teams);
  });
});

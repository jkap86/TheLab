import assert from "node:assert/strict";
import { test } from "node:test";

import { PLAYER_METRICS } from "./roster-metrics.ts";
import { TEAM_METRICS } from "./standings-metrics.ts";
import {
  NO_TIMELINE_BOARD,
  REWINDABLE_METRICS,
  timelineColumnNote,
  timelinePlayerCell,
  timelineTeamCell,
  type TimelineBoard,
} from "./timeline-columns.ts";

const BOARD: TimelineBoard = {
  ktc: { "1": 6000, "2": 4000, "3": 1500 },
  adp: { "1": 900, "2": 400 },
  adp_position: { "1": 1.4, "2": 22.7 },
  superflex: true,
  draftCount: 1204,
};

test("every team metric answers or refuses — none throws, and the split is the set", () => {
  for (const metric of TEAM_METRICS) {
    const cell = timelineTeamCell(metric.key, ["1", "2"], BOARD);
    assert.equal(cell.kind, "value");
    if (REWINDABLE_METRICS.has(metric.key)) {
      assert.notEqual(cell.text, null, `${metric.key} should answer`);
    } else {
      assert.equal(cell.text, null, `${metric.key} should refuse`);
      assert.match(cell.title, /press Now/);
      assert.ok(cell.title.startsWith(metric.label));
    }
  }
});

test("every player metric answers or refuses on the same set", () => {
  for (const metric of PLAYER_METRICS) {
    const cell = timelinePlayerCell(metric.key, "1", BOARD);
    assert.equal(cell.kind, "value");
    if (REWINDABLE_METRICS.has(metric.key)) {
      assert.notEqual(cell.text, null, `${metric.key} should answer`);
    } else {
      assert.equal(cell.text, null, `${metric.key} should refuse`);
      assert.match(cell.title, /press Now/);
    }
  }
});

test("a team's value is summed over the ids it held, not over today's", () => {
  const then = timelineTeamCell("ktc", ["1", "2"], BOARD);
  const now = timelineTeamCell("ktc", ["3"], BOARD);
  assert.equal(then.text, "10,000");
  assert.equal(now.text, "1,500");
});

test("a roster is deduped and its empty slots skipped", () => {
  const padded = timelineTeamCell("ktc", ["1", "1", "", "0", "2"], BOARD);
  assert.equal(padded.text, "10,000");
});

test("an unpriced roster is an em dash, never a zero", () => {
  const cell = timelineTeamCell("ktc", ["999"], BOARD);
  assert.equal(cell.text, null);
  // The catalogue's own reason, not the rewind's — this metric *can* be read at
  // a past moment, it just found nothing on the board.
  assert.doesNotMatch(cell.title, /press Now/);
});

test("a player nothing prices is an em dash on both boards", () => {
  assert.equal(timelinePlayerCell("ktc", "999", BOARD).text, null);
  assert.equal(timelinePlayerCell("adp", "999", BOARD).text, null);
});

test("the ADP hover carries the board and the draft count it was read over", () => {
  const cell = timelinePlayerCell("adp", "1", BOARD);
  assert.match(cell.title, /superflex board/);
  assert.match(cell.title, /1204 crawled drafts/);
});

test("an empty board prices nothing rather than throwing", () => {
  assert.equal(timelineTeamCell("ktc", ["1"], NO_TIMELINE_BOARD).text, null);
  assert.equal(timelinePlayerCell("adp", "1", NO_TIMELINE_BOARD).text, null);
});

test("an unknown key falls back to a metric rather than crashing the row", () => {
  const team = timelineTeamCell("no_such_metric", ["1"], BOARD);
  const player = timelinePlayerCell("no_such_metric", "1", BOARD);
  assert.equal(team.kind, "value");
  assert.equal(player.kind, "value");
});

test("the note is silent when every column rewinds", () => {
  assert.equal(timelineColumnNote(["ktc", "adp"], ["ktc", "adp"]), null);
  assert.equal(timelineColumnNote([], []), null);
});

test("the note names the stranded columns and dedupes across the halves", () => {
  const note = timelineColumnNote(["proj", "bench"], ["bench", "ktc"]);
  assert.ok(note);
  assert.match(note, /Proj/);
  // "Bench" is the label in both catalogues and is named once.
  assert.equal(note.match(/Bench/g)?.length, 1);
  assert.match(note, /aim a column at KTC or ADP/);
});

test("a single stranded column reads as a singular sentence", () => {
  const note = timelineColumnNote(["ktc"], ["start"]);
  assert.ok(note);
  assert.match(note, /Start reads the league as it stands today, so it is blank/);
});

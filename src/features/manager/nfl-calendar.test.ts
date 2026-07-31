import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { firstKickoff, nflMarkers, nflMarkersIn } from "./nfl-calendar.ts";

describe("nflMarkers", () => {
  test("every season contributes a draft, a preseason and a regular season", () => {
    const kinds = new Set(nflMarkers().map((m) => m.kind));
    assert.deepEqual([...kinds].sort(), ["draft", "preseason", "regular"]);
  });

  test("comes back in date order", () => {
    const froms = nflMarkers().map((m) => m.from);
    assert.deepEqual(froms, [...froms].sort());
  });

  test("the draft is an instant, the seasons are spans", () => {
    for (const m of nflMarkers()) {
      if (m.kind === "draft") assert.equal(m.from, m.to);
      else assert.ok(m.from < m.to, `${m.label} should span days`);
    }
  });

  test("a season's markers run draft → preseason → regular", () => {
    // The order rookie boards actually move in; a table edited out of sequence
    // would draw a preseason band before its own draft flag.
    const of2025 = nflMarkers().filter((m) => m.label.startsWith("2025"));
    assert.deepEqual(
      of2025.map((m) => m.kind),
      ["draft", "preseason", "regular"],
    );
  });
});

describe("nflMarkersIn", () => {
  test("drops what the window misses entirely", () => {
    const markers = nflMarkersIn("2026-05-01", "2026-07-31");
    assert.deepEqual(
      markers.map((m) => m.label),
      [],
      "nothing on the NFL calendar falls between the draft and preseason",
    );
  });

  test("keeps a marker that overlaps at all, clipped to the window", () => {
    // A regular season that started before the first crawled draft still ran
    // through the months on screen — drawing the part that fits says so.
    const [reg] = nflMarkersIn("2025-11-01", "2025-12-31");
    assert.equal(reg.label, "2025 regular season");
    assert.equal(reg.from, "2025-11-01");
    assert.equal(reg.to, "2025-12-31");
  });

  test("an untouched marker keeps its own dates", () => {
    const draft = nflMarkersIn("2026-01-01", "2026-12-31").find(
      (m) => m.kind === "draft",
    );
    assert.equal(draft?.from, "2026-04-23");
    assert.equal(draft?.to, "2026-04-23");
  });

  test("a marker touching only the boundary is kept", () => {
    const markers = nflMarkersIn("2026-04-23", "2026-04-23");
    assert.deepEqual(
      markers.map((m) => m.label),
      ["2026 NFL draft"],
    );
  });

  test("an inverted window matches nothing rather than everything", () => {
    assert.deepEqual(nflMarkersIn("2026-07-31", "2026-01-01"), []);
  });
});

describe("firstKickoff", () => {
  test("is the regular season's opening day at the traditional 8:20 ET slot", () => {
    assert.equal(firstKickoff("2026"), Date.parse("2026-09-10T20:20:00-04:00"));
    assert.equal(firstKickoff("2025"), Date.parse("2025-09-04T20:20:00-04:00"));
  });

  test("a season off the table is null, not a guess", () => {
    assert.equal(firstKickoff("2031"), null);
    assert.equal(firstKickoff(""), null);
  });
});

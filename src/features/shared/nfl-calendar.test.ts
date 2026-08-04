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

  test("a season past the table is derived rather than null", () => {
    // 2027: Labor Day is Sep 6, so the opener is Thursday Sep 9.
    assert.equal(firstKickoff("2027"), Date.parse("2027-09-09T20:20:00-04:00"));
  });

  test("a season it cannot justify is still null, not a guess", () => {
    assert.equal(firstKickoff("2099"), null); // far past the derivable window
    assert.equal(firstKickoff("1999"), null); // before the table starts
    assert.equal(firstKickoff("not a year"), null);
    assert.equal(firstKickoff(""), null);
  });
});

describe("seasons past the table", () => {
  const find = (markers: ReturnType<typeof nflMarkers>, label: string) =>
    markers.find((m) => m.label === label);

  test("the derivation reproduces every tabled season it was drawn from", () => {
    // The rules are only trustworthy because they match what is written down.
    const expected: Record<string, { opener: string; draft: string }> = {
      "2023": { opener: "2023-09-07", draft: "2023-04-27" },
      "2024": { opener: "2024-09-05", draft: "2024-04-25" },
      "2025": { opener: "2025-09-04", draft: "2025-04-24" },
      "2026": { opener: "2026-09-10", draft: "2026-04-23" },
    };
    const tabled = nflMarkers();
    for (const [season, { opener, draft }] of Object.entries(expected)) {
      assert.equal(find(tabled, `${season} regular season`)?.from, opener);
      assert.equal(find(tabled, `${season} NFL draft`)?.from, draft);
    }
  });

  test("nothing derived is drawn unless a caller asks past the table", () => {
    assert.ok(!nflMarkers().some((m) => m.label.includes("(projected)")));
    assert.ok(!nflMarkers().some((m) => m.label.startsWith("2027")));
  });

  test("a derived season carries all three markers, labelled as projected", () => {
    const markers = nflMarkers(2027);
    assert.equal(
      find(markers, "2027 regular season (projected)")?.from,
      "2027-09-09",
    );
    // The one Thursday in April 23–29 that year is the 29th.
    assert.equal(find(markers, "2027 NFL draft (projected)")?.from, "2027-04-29");
    const pre = find(markers, "2027 preseason (projected)");
    assert.equal(pre?.from, "2027-08-05");
    assert.equal(pre?.to, "2027-08-28");
  });

  test("derived markers stay in date order with the tabled ones", () => {
    const froms = nflMarkers(2030).map((m) => m.from);
    assert.deepEqual(froms, [...froms].sort());
  });

  test("a window reaching into a derived season is no longer empty", () => {
    const markers = nflMarkersIn("2027-08-01", "2027-12-31");
    assert.ok(markers.length > 0, "a 2027 window must not come back empty");
    assert.ok(markers.some((m) => m.kind === "regular"));
    assert.ok(markers.every((m) => m.from >= "2027-08-01" && m.to <= "2027-12-31"));
  });

  test("the bound is the window, not a clock — two calls agree", () => {
    assert.deepEqual(
      nflMarkersIn("2026-01-01", "2029-01-01"),
      nflMarkersIn("2026-01-01", "2029-01-01"),
    );
  });
});

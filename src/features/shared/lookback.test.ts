import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  draftAnchor,
  lookbackRange,
  lookbackView,
  sinceDraftRange,
} from "./lookback.ts";

const TODAY = "2026-08-05";

describe("lookbackView", () => {
  test("the named presets read as their own day counts, ending today", () => {
    // The lens is a view over the stored range, so a board left on "Last 30
    // days" opens the counter already saying 30 — not a blank to re-derive.
    assert.deepEqual(lookbackView({ preset: "30d", from: null, to: null }, TODAY), {
      days: 30,
      end: TODAY,
      endsToday: true,
    });
    assert.equal(lookbackView({ preset: "90d", from: null, to: null }, TODAY).days, 90);
  });

  test("an unbounded board is an empty lens, not a zero", () => {
    // No days back is "the whole season"; 0 days back would be "since today".
    assert.deepEqual(lookbackView({ preset: "all", from: null, to: null }, TODAY), {
      days: null,
      end: TODAY,
      endsToday: true,
    });
  });

  test("a frozen custom window reads its own end, not today", () => {
    const view = lookbackView(
      { preset: "custom", from: "2026-05-01", to: "2026-06-30" },
      TODAY,
    );
    assert.deepEqual(view, { days: 60, end: "2026-06-30", endsToday: false });
  });

  test("a half-open custom keeps the half it has", () => {
    // Since-a-date: days from that date to today, end open.
    assert.deepEqual(
      lookbackView({ preset: "custom", from: "2026-04-23", to: null }, TODAY),
      { days: 104, end: TODAY, endsToday: true },
    );
    // Through-a-date: no start, so no day count to claim.
    assert.deepEqual(
      lookbackView({ preset: "custom", from: null, to: "2026-06-30" }, TODAY),
      { days: null, end: "2026-06-30", endsToday: false },
    );
  });

  test("the general lookback round-trips its day count", () => {
    assert.equal(
      lookbackView({ preset: "lookback", from: null, to: null, days: 45 }, TODAY).days,
      45,
    );
  });

  test("twelve months reads as the days it actually covers", () => {
    // 2025-08-05 → 2026-08-05 crosses no leap day, so 365.
    assert.equal(lookbackView({ preset: "12m", from: null, to: null }, TODAY).days, 365);
  });
});

describe("lookbackRange", () => {
  test("ending today stays relative, and 30/90 land on the named presets", () => {
    // The named presets are what the resting line's chips light on, so a typed
    // 30 must be indistinguishable from a pressed "30 days".
    assert.deepEqual(lookbackRange(30, TODAY, TODAY), { preset: "30d", from: null, to: null });
    assert.deepEqual(lookbackRange(90, TODAY, TODAY), { preset: "90d", from: null, to: null });
    assert.deepEqual(lookbackRange(45, TODAY, TODAY), {
      preset: "lookback",
      from: null,
      to: null,
      days: 45,
    });
    assert.deepEqual(lookbackRange(null, TODAY, TODAY), { preset: "all", from: null, to: null });
  });

  test("a hand-set end freezes the window into custom", () => {
    // A reader who named a day meant that day — the window must not roll
    // forward under them.
    assert.deepEqual(lookbackRange(60, "2026-06-30", TODAY), {
      preset: "custom",
      from: "2026-05-01",
      to: "2026-06-30",
    });
    assert.deepEqual(lookbackRange(null, "2026-06-30", TODAY), {
      preset: "custom",
      from: null,
      to: "2026-06-30",
    });
  });

  test("round-trips through lookbackView", () => {
    for (const [days, end] of [
      [30, TODAY],
      [104, TODAY],
      [null, TODAY],
      [60, "2026-06-30"],
      [null, "2026-06-30"],
    ] as const) {
      const view = lookbackView(lookbackRange(days, end, TODAY), TODAY);
      assert.deepEqual({ days: view.days, end: view.end }, { days, end });
    }
  });
});

describe("sinceDraftRange", () => {
  test("pins the start at the draft rather than storing a day count", () => {
    // Days-since-the-draft grows by one every midnight; a stored count would
    // walk the window's start away from the draft it names.
    assert.deepEqual(
      sinceDraftRange("2026-04-23", { days: 104, end: TODAY, endsToday: true }),
      { preset: "custom", from: "2026-04-23", to: null },
    );
  });

  test("keeps a frozen end frozen", () => {
    assert.deepEqual(
      sinceDraftRange("2026-04-23", { days: 68, end: "2026-06-30", endsToday: false }),
      { preset: "custom", from: "2026-04-23", to: "2026-06-30" },
    );
  });
});

describe("draftAnchor", () => {
  test("finds the season's draft inside a season-shaped domain", () => {
    const anchor = draftAnchor({ from: "2025-12-01", to: "2026-08-31" }, TODAY);
    assert.equal(anchor?.date, "2026-04-23");
    assert.match(anchor!.label, /2026 NFL draft/);
  });

  test("the all-seasons domain anchors on the latest draft, not the first", () => {
    // "Since the draft" on a pooled board means the most recent one — the cut
    // that separates this rookie class from the last.
    const anchor = draftAnchor({ from: "2023-01-01", to: "2026-08-31" }, TODAY);
    assert.equal(anchor?.date, "2026-04-23");
  });

  test("a window ending before the draft anchors on the one before it", () => {
    // The key means "the draft this window could contain", so an end in March
    // 2026 reaches back to April 2025.
    const anchor = draftAnchor({ from: "2024-12-01", to: "2026-08-31" }, "2026-03-01");
    assert.equal(anchor?.date, "2025-04-24");
  });

  test("a domain holding no draft has no anchor, and the key isn't drawn", () => {
    assert.equal(draftAnchor({ from: "2025-06-01", to: "2025-12-31" }, "2025-12-31"), null);
  });
});

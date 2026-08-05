import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  daysBetween,
  densityThrough,
  drawnBounds,
  fractionOf,
  monthBars,
  monthExtent,
  scrubDomain,
} from "./range-domain.ts";

const TODAY = "2026-07-31";

const density = [
  { month: "2025-05", drafts: 14 },
  { month: "2025-08", drafts: 13 },
  { month: "2026-05", drafts: 16 },
];

describe("scrubDomain", () => {
  test("runs from the first crawled month to the end of today's", () => {
    assert.deepEqual(scrubDomain(density, TODAY), {
      from: "2025-05-01",
      to: "2026-07-31",
    });
  });

  test("ends at today's month even when crawling stopped months ago", () => {
    // The right edge is what "now" means to someone dragging toward it; a quiet
    // stretch must not make an open end unreachable.
    const stale = [{ month: "2025-05", drafts: 14 }];
    assert.equal(scrubDomain(stale, TODAY).to, "2026-07-31");
  });

  test("months with no drafts don't start the axis", () => {
    const padded = [{ month: "2020-01", drafts: 0 }, ...density];
    assert.equal(scrubDomain(padded, TODAY).from, "2025-05-01");
  });

  test("falls back to twelve months when nothing has been crawled", () => {
    // The presets and the calendar markers still work without bars, so the
    // control has to render rather than disappear.
    assert.deepEqual(scrubDomain([], TODAY), { from: "2025-08-01", to: "2026-07-31" });
  });

  test("ends on the real last day of a short month", () => {
    assert.equal(scrubDomain(density, "2026-02-10").to, "2026-02-28");
    assert.equal(scrubDomain(density, "2028-02-10").to, "2028-02-29");
  });
});

describe("densityThrough", () => {
  test("a board still being drafted runs to today", () => {
    // The right edge is what "now" means to someone dragging toward it, so a
    // quiet fortnight must not shorten the axis.
    assert.equal(densityThrough(density, TODAY, true), TODAY);
  });

  test("a finished season stops at its last draft, not at today", () => {
    // Today is months or years past anything that will ever be counted into a
    // 2024 board; an axis running to it would be mostly blank.
    assert.equal(densityThrough(density, TODAY, false), "2026-05-31");
  });

  test("a season with nothing crawled falls back to today", () => {
    // Which gives scrubDomain its twelve-month empty domain rather than an axis
    // of zero width.
    assert.equal(densityThrough([], TODAY, false), TODAY);
    assert.equal(densityThrough([{ month: "2025-05", drafts: 0 }], TODAY, false), TODAY);
  });
});

describe("monthBars", () => {
  test("fills the gaps between crawled months with zeroes", () => {
    const bars = monthBars(density, { from: "2025-05-01", to: "2025-08-31" });
    assert.deepEqual(bars, [
      { month: "2025-05", drafts: 14 },
      { month: "2025-06", drafts: 0 },
      { month: "2025-07", drafts: 0 },
      { month: "2025-08", drafts: 13 },
    ]);
  });

  test("spans a year boundary", () => {
    const bars = monthBars([], { from: "2025-11-01", to: "2026-02-28" });
    assert.deepEqual(
      bars.map((b) => b.month),
      ["2025-11", "2025-12", "2026-01", "2026-02"],
    );
  });
});

describe("fractionOf", () => {
  const domain = { from: "2026-01-01", to: "2026-01-11" };

  test("places a date proportionally along the domain", () => {
    assert.equal(fractionOf(domain, "2026-01-01"), 0);
    assert.equal(fractionOf(domain, "2026-01-06"), 0.5);
    assert.equal(fractionOf(domain, "2026-01-11"), 1);
  });

  test("clamps outside the domain rather than extrapolating", () => {
    assert.equal(fractionOf(domain, "2025-06-01"), 0);
    assert.equal(fractionOf(domain, "2027-06-01"), 1);
  });
});

describe("daysBetween", () => {
  test("counts whole days, signed", () => {
    assert.equal(daysBetween("2026-04-23", "2026-08-05"), 104);
    assert.equal(daysBetween("2026-08-05", "2026-04-23"), -104);
    assert.equal(daysBetween("2026-08-05", "2026-08-05"), 0);
  });

  test("crosses a leap day without drifting", () => {
    assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2);
  });
});

describe("drawnBounds", () => {
  const domain = { from: "2025-05-01", to: "2026-07-31" };

  test("an open bound is drawn at the domain's edge", () => {
    assert.deepEqual(drawnBounds({ from: null, to: null }, domain), {
      from: "2025-05-01",
      to: "2026-07-31",
    });
    assert.deepEqual(drawnBounds({ from: "2026-01-01", to: null }, domain), {
      from: "2026-01-01",
      to: "2026-07-31",
    });
  });

  test("a bound before the crawled data is drawn at the edge, not off it", () => {
    // A preset resolves against today, not against the strip, so "last 12
    // months" on a two-month-old database starts behind the axis.
    assert.deepEqual(drawnBounds({ from: "2019-01-01", to: null }, domain), {
      from: "2025-05-01",
      to: "2026-07-31",
    });
  });
});

describe("monthExtent", () => {
  test("adjacent months meet with no seam", () => {
    const domain = { from: "2026-01-01", to: "2026-03-31" };
    const jan = monthExtent("2026-01", domain);
    const feb = monthExtent("2026-02", domain);
    assert.equal(round(jan.left + jan.width), round(feb.left));
  });

  test("the last month reaches the right edge", () => {
    const domain = { from: "2026-01-01", to: "2026-03-31" };
    const mar = monthExtent("2026-03", domain);
    assert.equal(round(mar.left + mar.width), 1);
  });
});

const round = (n: number) => Math.round(n * 1e6) / 1e6;

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  axisTicks,
  dateAtFraction,
  densityThrough,
  drawnBounds,
  edgeBounds,
  fractionOf,
  monthBars,
  monthExtent,
  panWindow,
  scrubDomain,
  scrubTargetAt,
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

describe("fractionOf / dateAtFraction", () => {
  const domain = { from: "2026-01-01", to: "2026-01-11" };

  test("round-trips a date through its fraction", () => {
    for (const date of ["2026-01-01", "2026-01-06", "2026-01-11"]) {
      assert.equal(dateAtFraction(domain, fractionOf(domain, date)), date);
    }
  });

  test("clamps outside the domain rather than extrapolating", () => {
    assert.equal(fractionOf(domain, "2025-06-01"), 0);
    assert.equal(fractionOf(domain, "2027-06-01"), 1);
    assert.equal(dateAtFraction(domain, -3), "2026-01-01");
    assert.equal(dateAtFraction(domain, 9), "2026-01-11");
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

describe("edgeBounds", () => {
  const domain = { from: "2025-05-01", to: "2026-07-31" };

  test("a handle on an edge reads as an open end, not as that date", () => {
    // This is what makes "all time" reachable by dragging, and what keeps a
    // range two independent halves after it has been.
    assert.deepEqual(edgeBounds("2025-05-01", "2026-07-31", domain), {
      preset: "custom",
      from: null,
      to: null,
    });
    assert.deepEqual(edgeBounds("2026-02-01", "2026-07-31", domain), {
      preset: "custom",
      from: "2026-02-01",
      to: null,
    });
    assert.deepEqual(edgeBounds("2025-05-01", "2026-02-01", domain), {
      preset: "custom",
      from: null,
      to: "2026-02-01",
    });
  });

  test("a handle inside the domain keeps its date", () => {
    assert.deepEqual(edgeBounds("2025-06-01", "2026-06-30", domain), {
      preset: "custom",
      from: "2025-06-01",
      to: "2026-06-30",
    });
  });

  test("round-trips through drawnBounds", () => {
    for (const bounds of [
      { from: null, to: null },
      { from: "2026-02-01", to: null },
      { from: null, to: "2026-02-01" },
      { from: "2025-09-01", to: "2026-03-15" },
    ]) {
      const drawn = drawnBounds(bounds, domain);
      const back = edgeBounds(drawn.from, drawn.to, domain);
      assert.deepEqual({ from: back.from, to: back.to }, bounds);
    }
  });
});

describe("panWindow", () => {
  const domain = { from: "2025-05-01", to: "2026-07-31" };
  const window = { from: "2026-01-10", to: "2026-02-09" };

  test("slides both ends by the same days", () => {
    assert.deepEqual(panWindow(window, 10, domain), {
      from: "2026-01-20",
      to: "2026-02-19",
    });
    assert.deepEqual(panWindow(window, -40, domain), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("stops at an edge with its length intact", () => {
    // Squashing the window against the edge would answer a different question
    // than the one being dragged — a month asked for stays a month.
    const back = panWindow(window, -10_000, domain);
    assert.deepEqual(back, { from: "2025-05-01", to: "2025-05-31" });
    const forward = panWindow(window, 10_000, domain);
    assert.deepEqual(forward, { from: "2026-07-01", to: "2026-07-31" });
    for (const panned of [back, forward]) {
      assert.equal(
        Date.parse(`${panned.to}T00:00:00Z`) - Date.parse(`${panned.from}T00:00:00Z`),
        Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`),
      );
    }
  });

  test("a window already filling the domain doesn't move", () => {
    assert.deepEqual(panWindow(domain, 30, domain), domain);
  });
});

describe("axisTicks", () => {
  const label = (ticks: { label: string }[]) => ticks.map((t) => t.label).join(" ");

  test("names the months on a short axis, and January is the year", () => {
    const domain = { from: "2025-11-01", to: "2026-02-28" };
    assert.equal(label(axisTicks(monthBars([], domain), domain)), "Nov Dec 2026 Feb");
  });

  test("drops to initials once the names would collide, and the year with them", () => {
    // A four-digit year is three initials wide; at that density the tick is
    // narrower than the label and "202" is what gets drawn.
    const domain = { from: "2025-01-01", to: "2026-06-30" };
    const ticks = axisTicks(monthBars([], domain), domain);
    assert.equal(ticks.length, 18);
    assert.equal(label(ticks).slice(0, 13), "’25 F M A M J");
  });

  test("leaves only the years on an axis too long even for initials", () => {
    const domain = { from: "2023-01-01", to: "2026-07-31" };
    const ticks = axisTicks(monthBars([], domain), domain);
    assert.equal(label(ticks), "2023 2024 2025 2026");
    assert.ok(ticks.every((t) => t.year));
  });

  test("a tick is laid out over its own month", () => {
    const domain = { from: "2026-01-01", to: "2026-03-31" };
    const [jan] = axisTicks(monthBars([], domain), domain);
    assert.deepEqual(
      { left: jan.left, width: jan.width },
      monthExtent("2026-01", domain),
    );
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

describe("scrubTargetAt", () => {
  // A 400px track — roughly the strip inside the drawer on a phone.
  const W = 400;
  const at = (x: number, from: number, to: number, radius = 24) =>
    scrubTargetAt(x, W, { from, to }, radius);

  test("a handle parked on the domain's edge is grabbable from the edge", () => {
    // The default board is unbounded, so this is the state the control opens in
    // — and the state where half of any drawn target hangs off the panel.
    assert.equal(at(0, 0, 1), "from");
    assert.equal(at(W, 0, 1), "to");
  });

  test("a near miss resizes rather than sweeping a new window", () => {
    // Falling through to a sweep is what made the handles unusable with a
    // finger: reaching for one collapsed the window to the day under it.
    assert.equal(at(18, 0, 1), "from");
    assert.equal(at(W - 18, 0, 1), "to");
  });

  test("a finger reaches further than a mouse", () => {
    assert.equal(at(18, 0, 1, 24), "from");
    assert.equal(at(18, 0, 1, 10), "pan");
  });

  test("the middle of a wide window pans", () => {
    assert.equal(at(200, 0, 1), "pan");
  });

  test("outside the window, past the radius, sweeps", () => {
    assert.equal(at(60, 0.25, 0.75), "sweep");
    assert.equal(at(340, 0.25, 0.75), "sweep");
  });

  test("a window narrower than two radii keeps a pan target", () => {
    // Uncapped, the inner reaches would meet and a short span could be resized
    // but never dragged — one unreachable gesture traded for another.
    assert.equal(at(100, 0.25, 0.325), "from"); // 100px – 130px
    assert.equal(at(130, 0.25, 0.325), "to");
    assert.equal(at(115, 0.25, 0.325), "pan");
  });

  test("both handles in reach goes to the nearer one", () => {
    assert.equal(at(104, 0.25, 0.325), "from");
    assert.equal(at(126, 0.25, 0.325), "to");
  });

  test("a track with no width can only sweep", () => {
    assert.equal(scrubTargetAt(0, 0, { from: 0, to: 1 }, 24), "sweep");
  });
});

const round = (n: number) => Math.round(n * 1e6) / 1e6;

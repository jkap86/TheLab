import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompPair, CompSeasonLine } from "@/shared/contract";

import { MIN_WEIGHTED_COVERAGE } from "./coverage.ts";
import {
  closenessBars,
  isEligible,
  rankComps,
  zStats,
} from "./knn.ts";
import type { CompRow } from "./windows.ts";

const line = (over: Partial<CompSeasonLine>): CompSeasonLine => ({
  ppg: 10,
  pts: 160,
  recyd: 800,
  rec: 60,
  tgtsh: 20,
  rush: 0,
  yprr: 1.8,
  snap: 80,
  gp: 16,
  ...over,
});

type Row = CompRow & { id: string };

const row = (id: string, own: Partial<CompSeasonLine>, prev?: Partial<CompSeasonLine>): Row => ({
  id,
  facts: { age: 24, exp: 3, draft: 40 },
  history: prev ? [line(own), line(prev)] : [line(own)],
});

const pair = (
  criterion: CompPair["criterion"],
  window: CompPair["window"] = "last",
  weight = 1,
): CompPair => ({ criterion, window, weight });

const ids = (ranking: { ranked: { row: Row }[] }) => ranking.ranked.map((r) => r.row.id);

/**
 * The distance is the spec. Every rule below renders perfectly when it is
 * wrong — a null read as a zero, a weight applied to the criterion instead of
 * the pair, a two-column criterion counted twice, a scale the subject moved,
 * a row that dropped its way to a distance of nought — so this is where each
 * one is pinned.
 */
describe("rankComps", () => {
  test("nearest first, on a z-scored gap", () => {
    const subject = row("subject", { ppg: 20 });
    const pool = [
      row("far", { ppg: 5 }),
      row("near", { ppg: 19 }),
      row("mid", { ppg: 12 }),
      row("also-far", { ppg: 6 }),
    ];
    const ranking = rankComps(subject, pool, [pair("ppg")]);
    assert.deepEqual(ids(ranking), ["near", "mid", "also-far", "far"]);
    assert.ok(ranking.ranked[0].distance < ranking.ranked[1].distance);
    assert.equal(ranking.eligible, 4);
    assert.equal(ranking.excludedLowCoverage, 0);
  });

  test("an identical reading is a zero gap and full coverage", () => {
    const subject = row("subject", { ppg: 20 });
    const pool = [row("twin", { ppg: 20 }), row("other", { ppg: 10 })];
    const ranking = rankComps(subject, pool, [pair("ppg")]);
    const twin = ranking.ranked[0];
    assert.equal(twin.row.id, "twin");
    assert.equal(twin.distance, 0);
    assert.equal(twin.coverage, 1);
    assert.equal(twin.similarity, 100);
    assert.deepEqual(twin.pairs["ppg:last"], { gap: 0, read: 20, used: 1, of: 1 });
  });

  /**
   * The correction this pass exists for. The scale is the candidate
   * population's; the subject is transformed *by* it and never contributes to
   * it. With the subject in the population an extreme value widened the
   * standard deviation, and a widened scale shrinks every gap on that
   * criterion — so the more unusual the player being comped, the less the
   * criterion he was unusual on counted. Exactly backwards.
   */
  describe("the scale is the candidate pool's, not the pool plus the subject", () => {
    const pool = [row("a", { ppg: 10 }), row("b", { ppg: 20 }), row("c", { ppg: 30 })];
    // Population sd of [10, 20, 30].
    const sd = Math.sqrt(((10 - 20) ** 2 + 0 + (30 - 20) ** 2) / 3);

    const gapsOf = (subjectPpg: number) => {
      const ranking = rankComps(row("s", { ppg: subjectPpg }), pool, [pair("ppg")]);
      const byId = new Map(ranking.ranked.map((r) => [r.row.id, r.pairs["ppg:last"].gap!]));
      return byId;
    };

    test("an extreme subject does not move the standard deviation", () => {
      const extreme = gapsOf(1000);
      // Every gap is measured in pool units, so the spacing between two pool
      // rows is one z-unit's worth of their own difference whatever the
      // subject is: 10 PPG over the pool's own sd.
      assert.ok(Math.abs(extreme.get("b")! - extreme.get("c")! - 10 / sd) < 1e-9);
      assert.ok(Math.abs(extreme.get("a")! - extreme.get("b")! - 10 / sd) < 1e-9);

      // And the absolute figure is the pool-scaled one. Had the subject been
      // in the population the sd would have been ~424 rather than ~8.16, and
      // this gap would have read about 2.3 instead — the criterion the subject
      // is most unusual on, quietly turned off.
      assert.ok(Math.abs(extreme.get("a")! - Math.abs(10 - 20) / sd - (1000 - 20) / sd) < 1e-6);
      assert.ok(extreme.get("a")! > 100, "an extreme subject is far, and reads far");
    });

    test("moving the subject does not change the pool's own spacing", () => {
      const near = gapsOf(20);
      const far = gapsOf(60);
      const spacing = (m: Map<string, number>) => Math.abs(m.get("a")! - m.get("b")!);
      assert.ok(Math.abs(spacing(near) - spacing(far)) < 1e-9);
    });

    test("adding or removing a row does change it, which is the population moving", () => {
      const three = gapsOf(20).get("a")!;
      const widened = rankComps(
        row("s", { ppg: 20 }),
        [...pool, row("d", { ppg: 200 })],
        [pair("ppg")],
      );
      const four = widened.ranked.find((r) => r.row.id === "a")!.pairs["ppg:last"].gap!;
      assert.ok(four < three);
    });
  });

  test("the weight lives on the pair, not the criterion", () => {
    // Two rows: one matches the subject's last year and not his best, the
    // other the reverse. Which ranks nearer is decided by which window the
    // reader weighted.
    const subj: Row = { ...row("s", { ppg: 20 }, { ppg: 10 }) };
    const lastMatch = row("last-match", { ppg: 20 }, { ppg: 30 });
    const bestMatch = row("best-match", { ppg: 8 }, { ppg: 20 });
    const pool = [lastMatch, bestMatch];

    const lastHeavy = rankComps(subj, pool, [pair("ppg", "last", 3), pair("ppg", "chigh", 0.2)]);
    assert.equal(lastHeavy.ranked[0].row.id, "last-match");

    const bestHeavy = rankComps(subj, pool, [pair("ppg", "last", 0.2), pair("ppg", "chigh", 3)]);
    assert.equal(bestHeavy.ranked[0].row.id, "best-match");
  });

  test("a multi-field criterion averages its fields rather than counting twice", () => {
    // `recyd` reads yards and receptions. The pool is symmetric about its mean
    // on both, so each z-gap is the same 1 z-unit and the pair's gap is their
    // mean rather than their sum.
    const subj = row("s", { recyd: 1000, rec: 100 });
    const pool = [row("p", { recyd: 800, rec: 60 }), row("q", { recyd: 1200, rec: 140 })];
    const ranked = rankComps(subj, pool, [pair("recyd")]).ranked.find((r) => r.row.id === "p")!;

    // Compare against a single-field criterion over a pool with the same
    // shape: the two must agree, which is the whole point of the mean.
    const single = rankComps(
      row("s", { ppg: 20 }),
      [row("p", { ppg: 10 }), row("q", { ppg: 30 })],
      [pair("ppg")],
    ).ranked.find((r) => r.row.id === "p")!;

    assert.ok(Math.abs(ranked.pairs["recyd:last"].gap! - single.pairs["ppg:last"].gap!) < 1e-9);
    assert.ok(Math.abs(ranked.distance - single.distance) < 1e-9);
  });

  test("dividing by the available weight keeps the distance comparable as pairs are added", () => {
    const subj = row("s", { ppg: 20, gp: 17 });
    const pool = [row("p", { ppg: 10, gp: 10 }), row("q", { ppg: 30, gp: 24 })];
    const one = rankComps(subj, pool, [pair("ppg", "last", 2)]).ranked[0].distance;
    // Doubling every weight changes nothing.
    const doubled = rankComps(subj, pool, [pair("ppg", "last", 4)]).ranked[0].distance;
    assert.ok(Math.abs(one - doubled) < 1e-9);
    // Adding a pair whose gap is the same leaves the RMS where it was rather
    // than growing it.
    const two = rankComps(subj, pool, [pair("ppg", "last", 2), pair("gp", "last", 2)]);
    assert.ok(Math.abs(two.ranked[0].distance - one) < 1e-9);
  });

  test("a constant feature contributes a zero gap rather than a division by zero", () => {
    const ranking = rankComps(
      row("s", { gp: 17, ppg: 20 }),
      [row("p", { gp: 17, ppg: 20 }), row("q", { gp: 17, ppg: 10 })],
      [pair("gp"), pair("ppg")],
    );
    const p = ranking.ranked.find((r) => r.row.id === "p")!;
    assert.equal(p.pairs["gp:last"].gap, 0);
    assert.equal(p.distance, 0);
    assert.equal(Number.isFinite(p.distance), true);
  });

  test("no pairs ranks nothing", () => {
    const ranking = rankComps(row("s", {}), [row("p", {})], []);
    assert.deepEqual(ranking.ranked, []);
    assert.equal(ranking.comparableWeight, 0);
    assert.equal(ranking.subjectCoverage, 0);
  });

  test("an empty pool ranks nothing and reports its own emptiness", () => {
    const ranking = rankComps(row("s", {}), [], [pair("ppg")]);
    assert.deepEqual(ranking.ranked, []);
    assert.equal(ranking.eligible, 0);
    assert.equal(ranking.requestedWeight, 1);
  });
});

/**
 * Weighted comparison coverage: the rule that stops a row with one readable
 * criterion out of four coming back as a perfect comp. Every case here ranked
 * — and ranked first — before it existed.
 */
describe("weighted comparison coverage", () => {
  const subject = row("s", { ppg: 20, tgtsh: 30, yprr: 2, snap: 90 });
  const four = [pair("ppg"), pair("tgtsh"), pair("yprr"), pair("snap")];

  const filler = (id: string) => row(id, { ppg: 12, tgtsh: 18, yprr: 1.4, snap: 70 });

  test("a candidate matching one field and missing the rest cannot rank at all", () => {
    // Identical to the subject on PPG and null on the other three: without the
    // gate this row's distance is exactly 0 and it ranks above every complete
    // season in the pool.
    const sparse = row("sparse", { ppg: 20, tgtsh: null, yprr: null, snap: null });
    const whole = row("whole", { ppg: 12, tgtsh: 30, yprr: 2, snap: 90 });
    const ranking = rankComps(subject, [sparse, whole, filler("f1")], four);

    assert.deepEqual(ids(ranking), ["whole", "f1"]);
    assert.equal(ranking.excludedLowCoverage, 1);
  });

  test("a complete candidate is preferred over a deceptively perfect sparse one", () => {
    const sparse = row("sparse", { ppg: 20, tgtsh: null, yprr: null, snap: 90 });
    const complete = row("complete", { ppg: 19, tgtsh: 29, yprr: 1.9, snap: 88 });
    const ranking = rankComps(subject, [sparse, complete, filler("f1")], four);
    assert.equal(ids(ranking)[0], "complete");
    assert.ok(!ids(ranking).includes("sparse"));
  });

  test("coverage is weighted, not counted", () => {
    // Target share carries three quarters of the weight on its own, so a row
    // that answered it and nothing else clears the threshold while a row that
    // answered the other two does not — a count of one beating a count of two,
    // which is the whole difference between weighing and tallying.
    const weighted = [
      pair("tgtsh", "last", 6),
      pair("yprr", "last", 1),
      pair("snap", "last", 1),
    ];
    const heavy = row("heavy", { tgtsh: 30, yprr: null, snap: null });
    const light = row("light", { tgtsh: null, yprr: 2, snap: 90 });
    const ranking = rankComps(subject, [heavy, light, filler("f1")], weighted);

    const kept = ranking.ranked.find((r) => r.row.id === "heavy");
    assert.ok(kept, "6 of 8 is 0.75 and clears the threshold");
    assert.ok(Math.abs(kept!.coverage - 0.75) < 1e-9);
    assert.ok(!ids(ranking).includes("light"), "2 of 8 is 0.25 and does not");
  });

  test("a disabled criterion is not in the request, so it cannot affect coverage", () => {
    // The panel produces pairs only for criteria that are on; coverage is
    // measured against what arrived, so a row unreadable on a criterion nobody
    // asked for is fully covered.
    const sparse = row("sparse", { ppg: 20, tgtsh: null, yprr: null, snap: null });
    const ranking = rankComps(subject, [sparse, filler("f1")], [pair("ppg")]);
    const kept = ranking.ranked.find((r) => r.row.id === "sparse")!;
    assert.equal(kept.coverage, 1);
    assert.equal(ranking.excludedLowCoverage, 0);
  });

  test("the threshold is exact at its boundary", () => {
    // Three of four equal weights is exactly the minimum.
    const three = row("three", { ppg: 20, tgtsh: 30, yprr: 2, snap: null });
    const two = row("two", { ppg: 20, tgtsh: 30, yprr: null, snap: null });
    const ranking = rankComps(subject, [three, two, filler("f1")], four);
    const kept = ranking.ranked.find((r) => r.row.id === "three");
    assert.ok(kept, "0.75 is at the minimum and passes");
    assert.equal(kept!.coverage, MIN_WEIGHTED_COVERAGE);
    assert.ok(!ids(ranking).includes("two"), "0.5 is below it");
    assert.equal(ranking.excludedLowCoverage, 1);
  });

  test("a pair the subject cannot read is nobody's coverage", () => {
    // YPRR is null for the whole corpus under the Sleeper source. Measured
    // against the full request every candidate would fail the threshold and
    // the board would come back empty; measured against what the subject can
    // answer, the comparison simply narrows.
    const blindSubject = row("s", { ppg: 20, tgtsh: 30, yprr: null });
    const pool = [
      row("a", { ppg: 19, tgtsh: 29, yprr: null }),
      row("b", { ppg: 12, tgtsh: 18, yprr: null }),
    ];
    const ranking = rankComps(blindSubject, pool, [pair("ppg"), pair("tgtsh"), pair("yprr")]);

    assert.deepEqual(ids(ranking), ["a", "b"]);
    assert.equal(ranking.ranked[0].coverage, 1);
    assert.equal(ranking.comparableWeight, 2);
    assert.equal(ranking.requestedWeight, 3);
    assert.ok(Math.abs(ranking.subjectCoverage - 2 / 3) < 1e-9);
    // The chip still draws the pair, with nothing in it.
    assert.deepEqual(ranking.ranked[0].pairs["yprr:last"], {
      gap: null,
      read: null,
      used: null,
      of: 1,
    });
  });

  test("a subject nothing can be read on ranks nothing", () => {
    const blind = row("s", { yprr: null });
    const ranking = rankComps(blind, [row("a", { yprr: 2 })], [pair("yprr")]);
    assert.deepEqual(ranking.ranked, []);
    assert.equal(ranking.comparableWeight, 0);
  });

  test("a row nothing can be read on is not a comp", () => {
    const subj = row("s", { yprr: 2, ppg: 20 });
    const blank = row("blank", { yprr: null, ppg: 20 });
    const ranking = rankComps(
      subj,
      [blank, row("ok", { yprr: 1, ppg: 12 }), row("ok2", { yprr: 1.5, ppg: 14 })],
      [pair("yprr")],
    );
    assert.deepEqual(ids(ranking), ["ok2", "ok"]);
    assert.equal(ranking.excludedLowCoverage, 1);
  });

  test("on a tie the row compared on more of the question comes first", () => {
    // Both are an exact match on PPG; one also answered target share and the
    // other did not. Equal distance, so the better-founded reading leads.
    const subj = row("s", { ppg: 20, tgtsh: 30, yprr: 2, snap: 90 });
    const thin = row("thin", { ppg: 20, tgtsh: 30, yprr: 2, snap: null });
    const full = row("full", { ppg: 20, tgtsh: 30, yprr: 2, snap: 90 });
    const ranking = rankComps(subj, [thin, full, filler("f1")], four);
    assert.equal(ranking.ranked[0].distance, ranking.ranked[1].distance);
    assert.deepEqual(ids(ranking).slice(0, 2), ["full", "thin"]);
  });
});

describe("the similarity a ranking stamps", () => {
  test("is monotonic with the distance and bounded", () => {
    const subject = row("s", { ppg: 20 });
    const pool = Array.from({ length: 30 }, (_, i) => row(`p${i}`, { ppg: i }));
    const ranking = rankComps(subject, pool, [pair("ppg")]);

    let previous = 101;
    for (const entry of ranking.ranked) {
      assert.ok(entry.similarity <= previous);
      assert.ok(entry.similarity >= 0 && entry.similarity <= 100);
      previous = entry.similarity;
    }
    assert.equal(ranking.similarity.calibrated, true);
  });

  test("a pool too small to calibrate still answers, on the fallback", () => {
    const ranking = rankComps(
      row("s", { ppg: 20 }),
      [row("a", { ppg: 19 }), row("b", { ppg: 4 })],
      [pair("ppg")],
    );
    assert.equal(ranking.similarity.calibrated, false);
    assert.ok(ranking.ranked.every((r) => Number.isInteger(r.similarity)));
  });

  test("ranking order is the distance's and is never re-sorted by the readout", () => {
    const subject = row("s", { ppg: 20 });
    const pool = Array.from({ length: 30 }, (_, i) => row(`p${i}`, { ppg: i / 2 }));
    const ranking = rankComps(subject, pool, [pair("ppg")]);
    const byDistance = [...ranking.ranked].sort((a, b) => a.distance - b.distance);
    assert.deepEqual(
      ranking.ranked.map((r) => r.row.id),
      byDistance.map((r) => r.row.id),
    );
  });
});

describe("zStats", () => {
  test("population standard deviation, with a zero spread becoming 1", () => {
    assert.deepEqual(zStats([2, 4, 4, 4, 5, 5, 7, 9]), { mean: 5, sd: 2 });
    assert.deepEqual(zStats([3, 3, 3]), { mean: 3, sd: 1 });
    assert.deepEqual(zStats([7]), { mean: 7, sd: 1 });
    assert.deepEqual(zStats([]), { mean: 0, sd: 1 });
  });

  test("never a non-finite scale", () => {
    for (const values of [[], [0], [1e308, -1e308]]) {
      const { mean, sd } = zStats(values);
      assert.ok(Number.isFinite(sd) && sd > 0, `sd for ${values}`);
      assert.ok(Number.isFinite(mean), `mean for ${values}`);
    }
  });
});

describe("closenessBars", () => {
  test("three bars under 0.3, two under 0.7, one otherwise, none for an unreadable pair", () => {
    assert.equal(closenessBars(0.1), 3);
    assert.equal(closenessBars(0.5), 2);
    assert.equal(closenessBars(1.2), 1);
    assert.equal(closenessBars(null), 0);
  });
});

describe("isEligible", () => {
  const bounds = { posLock: true, excludeOwn: true, from: 2018, to: 2024 };
  const subject = { player_id: "p1", position: "WR" };
  const season = (over: Partial<{ player_id: string; position: string; season: number }>) => ({
    player_id: "p2",
    position: "WR",
    season: 2021,
    ...over,
  });

  test("the season range always applies", () => {
    assert.equal(isEligible(season({ season: 2017 }), subject, bounds), false);
    assert.equal(isEligible(season({ season: 2025 }), subject, bounds), false);
    assert.equal(isEligible(season({ season: 2024 }), subject, bounds), true);
  });

  test("the position lock and own-season exclusion read the subject", () => {
    assert.equal(isEligible(season({ position: "RB" }), subject, bounds), false);
    assert.equal(isEligible(season({ position: "RB" }), subject, { ...bounds, posLock: false }), true);
    assert.equal(isEligible(season({ player_id: "p1" }), subject, bounds), false);
    assert.equal(isEligible(season({ player_id: "p1" }), subject, { ...bounds, excludeOwn: false }), true);
  });

  test("without a subject both are no-ops", () => {
    assert.equal(isEligible(season({ position: "RB", player_id: "p1" }), null, bounds), true);
  });
});

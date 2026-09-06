import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompPair, CompSeasonLine } from "@/shared/contract";

import {
  closenessBars,
  isEligible,
  rankComps,
  similarityPercent,
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

/**
 * The distance is the spec. Every rule below renders perfectly when it is
 * wrong — a null read as a zero, a weight applied to the criterion instead of
 * the pair, a two-column criterion counted twice — so this is where each one
 * is pinned.
 */
describe("rankComps", () => {
  const subject = row("subject", { ppg: 20 });

  test("nearest first, on a z-scored gap", () => {
    const pool = [row("far", { ppg: 5 }), row("near", { ppg: 19 }), row("mid", { ppg: 12 })];
    const ranked = rankComps(subject, pool, [pair("ppg")]);
    assert.deepEqual(
      ranked.map((r) => r.row.id),
      ["near", "mid", "far"],
    );
    assert.ok(ranked[0].distance < ranked[1].distance);
    // An identical reading is a zero gap.
    const twin = rankComps(subject, [row("twin", { ppg: 20 })], [pair("ppg")]);
    assert.equal(twin[0].distance, 0);
    assert.equal(twin[0].pairs["ppg:last"].gap, 0);
    assert.equal(twin[0].pairs["ppg:last"].read, 20);
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
    assert.equal(lastHeavy[0].row.id, "last-match");

    const bestHeavy = rankComps(subj, pool, [pair("ppg", "last", 0.2), pair("ppg", "chigh", 3)]);
    assert.equal(bestHeavy[0].row.id, "best-match");
  });

  test("a multi-field criterion averages its fields rather than counting twice", () => {
    // `recyd` reads yards and receptions. Both z-gaps are 2 here (two values
    // symmetric about their mean), so the pair's gap is their mean, 2, and
    // not their sum.
    const subj = row("s", { recyd: 1000, rec: 100 });
    const pool = [row("p", { recyd: 800, rec: 60 })];
    const [ranked] = rankComps(subj, pool, [pair("recyd")]);
    assert.ok(Math.abs(ranked.pairs["recyd:last"].gap! - 2) < 1e-9);
    // Compare against a single-field criterion with the same z-gap on its one
    // field: the two must agree, which is the whole point of the mean.
    const [single] = rankComps(row("s", { ppg: 20 }), [row("p", { ppg: 10 })], [pair("ppg")]);
    assert.ok(Math.abs(single.pairs["ppg:last"].gap! - 2) < 1e-9);
    assert.ok(Math.abs(ranked.distance - single.distance) < 1e-9);
  });

  test("dividing by the weight sum keeps the distance comparable as pairs are added", () => {
    const subj = row("s", { ppg: 20, gp: 17 });
    const pool = [row("p", { ppg: 10, gp: 10 })];
    const one = rankComps(subj, pool, [pair("ppg", "last", 2)])[0].distance;
    // Doubling every weight changes nothing.
    const doubled = rankComps(subj, pool, [pair("ppg", "last", 4)])[0].distance;
    assert.ok(Math.abs(one - doubled) < 1e-9);
    // Adding a pair with the same gap (two values symmetric about their mean
    // are two z-units apart whatever the field) leaves the RMS where it was
    // rather than growing it.
    const two = rankComps(subj, pool, [pair("ppg", "last", 2), pair("gp", "last", 2)]);
    assert.ok(Math.abs(two[0].distance - one) < 1e-9);
  });

  test("a null stat costs the pair, not the row, and drops its weight", () => {
    const subj = row("s", { ppg: 20, tgtsh: 30 });
    const patchy = row("patchy", { ppg: 20, tgtsh: null });
    const whole = row("whole", { ppg: 10, tgtsh: 30 });
    const ranked = rankComps(subj, [patchy, whole], [pair("ppg"), pair("tgtsh")]);
    const p = ranked.find((r) => r.row.id === "patchy")!;
    assert.deepEqual(p.pairs["tgtsh:last"], { gap: null, read: null });
    // With target share unreadable the patchy row is scored on PPG alone,
    // where it is identical to the subject — so it ranks first rather than
    // being pushed away by a phantom zero.
    assert.equal(ranked[0].row.id, "patchy");
    assert.equal(p.distance, 0);
  });

  test("a row nothing can be read on is not a comp", () => {
    const subj = row("s", { yprr: 2 });
    const blank = row("blank", { yprr: null });
    assert.deepEqual(rankComps(subj, [blank, row("ok", { yprr: 1 })], [pair("yprr")]).map((r) => r.row.id), ["ok"]);
  });

  test("no pairs ranks nothing", () => {
    assert.deepEqual(rankComps(subject, [row("p", {})], []), []);
  });

  test("a constant feature contributes a zero gap rather than a division by zero", () => {
    const [ranked] = rankComps(row("s", { gp: 17 }), [row("p", { gp: 17 })], [pair("gp")]);
    assert.equal(ranked.distance, 0);
    assert.equal(Number.isFinite(ranked.distance), true);
  });
});

describe("zStats", () => {
  test("population standard deviation, with a zero spread becoming 1", () => {
    assert.deepEqual(zStats([2, 4, 4, 4, 5, 5, 7, 9]), { mean: 5, sd: 2 });
    assert.deepEqual(zStats([3, 3, 3]), { mean: 3, sd: 1 });
    assert.deepEqual(zStats([]), { mean: 0, sd: 1 });
  });
});

describe("similarityPercent", () => {
  test("100 at zero distance, falling on the documented decay", () => {
    assert.equal(similarityPercent(0), 100);
    assert.equal(similarityPercent(1), 54);
    assert.ok(similarityPercent(3) < similarityPercent(2));
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

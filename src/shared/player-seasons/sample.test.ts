import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompPair } from "@/shared/contract";
import { CRITERIA, WINDOWS, isWindowed } from "../comps/criteria.ts";
import { isEligible, rankComps } from "../comps/knn.ts";

import { SAMPLE_CORPUS } from "./sample.ts";

/**
 * The sample corpus is a transcription, and a transcription is checked by
 * running it: the prototype's own arithmetic, run over its own tables, ranks
 * these players in this order at these distances (to six places). The port
 * must agree — the arithmetic is the spec, and this is the one test that
 * reads it end to end rather than rule by rule.
 *
 * The expected rows were produced by extracting the prototype's `CORPUS`,
 * `PREV`, `windowValue` and distance loop from `Comps.dc.html` and running
 * them under Node; nothing here was typed by hand.
 */

const defaultPairs = (): CompPair[] =>
  CRITERIA.filter((c) => c.on).flatMap((c) =>
    c.wins.map((w) => ({ criterion: c.id, window: w.id, weight: w.w })),
  );

const everyWindow = (): CompPair[] =>
  CRITERIA.flatMap((c) =>
    isWindowed(c)
      ? WINDOWS.map((w) => ({ criterion: c.id, window: w.id, weight: 1 }))
      : c.wins.map((w) => ({ criterion: c.id, window: w.id, weight: w.w })),
  );

function rank(name: string, pairs: CompPair[], k: number) {
  const subject = SAMPLE_CORPUS.subjects.find((s) => s.name === name)!;
  const pool = SAMPLE_CORPUS.seasons.filter((s) =>
    isEligible(s, subject, { posLock: true, excludeOwn: true, from: 2018, to: 2024 }),
  );
  return rankComps(subject, pool, pairs).slice(0, k);
}

const shape = (ranked: ReturnType<typeof rank>) =>
  ranked.map((r) => [r.row.name, r.row.season, Number(r.distance.toFixed(6))]);

describe("the sample corpus", () => {
  test("is the prototype's: 26 seasons, 12 subjects entering 2026, three rookie rows", () => {
    assert.equal(SAMPLE_CORPUS.source, "sample");
    assert.equal(SAMPLE_CORPUS.subject_season, 2026);
    assert.equal(SAMPLE_CORPUS.seasons.length, 26);
    assert.equal(SAMPLE_CORPUS.subjects.length, 12);
    assert.deepEqual(
      SAMPLE_CORPUS.seasons.filter((s) => s.history.length === 1).map((s) => `${s.name} ${s.season}`),
      ["Ja'Marr Chase 2021", "Puka Nacua 2023", "Saquon Barkley 2018"],
    );
    assert.equal(new Set(SAMPLE_CORPUS.subjects.map((s) => s.player_id)).size, 12);
    // A player on both sides carries one id, which is what the own-season
    // exclusion reads.
    const nacua = SAMPLE_CORPUS.subjects.find((s) => s.name === "Puka Nacua")!;
    assert.ok(SAMPLE_CORPUS.seasons.some((s) => s.player_id === nacua.player_id));
  });

  test("ranks Puka Nacua as the prototype does under the default criteria", () => {
    const ranked = rank("Puka Nacua", defaultPairs(), 10);
    assert.deepEqual(shape(ranked), [
    ["Tyreek Hill", 2018, 0.734071],
    ["Nico Collins", 2024, 0.737608],
    ["Amon-Ra St. Brown", 2022, 0.769159],
    ["Chris Godwin", 2019, 0.795879],
    ["A.J. Brown", 2022, 0.863177],
    ["DK Metcalf", 2020, 0.899203],
    ["Stefon Diggs", 2020, 0.920164],
    ["Mike Evans", 2018, 1.212792],
    ["Justin Jefferson", 2022, 1.268953],
    ["Ja'Marr Chase", 2021, 1.306956]
    ]);
    // And the per-pair gaps the chips draw from, on the nearest comp.
    for (const [key, gap] of [
    ["age:last", 0.000000],
    ["draft:last", 0.240238],
    ["ppg:last", 0.060944],
    ["ppg:chigh", 0.062427],
    ["recyd:last", 0.842019],
    ["tgtsh:last", 1.905963],
    ["yprr:avg2", 0.182410],
    ["exp:last", 0.000000]
    ] as const) {
      assert.equal(Number(ranked[0].pairs[key].gap!.toFixed(6)), gap, key);
    }
  });

  test("ranks a running back against running backs only", () => {
    const ranked = rank("Bijan Robinson", defaultPairs(), 10);
    assert.ok(ranked.every((r) => r.row.position === "RB"));
    assert.ok(ranked.every((r) => r.row.name !== "Bijan Robinson"));
    assert.deepEqual(shape(ranked), [
    ["Jonathan Taylor", 2021, 0.900543],
    ["Austin Ekeler", 2021, 1.201472],
    ["Alvin Kamara", 2020, 1.217297],
    ["Saquon Barkley", 2018, 1.348530],
    ["Christian McCaffrey", 2019, 2.186706]
    ]);
  });

  test("ranks a rookie-year subject as the prototype does", () => {
    assert.deepEqual(shape(rank("Rome Odunze", defaultPairs(), 10)), [
    ["Tee Higgins", 2021, 0.645656],
    ["Garrett Wilson", 2023, 0.737310],
    ["CeeDee Lamb", 2021, 0.785682],
    ["DK Metcalf", 2020, 1.082913],
    ["Terry McLaurin", 2022, 1.128353],
    ["Brandon Aiyuk", 2023, 1.146774],
    ["Amon-Ra St. Brown", 2022, 1.262284],
    ["Mike Evans", 2018, 1.308263],
    ["Chris Godwin", 2019, 1.458810],
    ["A.J. Brown", 2022, 1.493481]
    ]);
  });

  test("agrees with the prototype over every criterion and every window", () => {
    assert.deepEqual(shape(rank("Puka Nacua", everyWindow(), 25)), [
    ["Amon-Ra St. Brown", 2022, 0.864198],
    ["Nico Collins", 2024, 0.876656],
    ["Stefon Diggs", 2020, 0.939864],
    ["A.J. Brown", 2022, 1.050265],
    ["Keenan Allen", 2020, 1.091472],
    ["Mike Evans", 2018, 1.101699],
    ["DK Metcalf", 2020, 1.116924],
    ["Chris Godwin", 2019, 1.137579],
    ["Davante Adams", 2020, 1.223320],
    ["CeeDee Lamb", 2021, 1.244900],
    ["Ja'Marr Chase", 2021, 1.386804],
    ["Tee Higgins", 2021, 1.394229],
    ["Garrett Wilson", 2023, 1.409468],
    ["Terry McLaurin", 2022, 1.420010],
    ["Brandon Aiyuk", 2023, 1.474087],
    ["Tyreek Hill", 2018, 1.568923],
    ["Justin Jefferson", 2022, 1.619303],
    ["Cooper Kupp", 2021, 1.701010],
    ["Michael Thomas", 2019, 1.720691]
    ]);
  });
});

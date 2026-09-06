import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompSeasonLine } from "@/shared/contract";

import { buildCorpus, corpusBounds, toCompMatch, toCompSubject } from "./corpus.ts";
import type { StoredSeason } from "./corpus.ts";

const line = (ppg: number): CompSeasonLine => ({
  ppg,
  pts: ppg * 16,
  recyd: 800,
  rec: 60,
  tgtsh: 20,
  rush: 0,
  yprr: 1.8,
  snap: 80,
  gp: 16,
});

const stored = (
  player_id: string,
  season: number,
  ppg: number,
  finish: string | null = `WR${ppg}`,
): StoredSeason => ({
  player_id,
  name: player_id.toUpperCase(),
  position: "WR",
  season,
  facts: { age: 20 + (season - 2018), exp: season - 2018, draft: 10 },
  line: line(ppg),
  finish,
});

/**
 * Which rows are comps, which are subjects, and what each row's series holds
 * — the three rules that are silent when wrong, because a corpus built with
 * any of them backwards still ranks and still renders.
 */
describe("buildCorpus", () => {
  test("a comp is a season with the following season on file, and the payoff is that season", () => {
    const corpus = buildCorpus(
      [stored("a", 2018, 10), stored("a", 2019, 12), stored("a", 2020, 14)],
      "stored",
    );
    assert.deepEqual(
      corpus.seasons.map((s) => s.season),
      [2018, 2019],
    );
    const first = corpus.seasons[0];
    assert.equal(first.next.ppg, 12);
    assert.equal(first.next.finish, "WR12");
  });

  test("a gap in a career is not bridged: a season with no next-year row is not a comp", () => {
    const corpus = buildCorpus(
      [stored("a", 2018, 10), stored("a", 2020, 14), stored("a", 2021, 15)],
      "stored",
    );
    assert.deepEqual(
      corpus.seasons.map((s) => s.season),
      [2020],
    );
  });

  test("the latest season's rows are the subjects, entering the season after it", () => {
    const corpus = buildCorpus(
      [stored("a", 2023, 10), stored("a", 2024, 12), stored("b", 2024, 9)],
      "stored",
    );
    assert.equal(corpus.subject_season, 2025);
    assert.deepEqual(
      corpus.subjects.map((s) => [s.player_id, s.last_season]),
      [["a", 2024], ["b", 2024]],
    );
    // A subject's own latest row is not a comp — nothing follows it.
    assert.deepEqual(corpus.seasons.map((s) => `${s.player_id}:${s.season}`), ["a:2023"]);
  });

  test("a row's series is its own season and the ones before it, newest first, and never after", () => {
    const corpus = buildCorpus(
      [stored("a", 2018, 10), stored("a", 2019, 12), stored("a", 2020, 14), stored("a", 2021, 16)],
      "stored",
    );
    const s2019 = corpus.seasons.find((s) => s.season === 2019)!;
    assert.deepEqual(
      s2019.history.map((l) => l.ppg),
      [12, 10],
    );
    const subject = corpus.subjects[0];
    assert.deepEqual(
      subject.history.map((l) => l.ppg),
      [16, 14, 12, 10],
    );
  });

  test("an empty table builds an empty corpus", () => {
    assert.deepEqual(buildCorpus([], "stored"), {
      source: "stored",
      subject_season: 0,
      seasons: [],
      subjects: [],
    });
    assert.deepEqual(corpusBounds(buildCorpus([], "stored")), { from: 0, to: 0, seasons: 0 });
  });

  test("the bounds are the comp seasons' edges, not the table's", () => {
    const corpus = buildCorpus(
      [stored("a", 2018, 10), stored("a", 2019, 12), stored("b", 2023, 9), stored("b", 2024, 11)],
      "stored",
    );
    // 2024 is the subject season and 2019 has nothing after it.
    assert.deepEqual(corpusBounds(corpus), { from: 2018, to: 2023, seasons: 2 });
  });
});

describe("the wire mappers", () => {
  const corpus = buildCorpus(
    [stored("a", 2023, 10), stored("a", 2024, 12), stored("b", 2024, 9)],
    "stored",
  );

  test("a subject carries his last line, his facts and his years on file", () => {
    const subject = toCompSubject(corpus.subjects[0], corpus.subject_season);
    assert.equal(subject.season, 2025);
    assert.equal(subject.last_season, 2024);
    assert.equal(subject.line.ppg, 12);
    assert.equal(subject.years_on_file, 2);
    assert.equal(subject.age, 26);
    assert.equal(subject.ktc, null);
  });

  test("a match carries the comp season's own line and the payoff beside it", () => {
    const match = toCompMatch({
      row: corpus.seasons[0],
      distance: 0.4,
      pairs: { "ppg:last": { gap: 0.1, read: 10 } },
    });
    assert.equal(match.season, 2023);
    assert.equal(match.line.ppg, 10);
    assert.equal(match.next.ppg, 12);
    assert.equal(match.years_on_file, 1);
    assert.equal(match.distance, 0.4);
    assert.deepEqual(match.pairs["ppg:last"], { gap: 0.1, read: 10 });
  });
});

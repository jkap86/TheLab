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
    assert.equal(first.next.played, true);
  });

  test("a gap in a career is not bridged: a season with no next-year row is not a comp", () => {
    // 2019 is not a covered season here — nobody has a row in it — so 2018's
    // following year is unknown rather than empty, and 2018 is left out. That
    // is the "we have no data" arm; the "he did not play" arm is below.
    const corpus = buildCorpus(
      [stored("a", 2018, 10), stored("a", 2020, 14), stored("a", 2021, 15)],
      "stored",
    );
    assert.deepEqual(
      corpus.seasons.map((s) => s.season),
      [2020],
    );
    assert.deepEqual(corpus.covered_seasons, [2018, 2020, 2021]);
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
      covered_seasons: [],
      max_completed_season: 0,
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
      coverage: 0.8,
      similarity: 78,
      pairs: { "ppg:last": { gap: 0.1, read: 10, used: 1, of: 1 } },
    });
    assert.equal(match.season, 2023);
    assert.equal(match.line.ppg, 10);
    assert.equal(match.next.ppg, 12);
    assert.equal(match.years_on_file, 1);
    assert.equal(match.distance, 0.4);
    assert.equal(match.coverage, 0.8);
    assert.equal(match.similarity, 78);
    assert.deepEqual(match.pairs["ppg:last"], { gap: 0.1, read: 10, used: 1, of: 1 });
  });
});

/**
 * Survivorship. The rule this replaced required a stored row at season N+1
 * before season N could be a comp, which deleted every retirement, every
 * career-ending injury, every lost season and everyone who fell out of the
 * league — the outcomes a reader looks at a comp to find out about — and left
 * a forward-outcome distribution whose bad half was missing.
 *
 * The fix turns on one distinction, and it is the only thing here that is hard
 * to get right: an absence in a season the corpus **covered** is a measurement,
 * and an absence in a season nobody loaded is a hole. Every test below is one
 * side or the other of that line.
 */
describe("buildCorpus and the following season", () => {
  const covered = { coveredSeasons: [2020, 2021, 2022, 2023] };

  test("an active player with a normal following season carries it", () => {
    const corpus = buildCorpus(
      [stored("a", 2021, 12), stored("a", 2022, 15), stored("b", 2022, 9)],
      "stored",
      covered,
    );
    const season = corpus.seasons.find((s) => s.player_id === "a" && s.season === 2021)!;
    assert.equal(season.next.played, true);
    assert.equal(season.next.ppg, 15);
    assert.equal(season.next.finish, "WR15");
  });

  test("a player who retired after his last season is still a comp, with a zero outcome", () => {
    // "b" holds 2022 open as a covered season; "a" simply is not in it.
    const corpus = buildCorpus(
      [stored("a", 2020, 14), stored("a", 2021, 11), stored("b", 2022, 9)],
      "stored",
      covered,
    );
    const last = corpus.seasons.find((s) => s.player_id === "a" && s.season === 2021)!;
    assert.ok(last, "the retirement season is a comp rather than being deleted");
    assert.deepEqual(last.next, {
      ppg: 0,
      recyd: 0,
      rec: 0,
      gp: 0,
      finish: null,
      played: false,
    });
  });

  test("a season missed in the middle of a career is a zero outcome, not a bridge", () => {
    // He played 2020, missed 2021 entirely, came back in 2022. 2020's payoff
    // is the season he missed — zero — and never 2022's, which would bridge
    // over a year and score the comp on a season two years out.
    const corpus = buildCorpus(
      [stored("a", 2020, 14), stored("a", 2022, 16), stored("b", 2021, 9), stored("b", 2022, 8)],
      "stored",
      covered,
    );
    const s2020 = corpus.seasons.find((s) => s.player_id === "a" && s.season === 2020)!;
    assert.equal(s2020.next.played, false);
    assert.equal(s2020.next.gp, 0);
    assert.equal(s2020.next.ppg, 0);
  });

  test("an uncovered following season is unknown, and is not a comp at all", () => {
    // The same career, with 2021 outside what the loader wrote. Nothing here
    // says he did not play — only that we cannot say — so the season is left
    // out rather than turned into a zero.
    const corpus = buildCorpus(
      [stored("a", 2020, 14), stored("a", 2022, 16)],
      "stored",
      { coveredSeasons: [2020, 2022] },
    );
    assert.deepEqual(corpus.seasons.map((s) => s.season), []);
  });

  test("the latest season is never a comp: its outcome is not knowable yet", () => {
    const corpus = buildCorpus(
      [stored("a", 2022, 12), stored("a", 2023, 14), stored("b", 2023, 9)],
      "stored",
      covered,
    );
    assert.deepEqual(
      corpus.seasons.map((s) => `${s.player_id}:${s.season}`),
      ["a:2022"],
    );
    assert.equal(corpus.subject_season, 2024);
  });

  test("a season past the last complete one answers for nobody, present or absent", () => {
    // A season still being played is not an outcome even for the players who
    // *do* have rows in it: a payoff nine games short would read as a collapse
    // for the whole corpus. So an incomplete following season disqualifies the
    // row rather than being used, and an absence in it is certainly not a
    // retirement.
    const rows = [stored("a", 2021, 12), stored("b", 2021, 9), stored("b", 2022, 10)];
    const strict = buildCorpus(rows, "stored", {
      coveredSeasons: [2021, 2022],
      maxCompletedSeason: 2021,
    });
    assert.deepEqual(
      strict.seasons.map((s) => `${s.player_id}:${s.season}`),
      [],
      "2022 is covered but not complete, so 2021 has no knowable outcome either way",
    );

    const complete = buildCorpus(rows, "stored", {
      coveredSeasons: [2021, 2022],
      maxCompletedSeason: 2022,
    });
    assert.equal(complete.seasons.find((s) => s.player_id === "a")!.next.played, false);
    assert.equal(complete.seasons.find((s) => s.player_id === "b")!.next.played, true);
  });

  test("covered seasons default to the seasons on file, and are reported", () => {
    const corpus = buildCorpus(
      [stored("a", 2020, 14), stored("a", 2021, 11), stored("b", 2021, 9)],
      "stored",
    );
    assert.deepEqual(corpus.covered_seasons, [2020, 2021]);
    assert.equal(corpus.max_completed_season, 2021);
  });

  test("a did-not-play season still carries its own line and series", () => {
    // The comp is the season he *had*; only the payoff is zero. A reader
    // comparing against it is comparing against a real season.
    const corpus = buildCorpus(
      [stored("a", 2020, 14), stored("a", 2021, 11), stored("b", 2022, 9)],
      "stored",
      covered,
    );
    const last = corpus.seasons.find((s) => s.player_id === "a" && s.season === 2021)!;
    assert.equal(last.history.length, 2);
    assert.equal(last.history[0].ppg, 11);
    assert.equal(last.history[1].ppg, 14);
  });
});

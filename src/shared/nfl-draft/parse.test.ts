import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCsv, parseNflDraftPicks, settledClasses } from "./parse.ts";

const HEADER = "sleeper_id,name,draft_year,draft_round,draft_pick,draft_ovr";

/** A crosswalk row in the source's own column order. */
const line = (
  sleeperId: string,
  name: string,
  year: string,
  round: string,
  slot: string,
  overall: string,
) => `${sleeperId},${name},${year},${round},${slot},${overall}`;

/** A file whose newest class is settled, so undrafted rows are storable. */
const csv = (...rows: string[]) =>
  [HEADER, line("999", "Anchor", "2020", "1", "1", "1"), ...rows].join("\n");

const pickFor = (out: ReturnType<typeof parseNflDraftPicks>, id: string) =>
  out.picks.find((pick) => pick.playerId === id);

describe("parseCsv", () => {
  test("splits plain rows and keeps every field", () => {
    assert.deepEqual(parseCsv("a,b\n1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a quoted field may contain the delimiter", () => {
    assert.deepEqual(parseCsv('a,b\n"Miami, O.",2'), [
      ["a", "b"],
      ["Miami, O.", "2"],
    ]);
  });

  test("a doubled quote inside a quoted field is one literal quote", () => {
    assert.deepEqual(parseCsv('a\n"He said ""hi"""'), [["a"], ['He said "hi"']]);
  });

  test("CRLF and a trailing newline do not produce a phantom row", () => {
    assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a file with no trailing newline still yields its last row", () => {
    assert.deepEqual(parseCsv("a\n1"), [["a"], ["1"]]);
  });

  test("a newline inside a quoted field does not split the row", () => {
    assert.deepEqual(parseCsv('a,b\n"two\nlines",2'), [
      ["a", "b"],
      ["two\nlines", "2"],
    ]);
  });

  test("empty fields survive rather than collapsing", () => {
    assert.deepEqual(parseCsv("a,b,c\n1,,3"), [
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("parseNflDraftPicks", () => {
  test("reads columns by name, so the source may reorder them", () => {
    const reordered = [
      "draft_ovr,draft_pick,draft_round,draft_year,name,sleeper_id",
      "5,5,1,2020,Someone,42",
    ].join("\n");
    assert.deepEqual(parseNflDraftPicks(reordered).picks, [
      { playerId: "42", season: "2020", round: 1, slot: 5, overall: 5 },
    ]);
  });

  /**
   * A renamed column is what a source change looks like from here, and it is
   * otherwise silent: every row would read as absent and the sync would refuse
   * an empty crosswalk with no clue why.
   */
  test("a missing column throws and names what is missing", () => {
    assert.throws(
      () => parseNflDraftPicks("sleeper_id,name\n1,Someone"),
      /draft_year/,
    );
  });

  test("a drafted player keeps round, slot and overall as given", () => {
    const out = parseNflDraftPicks(csv(line("7", "Joe", "2020", "1", "1", "1")));
    assert.deepEqual(pickFor(out, "7"), {
      playerId: "7",
      season: "2020",
      round: 1,
      slot: 1,
      overall: 1,
    });
  });

  /**
   * Compensatory picks make round sizes uneven, so overall is never derived
   * from round-and-slot nor the reverse — this row's numbers do not reconcile
   * arithmetically and both are still kept exactly as the source gave them.
   */
  test("round and overall are read, never computed from each other", () => {
    const out = parseNflDraftPicks(csv(line("8", "Ga", "2026", "7", "33", "249")));
    const pick = pickFor(out, "8");
    assert.equal(pick?.round, 7);
    assert.equal(pick?.slot, 33);
    assert.equal(pick?.overall, 249);
  });

  test("a row with no sleeper id is not addressable and is counted", () => {
    const out = parseNflDraftPicks(csv(line("NA", "Nobody", "2020", "1", "2", "2")));
    assert.equal(pickFor(out, "NA"), undefined);
    assert.equal(out.rejected.no_sleeper_id, 1);
  });

  test("NA and empty are absent, and never read as zero", () => {
    const out = parseNflDraftPicks(csv(line("9", "Un", "2020", "NA", "", "NA")));
    assert.deepEqual(pickFor(out, "9"), {
      playerId: "9",
      season: "2020",
      round: null,
      slot: null,
      overall: null,
    });
  });

  test("a junk draft year is rejected rather than becoming a class", () => {
    const out = parseNflDraftPicks(
      csv(line("10", "Tony", "0", "NA", "NA", "NA"), line("11", "X", "abc", "1", "1", "3")),
    );
    assert.equal(pickFor(out, "10"), undefined);
    assert.equal(pickFor(out, "11"), undefined);
    assert.equal(out.rejected.bad_season, 2);
  });

  test("a pick with no round is half a row and is refused", () => {
    const out = parseNflDraftPicks(csv(line("12", "Half", "2020", "NA", "NA", "50")));
    assert.equal(pickFor(out, "12"), undefined);
    assert.equal(out.rejected.bad_pick, 1);
  });

  test("an implausible pick number is refused", () => {
    const out = parseNflDraftPicks(csv(line("13", "Big", "2020", "1", "1", "9999")));
    assert.equal(pickFor(out, "13"), undefined);
  });
});

describe("undrafted against not-yet-drafted", () => {
  /**
   * The rule that separates a real answer from an absent one, read off the data
   * rather than off a calendar: a class carrying at least one drafted player has
   * been held, so everyone else in it went undrafted.
   */
  test("an undrafted player in a held class is stored as undrafted", () => {
    const out = parseNflDraftPicks(
      csv(line("20", "Ekeler", "2020", "NA", "NA", "NA")),
    );
    assert.deepEqual(pickFor(out, "20"), {
      playerId: "20",
      season: "2020",
      round: null,
      slot: null,
      overall: null,
    });
  });

  test("a prospect in a class nobody has been drafted in is held back", () => {
    const out = parseNflDraftPicks(
      csv(line("21", "Prospect", "2027", "NA", "NA", "NA")),
    );
    assert.equal(pickFor(out, "21"), undefined);
    assert.equal(out.rejected.class_pending, 1);
    assert.equal(out.newestSettledSeason, "2020");
  });

  test("one recorded pick settles the class for everybody in it", () => {
    const out = parseNflDraftPicks(
      csv(
        line("22", "First", "2027", "1", "1", "1"),
        line("23", "Undrafted", "2027", "NA", "NA", "NA"),
      ),
    );
    assert.equal(pickFor(out, "23")?.overall, null);
    assert.equal(out.rejected.class_pending, 0);
    assert.equal(out.newestSettledSeason, "2027");
  });

  test("settledClasses names every class with a drafted player and no others", () => {
    const settled = settledClasses([
      { playerId: "a", season: "2020", round: 1, slot: 1, overall: 1 },
      { playerId: "b", season: "2021", round: null, slot: null, overall: null },
    ]);
    assert.ok(settled.has("2020"));
    assert.ok(!settled.has("2021"));
  });
});

describe("duplicate sleeper ids", () => {
  /**
   * The crosswalk resolves a handful of ids onto two same-named players, one
   * modern and one historical, so the pair carries two draft positions and
   * nothing in the file says which belongs to the id. Keeping either would hand
   * a real, plausible pick to the wrong player.
   */
  test("rows that disagree poison the id entirely", () => {
    const out = parseNflDraftPicks(
      csv(
        line("30", "Greg Jones", "2011", "6", "20", "185"),
        line("30", "Greg Jones", "2004", "2", "23", "55"),
      ),
    );
    assert.equal(pickFor(out, "30"), undefined);
    assert.equal(out.rejected.conflicting_duplicate, 2);
  });

  test("a drafted row and an undrafted row for one id also disagree", () => {
    const out = parseNflDraftPicks(
      csv(
        line("31", "Ray Agnew", "2014", "NA", "NA", "NA"),
        line("31", "Ray Agnew", "1990", "1", "10", "10"),
      ),
    );
    assert.equal(pickFor(out, "31"), undefined);
  });

  test("a third disagreeing row does not resurrect a poisoned id", () => {
    const out = parseNflDraftPicks(
      csv(
        line("32", "A", "2011", "6", "20", "185"),
        line("32", "A", "2004", "2", "23", "55"),
        line("32", "A", "2011", "6", "20", "185"),
      ),
    );
    assert.equal(pickFor(out, "32"), undefined);
  });

  test("rows that agree are folded to one pick, not dropped", () => {
    const out = parseNflDraftPicks(
      csv(
        // Settles 2014, so the undrafted pair below is publishable and the
        // assertion is about folding rather than about the pending rule.
        line("98", "Anchor14", "2014", "1", "1", "1"),
        line("33", "Same", "2014", "NA", "NA", "NA"),
        line("33", "Same Guy", "2014", "NA", "NA", "NA"),
      ),
    );
    assert.equal(pickFor(out, "33")?.season, "2014");
    assert.equal(out.rejected.conflicting_duplicate, 0);
    assert.equal(out.picks.filter((p) => p.playerId === "33").length, 1);
  });

  test("a junk-year twin leaves the good row standing", () => {
    const out = parseNflDraftPicks(
      csv(
        line("97", "Anchor09", "2009", "1", "1", "1"),
        line("34", "Tony Carter", "0", "NA", "NA", "NA"),
        line("34", "Tony Carter", "2009", "NA", "NA", "NA"),
      ),
    );
    assert.equal(pickFor(out, "34")?.season, "2009");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCsv, parseDraftCapital } from "./draft-source.ts";

/**
 * The crosswalk's two draft columns read as three states, each of which
 * renders a perfectly ordinary board while being wrong: a UDFA read as
 * unknown drops a real fact from the distance, an unknown read as a UDFA is
 * the bug that put the word under every player on the page.
 */

const HEADER =
  "mfl_id,sleeper_id,gsis_id,name,position,draft_year,draft_round,draft_pick,draft_ovr,db_season";

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n") + "\n";

describe("parseDraftCapital", () => {
  test("a drafted player is his overall pick and a year with no pick is a known UDFA", () => {
    const parsed = parseDraftCapital(
      csv(
        "15281,7564,00-0036900,Ja'Marr Chase,WR,2021,1,5,5,2026",
        "12345,4663,00-0033699,Austin Ekeler,RB,2017,NA,NA,NA,2026",
      ),
    );
    assert.equal(parsed.capital.get("7564"), 5);
    assert.equal(parsed.capital.get("4663"), "udfa");
    assert.equal(parsed.rows, 2);
    assert.deepEqual(parsed.conflicts, []);
  });

  test("a row with no draft year and no pick is unknown — absent, never a UDFA", () => {
    const parsed = parseDraftCapital(csv("1,999,NA,Nobody Known,WR,NA,NA,NA,NA,2026"));
    assert.equal(parsed.capital.has("999"), false);
    assert.equal(parsed.rows, 1);
  });

  test("a row naming no Sleeper id contributes nothing", () => {
    const parsed = parseDraftCapital(
      csv("1,NA,00-0019596,Tom Brady,QB,2000,6,33,199,2026", "2,abc,NA,Junk,QB,2000,6,33,199,2026"),
    );
    assert.equal(parsed.capital.size, 0);
    assert.equal(parsed.rows, 2);
  });

  test("an implausible overall pick is unknown rather than a pick", () => {
    const parsed = parseDraftCapital(
      csv("1,10,NA,A,WR,2021,1,1,0,2026", "2,11,NA,B,WR,2021,1,1,9999,2026", "3,12,NA,C,WR,2021,1,1,1.5,2026"),
    );
    assert.equal(parsed.capital.size, 0);
  });

  test("a Sleeper id listed twice with two answers resolves to nobody", () => {
    // The KTC matcher's rule: ambiguous is unknown, not last-wins.
    const parsed = parseDraftCapital(
      csv(
        "1,133,NA,Same Id,WR,2010,3,1,65,2026",
        "2,133,NA,Same Id,WR,2010,NA,NA,NA,2026",
        "3,133,NA,Same Id,WR,2010,3,1,65,2026",
      ),
    );
    assert.equal(parsed.capital.has("133"), false);
    assert.deepEqual(parsed.conflicts, ["133"]);
  });

  test("a Sleeper id listed twice with one answer keeps it", () => {
    const parsed = parseDraftCapital(
      csv("1,133,NA,Same Id,WR,2010,3,1,65,2026", "2,133,NA,Same Id,WR,2010,3,1,65,2026"),
    );
    assert.equal(parsed.capital.get("133"), 65);
    assert.deepEqual(parsed.conflicts, []);
  });

  test("a file missing a needed column is refused rather than read as empty", () => {
    assert.throws(
      () => parseDraftCapital("mfl_id,sleeper_id,draft_year\n1,2,2021\n"),
      /draft_ovr/,
    );
    assert.throws(() => parseDraftCapital(""), /empty/);
  });

  test("columns are found by name, so a reordered header still reads", () => {
    const parsed = parseDraftCapital(
      "draft_ovr,name,sleeper_id,draft_year\r\n177,Puka Nacua,9493,2023\r\n",
    );
    assert.equal(parsed.capital.get("9493"), 177);
  });
});

describe("parseCsv", () => {
  test("quoted fields keep their commas, newlines and doubled quotes", () => {
    const parsed = parseCsv('a,"b, c","say ""hi""","two\nlines"\n1,2,3,4\n');
    assert.deepEqual(parsed, [
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["1", "2", "3", "4"],
    ]);
  });

  test("CRLF and a missing final newline both end a record", () => {
    assert.deepEqual(parseCsv("a,b\r\n1,2\r\n3,4"), [
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("an empty field is an empty string, not a dropped column", () => {
    assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
  });
});

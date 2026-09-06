import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ageAt, experienceAt, playerFactsAt } from "./facts.ts";
import type { PlayerRecord } from "./facts.ts";

const record = (over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  player_id: "p1",
  name: "Some Player",
  position: "WR",
  birth_date: "1999-05-20",
  rookie_year: 2021,
  years_exp: 5,
  ...over,
});

/**
 * The players map is Sleeper's *current* players and every dated field on it
 * is current too, so a past season's facts are all derivations. Each has a
 * failure mode the loader would otherwise write into a NOT NULL column and
 * never mention again.
 */
describe("ageAt", () => {
  test("is the age at the season's own instant", () => {
    // Born May 1999, measured at the first of September.
    assert.equal(ageAt("1999-05-20", 2023)!.value, 24.3);
    assert.equal(ageAt("1999-05-20", 2018)!.value, 19.3);
  });

  test("a full timestamp is read from its date half", () => {
    assert.equal(ageAt("1999-05-20T00:00:00Z", 2023)!.value, 24.3);
  });

  test("an unreadable or implausible birth date is absent, never a zero age", () => {
    for (const birth of [null, "", "not-a-date", "99-05-20", "2024-01-01", "1900-01-01"]) {
      assert.equal(ageAt(birth, 2023), null, String(birth));
    }
  });
});

describe("experienceAt", () => {
  test("`rookie_year` answers first, because it is exact", () => {
    const answer = experienceAt(record({ rookie_year: 2021 }), 2024, 2025)!;
    assert.deepEqual(answer, { value: 3, basis: "rookie_year" });
  });

  test("a rookie season is zero, not one", () => {
    assert.equal(experienceAt(record({ rookie_year: 2021 }), 2021, 2025)!.value, 0);
  });

  test("`years_exp` is the fallback, and is derived from the current season", () => {
    const answer = experienceAt(
      record({ rookie_year: null, years_exp: 5 }),
      2023,
      2025,
    )!;
    assert.deepEqual(answer, { value: 3, basis: "years_exp" });
  });

  test("a derivation that lands outside a career is refused rather than clamped", () => {
    // Five years of experience cannot describe a season eight years ago.
    assert.equal(experienceAt(record({ rookie_year: null, years_exp: 5 }), 2017, 2025), null);
    // Nor can a rookie year after the season being described.
    assert.equal(experienceAt(record({ rookie_year: 2024, years_exp: null }), 2021, 2025), null);
  });

  test("a refused reading falls through to the other rather than failing the row", () => {
    // A rookie year that cannot describe this season is not a reason to drop
    // a player the second reading can answer for.
    const answer = experienceAt(record({ rookie_year: 2024, years_exp: 5 }), 2021, 2025)!;
    assert.deepEqual(answer, { value: 1, basis: "years_exp" });
  });

  test("junk in either field falls through to the other, then to null", () => {
    assert.equal(
      experienceAt(record({ rookie_year: 12, years_exp: 5 }), 2023, 2025)!.basis,
      "years_exp",
    );
    assert.equal(experienceAt(record({ rookie_year: null, years_exp: null }), 2023, 2025), null);
  });
});

describe("playerFactsAt", () => {
  test("resolves the three facts and names which experience reading answered", () => {
    const answer = playerFactsAt(record(), 2023, 2025, 42);
    assert.equal(answer.ok, true);
    if (!answer.ok) return;
    assert.deepEqual(answer.facts, { age: 24.3, exp: 2, draft: 42 });
    assert.equal(answer.basis, "rookie_year");
  });

  test("draft capital is carried through as handed in, and an unknown one does not skip the row", () => {
    // The one fact of the three the column may be silent on: the distance and
    // the page both have an honest reading of "unknown" for it.
    const udfa = playerFactsAt(record(), 2023, 2025, "udfa");
    assert.equal(udfa.ok && udfa.facts.draft, "udfa");
    const unknown = playerFactsAt(record(), 2023, 2025);
    assert.equal(unknown.ok, true);
    if (!unknown.ok) return;
    assert.equal(unknown.facts.draft, null);
  });

  test("a row with no birth date is skipped with a reason, never defaulted", () => {
    // An age of 0 is a claim, and the column is NOT NULL. The loader counts
    // this rather than writing something.
    const answer = playerFactsAt(record({ birth_date: null }), 2023, 2025);
    assert.equal(answer.ok, false);
    if (answer.ok) return;
    assert.match(answer.reason, /birth date/);
  });

  test("a row with no usable experience is skipped with its own reason", () => {
    // An experience of 0 says "rookie", which is a specific and checkable
    // falsehood about a nine-year veteran.
    const answer = playerFactsAt(
      record({ rookie_year: null, years_exp: null }),
      2023,
      2025,
    );
    assert.equal(answer.ok, false);
    if (answer.ok) return;
    assert.match(answer.reason, /rookie year|experience/);
  });
});

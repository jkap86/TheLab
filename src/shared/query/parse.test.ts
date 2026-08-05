import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  booleanFilter,
  booleanFlag,
  enumList,
  integer,
  isIsoDate,
  isSeason,
  isoDate,
  list,
} from "./parse.ts";

const params = (query: string) => new URLSearchParams(query);

describe("list", () => {
  it("accepts repeated params and comma lists alike, de-duplicated", () => {
    assert.deepEqual(list(params("k=a&k=b,c&k=b"), "k"), ["a", "b", "c"]);
  });

  it("drops empty tokens and whitespace", () => {
    assert.deepEqual(list(params("k=a,%20,b%20"), "k"), ["a", "b"]);
    assert.deepEqual(list(params(""), "k"), []);
  });
});

describe("enumList", () => {
  const ALLOWED = ["x", "y"] as const;

  it("returns the fallback when the key is absent", () => {
    assert.deepEqual(enumList(params(""), "k", ALLOWED, null), {
      ok: true,
      value: null,
    });
    assert.deepEqual(enumList(params(""), "k", ALLOWED, ["x"]), {
      ok: true,
      value: ["x"],
    });
  });

  it("rejects values outside the vocabulary, naming them", () => {
    const parsed = enumList(params("k=x,z"), "k", ALLOWED, null);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /z/);
  });

  it("passes a valid list through", () => {
    assert.deepEqual(enumList(params("k=y,x"), "k", ALLOWED, null), {
      ok: true,
      value: ["y", "x"],
    });
  });
});

describe("booleanFlag vs booleanFilter", () => {
  it("both read the usual spellings", () => {
    for (const raw of ["1", "true", "YES"]) {
      assert.deepEqual(booleanFlag(params(`k=${raw}`), "k"), { ok: true, value: true });
      assert.deepEqual(booleanFilter(params(`k=${raw}`), "k"), { ok: true, value: true });
    }
    for (const raw of ["0", "false", "no"]) {
      assert.deepEqual(booleanFlag(params(`k=${raw}`), "k"), { ok: true, value: false });
      assert.deepEqual(booleanFilter(params(`k=${raw}`), "k"), { ok: true, value: false });
    }
  });

  it("differ on absence — off for a flag, unfiltered for a filter", () => {
    // The distinction is the reason both exist: `?best_ball=false` narrows to
    // leagues without it, while omitting the key must narrow nothing.
    assert.deepEqual(booleanFlag(params(""), "k"), { ok: true, value: false });
    assert.deepEqual(booleanFilter(params(""), "k"), { ok: true, value: null });
  });

  it("both reject junk", () => {
    assert.equal(booleanFlag(params("k=maybe"), "k").ok, false);
    assert.equal(booleanFilter(params("k=maybe"), "k").ok, false);
  });
});

describe("integer", () => {
  it("returns the fallback when the key is absent", () => {
    assert.deepEqual(integer(params(""), "k", { min: 1, fallback: 7 }), {
      ok: true,
      value: 7,
    });
    assert.deepEqual(integer(params(""), "k", { min: 1, fallback: null }), {
      ok: true,
      value: null,
    });
  });

  it("enforces bounds and integrality", () => {
    assert.equal(integer(params("k=0"), "k", { min: 1, fallback: null }).ok, false);
    assert.equal(
      integer(params("k=11"), "k", { min: 1, max: 10, fallback: null }).ok,
      false,
    );
    assert.equal(integer(params("k=1.5"), "k", { min: 1, fallback: null }).ok, false);
    assert.equal(integer(params("k=abc"), "k", { min: 1, fallback: null }).ok, false);
  });

  it("passes a valid value through", () => {
    assert.deepEqual(integer(params("k=3"), "k", { min: 1, max: 10, fallback: null }), {
      ok: true,
      value: 3,
    });
  });
});

describe("isSeason", () => {
  it("accepts exactly a 4-digit year", () => {
    assert.equal(isSeason("2026"), true);
    assert.equal(isSeason("26"), false);
    assert.equal(isSeason("20266"), false);
    assert.equal(isSeason("all"), false);
    assert.equal(isSeason(""), false);
  });
});

describe("isIsoDate", () => {
  it("accepts a real calendar day", () => {
    assert.equal(isIsoDate("2026-06-01"), true);
    assert.equal(isIsoDate("2026-12-31"), true);
    assert.equal(isIsoDate("2024-02-29"), true);
  });

  it("rejects a day the shape allows and the calendar doesn't", () => {
    // The whole reason this isn't a regex: `2026-02-31` passes the shape check
    // *and* parses — V8 rolls the day forward to March 3 rather than failing, so
    // a bad bound would silently become a different, real date. Only a day that
    // survives the round trip is accepted.
    assert.equal(isIsoDate("2026-02-31"), false);
    assert.equal(isIsoDate("2026-04-31"), false);
    assert.equal(isIsoDate("2025-02-29"), false, "2025 is not a leap year");
    assert.equal(isIsoDate("2026-13-01"), false);
    assert.equal(isIsoDate("2026-00-10"), false);
    assert.equal(isIsoDate("2026-06-00"), false);
  });

  it("rejects anything that isn't the bare YYYY-MM-DD shape", () => {
    // A padded shape only, so the round trip above compares like with like:
    // `2026-6-1` parses fine and would format back as `2026-06-01`, which is a
    // different string from the one asked about.
    assert.equal(isIsoDate("2026-6-1"), false);
    assert.equal(isIsoDate("26-06-01"), false);
    assert.equal(isIsoDate("2026/06/01"), false);
    assert.equal(isIsoDate("2026-06-01T00:00:00Z"), false);
    assert.equal(isIsoDate("2026-06-01 "), false);
    assert.equal(isIsoDate("yesterday"), false);
    assert.equal(isIsoDate(""), false);
  });
});

describe("isoDate", () => {
  it("returns the string it was given, not a timestamp", () => {
    // What a bare date *means* is a zone question, and the caller that knows the
    // zone is SQL. Converting here would bake this process's zone into every
    // answer — an off-by-one day, in some deployments only.
    assert.deepEqual(isoDate(params("start_after=2026-06-01"), "start_after"), {
      ok: true,
      value: "2026-06-01",
    });
  });

  it("reads an absent or blank bound as an open end, not a default", () => {
    // A range is two independent halves, so null has to be expressible.
    assert.deepEqual(isoDate(params(""), "k"), { ok: true, value: null });
    assert.deepEqual(isoDate(params("k="), "k"), { ok: true, value: null });
    assert.deepEqual(isoDate(params("k=%20%20"), "k"), { ok: true, value: null });
  });

  it("trims before judging, so a padded date is still that date", () => {
    assert.deepEqual(isoDate(params("k=%202026-06-01%20"), "k"), {
      ok: true,
      value: "2026-06-01",
    });
  });

  it("fails the request on a date that isn't one, naming the key and the value", () => {
    for (const raw of ["2026-02-31", "2026-6-1", "junk"]) {
      const parsed = isoDate(params(`k=${raw}`), "k");
      assert.equal(parsed.ok, false, `${raw} should not parse`);
      if (!parsed.ok) {
        assert.match(parsed.error, /k/);
        assert.match(parsed.error, /YYYY-MM-DD/);
      }
    }
  });
});

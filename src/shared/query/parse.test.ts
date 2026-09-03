import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  booleanFilter,
  booleanFlag,
  integer,
  isSeason,
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

describe("booleanFlag vs booleanFilter", () => {
  it("both read the usual spellings", () => {
    for (const raw of ["1", "true", "YES"]) {
      assert.deepEqual(booleanFlag(params(`k=${raw}`), "k"), {
        ok: true,
        value: true,
      });
      assert.deepEqual(booleanFilter(params(`k=${raw}`), "k"), {
        ok: true,
        value: true,
      });
    }
    for (const raw of ["0", "false", "no"]) {
      assert.deepEqual(booleanFlag(params(`k=${raw}`), "k"), {
        ok: true,
        value: false,
      });
      assert.deepEqual(booleanFilter(params(`k=${raw}`), "k"), {
        ok: true,
        value: false,
      });
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
    assert.equal(
      integer(params("k=0"), "k", { min: 1, fallback: null }).ok,
      false,
    );
    assert.equal(
      integer(params("k=11"), "k", { min: 1, max: 10, fallback: null }).ok,
      false,
    );
    assert.equal(
      integer(params("k=1.5"), "k", { min: 1, fallback: null }).ok,
      false,
    );
    assert.equal(
      integer(params("k=abc"), "k", { min: 1, fallback: null }).ok,
      false,
    );
  });

  it("passes a valid value through", () => {
    assert.deepEqual(
      integer(params("k=3"), "k", { min: 1, max: 10, fallback: null }),
      { ok: true, value: 3 },
    );
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

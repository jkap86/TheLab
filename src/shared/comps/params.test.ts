import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_K } from "./criteria.ts";
import { compsQueryParams, parseCompsQuery } from "./params.ts";
import type { CompsRequest } from "./params.ts";

const parse = (query: string) => parseCompsQuery(new URLSearchParams(query));

/**
 * Every parameter is a narrowing of one question, and an unreadable one is a
 * 400 rather than its default — the reverse of the trades board's rule, argued
 * in the module. What is pinned here is the seam between the two spellings:
 * what the client writes, the route reads back as the same request.
 */
describe("parseCompsQuery", () => {
  test("an empty query is a pool count with no subject and no pairs", () => {
    const parsed = parse("");
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.request, {
      subject: null,
      from: null,
      to: null,
      k: DEFAULT_K,
      posLock: true,
      excludeOwn: true,
      pairs: [],
    });
  });

  test("a full request round-trips through the serialiser", () => {
    const request: CompsRequest = {
      subject: "4046",
      from: 2019,
      to: 2023,
      k: 12,
      posLock: false,
      excludeOwn: true,
      pairs: [
        { criterion: "ppg", window: "last", weight: 1.6 },
        { criterion: "ppg", window: "chigh", weight: 0.8 },
        { criterion: "recyd", window: "avg2", weight: 1 },
      ],
    };
    const parsed = parseCompsQuery(compsQueryParams(request));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.request, request);
  });

  test("the pair list is one parameter of triples, written to the rail's step", () => {
    const params = compsQueryParams({
      subject: null,
      from: null,
      to: null,
      k: 10,
      posLock: true,
      excludeOwn: true,
      pairs: [{ criterion: "age", window: "last", weight: 0.2 + 0.2 + 0.2 }],
    });
    assert.equal(params.get("c"), "age:last:0.6");
    assert.equal(params.has("subject"), false);
  });

  test("an unreadable value is refused rather than defaulted", () => {
    assert.equal(parse("from=abc").ok, false);
    assert.equal(parse("from=2024&to=2018").ok, false);
    assert.equal(parse("k=2").ok, false);
    assert.equal(parse("k=26").ok, false);
    assert.equal(parse("k=ten").ok, false);
    assert.equal(parse("pos=yes").ok, false);
    assert.equal(parse("c=ppg:last").ok, false);
    assert.equal(parse("c=ktc:last:1").ok, false);
    assert.equal(parse("c=ppg:yearly:1").ok, false);
    assert.equal(parse("c=ppg:last:9").ok, false);
    assert.equal(parse("c=ppg:last:0").ok, false);
    assert.equal(parse("c=ppg:last:1,ppg:last:2").ok, false);
  });
});

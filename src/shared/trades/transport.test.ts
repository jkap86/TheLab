import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseTradeQuery } from "./params.ts";
import { MAX_TRADE_BODY_BYTES, readTradeParams } from "./transport.ts";

const URL_BASE = "https://thelab.test/api/trades";

const get = (query: string) => new Request(`${URL_BASE}?${query}`);

const post = (query: string, body: string, type = "application/x-www-form-urlencoded") =>
  new Request(`${URL_BASE}?${query}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

/** The parameters, or a thrown assertion naming the status that came instead. */
async function params(request: Request): Promise<URLSearchParams> {
  const read = await readTradeParams(request);
  assert.ok(read.ok, `expected parameters, got ${read.ok ? "" : read.status}`);
  return read.params;
}

/**
 * The transport half of `/api/trades`. What every case here protects is that a
 * narrowing arrives **whole** or is refused visibly: a scope silently shortened
 * is a board showing trades the reader filtered out, with nothing on screen
 * saying so.
 */
describe("readTradeParams", () => {
  test("a GET is its own query string, untouched", async () => {
    const read = await params(get("season=2026&leagues=a,b"));
    assert.equal(read.get("season"), "2026");
    assert.deepEqual(parseTradeQuery(read, "2026").leagues, ["a", "b"]);
  });

  test("a POST body is folded into the line before anything reads it", async () => {
    // The whole point of the split: the parser downstream cannot tell which
    // half a parameter arrived on.
    const read = await params(post("season=2026&from=100", "xleagues=a,b,c"));
    const query = parseTradeQuery(read, "2026");
    assert.deepEqual(query.excludeLeagues, ["a", "b", "c"]);
    assert.equal(query.from, 100);
    assert.equal(read.get("season"), "2026");
  });

  test("a key on both wins in the body, rather than joining the line's", async () => {
    // `list()` reads repeated keys as one list, so folding them together would
    // widen a scope a stale line parameter had narrowed — a filter failing
    // open, which is the direction this board must never fail in.
    const read = await params(post("leagues=stale", "leagues=a,b"));
    assert.deepEqual(parseTradeQuery(read, "2026").leagues, ["a", "b"]);
  });

  test("a repeated body key stays a list, the way the line's does", async () => {
    const read = await params(post("", "leagues=a&leagues=b"));
    assert.deepEqual(parseTradeQuery(read, "2026").leagues, ["a", "b"]);
  });

  test("a body that is not form-encoded is refused, not read", async () => {
    // `new URLSearchParams('{"leagues":["a"]}')` parses happily into a key
    // nobody reads, so a JSON body would arrive as no narrowing at all.
    const read = await readTradeParams(
      post("season=2026", '{"leagues":["a"]}', "application/json"),
    );
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.status, 415);
  });

  test("a charset on the content type is still form-encoded", async () => {
    const read = await params(
      post("", "leagues=a", "application/x-www-form-urlencoded; charset=UTF-8"),
    );
    assert.deepEqual(parseTradeQuery(read, "2026").leagues, ["a"]);
  });

  test("a body past the cap is a 413 rather than a shortened scope", async () => {
    const ids = Array.from(
      { length: Math.ceil(MAX_TRADE_BODY_BYTES / 20) + 1 },
      (_, i) => `1392040478100${String(i).padStart(6, "0")}`,
    );
    const read = await readTradeParams(post("", `leagues=${ids.join(",")}`));
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.status, 413);
  });

  test("a scope the size of a real corpus goes through whole", async () => {
    // The case this module exists for: two thousand leagues is well inside the
    // cap and hopelessly past a request line.
    const ids = Array.from(
      { length: 2000 },
      (_, i) => `1392040478100${String(i).padStart(6, "0")}`,
    );
    const read = await params(post("season=2026", `xleagues=${ids.join(",")}`));
    assert.deepEqual(parseTradeQuery(read, "2026").excludeLeagues, ids);
  });

  test("a POST with no body at all narrows by the line alone", async () => {
    const request = new Request(`${URL_BASE}?season=2026&leagues=a`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const read = await params(request);
    assert.deepEqual(parseTradeQuery(read, "2026").leagues, ["a"]);
  });
});

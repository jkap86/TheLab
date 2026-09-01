import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { takeLines } from "./ndjson.ts";

/**
 * The half of the stream protocol that is silent when wrong.
 *
 * A chunk boundary falls wherever the network puts it, so the case that matters
 * is the one that looks like nothing: half an object at the end of a read. Parse
 * it and the stream dies on malformed JSON; drop it and a result vanishes.
 */
describe("takeLines", () => {
  it("returns whole lines and holds the partial one back", () => {
    const { lines, rest } = takeLines('{"a":1}\n{"b":2}\n{"c":');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
    assert.equal(rest, '{"c":');
  });

  it("a buffer ending on a newline leaves nothing held", () => {
    const { lines, rest } = takeLines('{"a":1}\n');
    assert.deepEqual(lines, ['{"a":1}']);
    assert.equal(rest, "");
  });

  it("a chunk with no newline yet is all remainder", () => {
    // The first read of a large result: nothing is parseable yet, and calling
    // it an empty line list rather than a failure is what lets the caller loop.
    const { lines, rest } = takeLines('{"type":"res');
    assert.deepEqual(lines, []);
    assert.equal(rest, '{"type":"res');
  });

  it("blank lines are dropped rather than parsed", () => {
    // `JSON.parse("")` throws, and a keep-alive newline is not a message.
    const { lines } = takeLines('{"a":1}\n\n  \n{"b":2}\n');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  });

  it("rejoining a held remainder reconstructs the split object", () => {
    // The property the reader loop depends on: two chunks that split one object
    // must yield that object exactly once.
    const first = takeLines('{"type":"progress"');
    const second = takeLines(first.rest + ',"loaded":1}\n');
    assert.deepEqual(first.lines, []);
    assert.deepEqual(second.lines, ['{"type":"progress","loaded":1}']);
    assert.equal(second.rest, "");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { takeLines } from "./ndjson.ts";

/**
 * The leagues stream's framing, shared by the two hooks that read it.
 *
 * A chunk boundary falls wherever the network puts it, so the property that
 * matters is that a message split across two chunks is delivered once and whole
 * — never twice, never truncated. That is what the `rest` is for, and it is the
 * half a "simplification" to `split("\n")` would drop.
 */

describe("takeLines", () => {
  test("hands back whole lines and holds the unterminated tail", () => {
    assert.deepEqual(takeLines('{"a":1}\n{"b":2}\n{"c":'), {
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c":',
    });
  });

  test("a buffer ending on a newline leaves nothing behind", () => {
    assert.deepEqual(takeLines('{"a":1}\n'), { lines: ['{"a":1}'], rest: "" });
  });

  test("a buffer with no newline yet is all tail, no lines", () => {
    // The first chunk of a large message: nothing is parseable, and returning it
    // as a line would hand the caller half a JSON object.
    assert.deepEqual(takeLines('{"partial"'), { lines: [], rest: '{"partial"' });
  });

  test("an empty buffer yields nothing at all", () => {
    assert.deepEqual(takeLines(""), { lines: [], rest: "" });
  });

  test("blank lines and whitespace are dropped rather than parsed", () => {
    // A keepalive newline or a trailing blank is framing, not a message —
    // `JSON.parse("")` would throw and kill the stream.
    assert.deepEqual(takeLines('\n\n{"a":1}\n  \n'), { lines: ['{"a":1}'], rest: "" });
  });

  test("a CRLF stream loses its carriage return with the trim", () => {
    // Not a framing this app writes, but a proxy can normalise line endings, and
    // a trailing \r makes every message a parse error.
    assert.deepEqual(takeLines('{"a":1}\r\n{"b":2}\r\n'), {
      lines: ['{"a":1}', '{"b":2}'],
      rest: "",
    });
  });

  test("every chunk boundary reconstructs the same messages, exactly once", () => {
    // The property the module exists for, checked at every possible split rather
    // than at one chosen one: whatever the network does to a payload, the reader
    // sees each message once and whole.
    const messages = ['{"type":"cached"}', '{"type":"progress","done":3}', '{"type":"result"}'];
    const payload = messages.map((m) => `${m}\n`).join("");

    for (let cut = 0; cut <= payload.length; cut++) {
      const seen: string[] = [];
      let buffer = "";
      for (const chunk of [payload.slice(0, cut), payload.slice(cut)]) {
        buffer += chunk;
        const { lines, rest } = takeLines(buffer);
        seen.push(...lines);
        buffer = rest;
      }
      assert.deepEqual(seen, messages, `split at ${cut}`);
      assert.equal(buffer, "", `split at ${cut} left a tail behind`);
    }
  });

  test("a stream that ends mid-message leaves it in the buffer, undelivered", () => {
    // The caller's own business what to do with it — but it must not arrive as a
    // message, which is the difference between an incomplete refresh and a
    // parse error thrown at the reader.
    const { lines, rest } = takeLines('{"type":"cached"}\n{"type":"prog');
    assert.deepEqual(lines, ['{"type":"cached"}']);
    assert.equal(rest, '{"type":"prog');
  });
});

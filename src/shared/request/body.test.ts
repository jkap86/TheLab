import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { declaredLength, isJsonRequest, readBodyWithin, readJsonWithin } from "./body.ts";

/**
 * A request whose body arrives as scripted chunks, counting how many were
 * pulled — which is the observation the whole module exists for: a bound
 * enforced while reading pulls fewer chunks than the body has.
 */
function streamed(
  chunks: (Uint8Array | string)[],
  headers: Record<string, string> = {},
  options: { failAfter?: number } = {},
) {
  let pulled = 0;
  let cancelled = false;
  const encoder = new TextEncoder();
  // A zero high-water mark, so `pull` runs only when the reader reads: the
  // default of one would pre-pull a chunk at construction and the count below
  // would be the stream's own rather than the reader's.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfter !== undefined && pulled >= options.failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      if (pulled >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[pulled];
      pulled += 1;
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
    cancel() {
      cancelled = true;
    },
  }, new CountQueuingStrategy({ highWaterMark: 0 }));
  const request = new Request("http://app.test/api/logs/visit", {
    method: "POST",
    body,
    // Required by undici for a streaming request body.
    duplex: "half",
    headers: { "content-type": "application/json", ...headers },
  } as RequestInit);
  return { request, pulled: () => pulled, cancelled: () => cancelled };
}

describe("readBodyWithin", () => {
  test("a declared length past the bound is refused before a byte is read", async () => {
    const { request, pulled } = streamed(["x".repeat(100)], { "content-length": "1048576" });
    const read = await readBodyWithin(request, 512);
    assert.deepEqual(read, { ok: false, reason: "too-large" });
    assert.equal(pulled(), 0, "nothing was pulled from the body");
  });

  test("an oversized chunked body with no declared length is stopped early", async () => {
    // 64 chunks of 1 KiB against a 512-byte bound: the first chunk crosses it.
    const chunks = Array.from({ length: 64 }, () => new Uint8Array(1024));
    const { request, pulled, cancelled } = streamed(chunks);
    const read = await readBodyWithin(request, 512);
    assert.deepEqual(read, { ok: false, reason: "too-large" });
    assert.equal(pulled(), 1, "stopped at the first chunk over the bound");
    assert.equal(cancelled(), true, "the rest of the body was cancelled, not drained");
  });

  test("a body that exceeds its own declared length is still bounded", async () => {
    // Claims 10 bytes, sends 2 KiB in small chunks.
    const chunks = Array.from({ length: 32 }, () => "y".repeat(64));
    const { request, pulled } = streamed(chunks, { "content-length": "10" });
    const read = await readBodyWithin(request, 512);
    assert.deepEqual(read, { ok: false, reason: "too-large" });
    assert.ok(pulled() <= 9, `pulled ${pulled()} chunks; should have stopped at the 9th`);
  });

  test("the bound is bytes, not characters", async () => {
    // Four characters, twelve bytes.
    const { request } = streamed(["日本語字"]);
    assert.deepEqual(await readBodyWithin(request, 11), { ok: false, reason: "too-large" });
    const again = streamed(["日本語字"]);
    const read = await readBodyWithin(again.request, 12);
    assert.deepEqual(read, { ok: true, text: "日本語字", bytes: 12 });
  });

  test("a boundary-sized body is read whole", async () => {
    const text = JSON.stringify({ route: "/manager/jkap86" });
    const { request } = streamed([text.slice(0, 5), text.slice(5)], {
      "content-length": String(text.length),
    });
    const read = await readBodyWithin(request, text.length);
    assert.deepEqual(read, { ok: true, text, bytes: text.length });
  });

  test("a body that is not UTF-8 is refused rather than decoded lossily", async () => {
    const { request } = streamed([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]);
    assert.deepEqual(await readBodyWithin(request, 512), { ok: false, reason: "encoding" });
  });

  test("an interrupted stream is a clean refusal", async () => {
    const { request } = streamed(['{"route":"/to', 'ols"}'], {}, { failAfter: 1 });
    assert.deepEqual(await readBodyWithin(request, 512), { ok: false, reason: "interrupted" });
  });

  test("no body at all is empty text", async () => {
    const request = new Request("http://app.test/x", { method: "POST" });
    assert.deepEqual(await readBodyWithin(request, 512), { ok: true, text: "", bytes: 0 });
  });

  test("an unparseable content-length is read as absent, and the bytes decide", async () => {
    assert.equal(declaredLength(new Headers({ "content-length": "abc" })), null);
    assert.equal(declaredLength(new Headers({ "content-length": "42" })), 42);
    assert.equal(declaredLength(new Headers({})), null);
    const { request } = streamed(["z".repeat(600)], { "content-length": "abc" });
    assert.deepEqual(await readBodyWithin(request, 512), { ok: false, reason: "too-large" });
  });
});

describe("readJsonWithin", () => {
  test("parses only inside the bound", async () => {
    const { request } = streamed(['{"route":"/tools"}']);
    const read = await readJsonWithin(request, 512);
    assert.deepEqual(read, { ok: true, value: { route: "/tools" }, bytes: 18 });
  });

  test("malformed JSON fails cleanly", async () => {
    const { request } = streamed(['{"route":']);
    assert.deepEqual(await readJsonWithin(request, 512), { ok: false, reason: "malformed" });
  });

  test("an empty body is its own refusal", async () => {
    const { request } = streamed([]);
    assert.deepEqual(await readJsonWithin(request, 512), { ok: false, reason: "empty" });
  });

  test("an oversized body never reaches the parser", async () => {
    // Valid JSON, too much of it.
    const { request, pulled } = streamed([`{"route":"${"/a".repeat(2000)}"}`]);
    assert.deepEqual(await readJsonWithin(request, 512), { ok: false, reason: "too-large" });
    assert.equal(pulled(), 1);
  });

  test("isJsonRequest reads the content type with or without parameters", () => {
    assert.equal(isJsonRequest(new Headers({ "content-type": "application/json" })), true);
    assert.equal(
      isJsonRequest(new Headers({ "content-type": "application/json; charset=utf-8" })),
      true,
    );
    assert.equal(isJsonRequest(new Headers({ "content-type": "text/plain" })), false);
    assert.equal(isJsonRequest(new Headers({})), false);
  });
});

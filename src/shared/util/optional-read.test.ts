import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readOptional } from "./optional-read.ts";

/**
 * The one bit of information the `.catch(() => <empty>)` this replaces threw
 * away: **which of the two happened.**
 *
 * Every failure it guards is deliberately non-fatal — the answer around the
 * failed section is still worth sending — so what these assert is not that a
 * failure propagates but that it is *reported* alongside a partial answer, and
 * that a legitimately empty success is not mistaken for one.
 */

/** Silence the deliberate `console.error` these tests provoke. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

describe("an optional read that answers", () => {
  test("hands back the value under an ok status", async () => {
    const result = await readOptional("[test] board", async () => ({ ktc: 42 }));
    assert.equal(result.status, "ok");
    assert.deepEqual(result.value, { ktc: 42 });
  });

  test("reports ok for an empty answer, which is the whole point", async () => {
    // The distinction this module exists to restore: an empty map from a read
    // that ran is a real "nothing here", and must stay as expressible as it was
    // before failures started being reported.
    const result = await readOptional("[test] board", async () => new Map());
    assert.equal(result.status, "ok");
    assert.equal((result.value as Map<string, number>).size, 0);
  });
});

describe("an optional read that throws", () => {
  test("reports an error rather than an empty answer", async () => {
    const result = await quietly(() =>
      readOptional("[test] board", async () => {
        throw new Error("pool timeout");
      }),
    );

    assert.equal(result.status, "error");
    assert.equal(result.value, null);
    assert.equal((result.error as Error).message, "pool timeout");
  });

  test("catches a synchronous throw as readily as a rejection", async () => {
    // The reader is invoked inside the `try`, so a loader that throws while
    // building its arguments degrades exactly as one that rejects — the same
    // rule `TtlPromiseCache` keeps for its own compute.
    const result = await quietly(() =>
      readOptional("[test] board", () => {
        throw new Error("bad filters");
      }),
    );

    assert.equal(result.status, "error");
    assert.equal(result.value, null);
  });

  test("logs under the caller's own prefix", async () => {
    // The caller is the only thing that knows whose read it was, which is why
    // the label is an argument rather than something this module invents.
    const lines: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => lines.push(args);
    try {
      await readOptional("[ktc] lineups for alice", async () => {
        throw new Error("boom");
      });
    } finally {
      console.error = original;
    }

    assert.equal(lines.length, 1);
    assert.equal(lines[0][0], "[ktc] lineups for alice failed:");
    assert.equal(lines[0][1], "boom");
  });

  test("never rejects — a failure is a value, not a throw", async () => {
    // A caller inside a `Promise.all` relies on this: the join must not become
    // fail-fast because one optional read fell over.
    const [a, b] = await quietly(() =>
      Promise.all([
        readOptional("[test] a", async () => {
          throw new Error("down");
        }),
        readOptional("[test] b", async () => "fine"),
      ]),
    );

    assert.equal(a.status, "error");
    assert.equal(b.status, "ok");
    assert.equal(b.value, "fine");
  });
});

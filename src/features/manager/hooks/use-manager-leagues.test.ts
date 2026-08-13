import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeaguesData } from "../../shared/leagues-stream.ts";
import { createTestQueryClient } from "../../shared/query-test-support.ts";
import { revalidateLeagues } from "./use-manager-leagues.ts";

/**
 * The one thing about `revalidate` that no type carries: a re-read that fails
 * has to fail *into the query state* and nowhere else.
 *
 * It returns void, so the promise `fetchQuery` hands back is dropped — and a
 * bare `void` in front of it silences the compiler about the value while saying
 * nothing about the rejection. Node's default for an unhandled rejection is to
 * terminate the process; in a browser it is a console error nobody asked for and
 * a hit on any error reporter wired to `unhandledrejection`. Either way it is
 * silent right up until a reload control is wired to this helper and the network
 * is down, which is the state it was in when this was written.
 *
 * The hook itself cannot be driven here — that needs a renderer this repo
 * deliberately does not carry — which is why the two lines that make the
 * decision are their own exported function. What is asserted is exactly those:
 * the rejection escapes nowhere, and the failure is still on the entry.
 */

/** Catch what the process would otherwise die on, for the length of one test. */
async function withRejectionWatch<T>(
  body: () => Promise<T>,
): Promise<{ result: T; unhandled: unknown[] }> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  // Every existing listener has to come off, or Node's own default handler (and
  // the test runner's) still sees the rejection and fails the run before the
  // assertion below can report it.
  const previous = process.listeners("unhandledRejection");
  for (const listener of previous) process.off("unhandledRejection", listener);
  process.on("unhandledRejection", onUnhandled);

  try {
    const result = await body();
    // A rejection is reported a macrotask after it is left unhandled, so the
    // watch has to outlive the microtask queue or it can only ever see nothing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { result, unhandled };
  } finally {
    process.off("unhandledRejection", onUnhandled);
    for (const listener of previous) {
      process.on("unhandledRejection", listener as (reason: unknown) => void);
    }
  }
}

const KEY = ["manager", "jkap", "leagues"] as const;

describe("revalidateLeagues", () => {
  test("a failed re-read is swallowed rather than left unhandled", async () => {
    const client = createTestQueryClient();

    const { unhandled } = await withRejectionWatch(async () => {
      revalidateLeagues(client, KEY, async () => {
        throw new Error("stream died");
      });
      // Settle the fetch and everything chained onto it.
      await client.getQueryCache().find({ queryKey: KEY })?.promise?.catch(() => {});
    });

    assert.deepEqual(
      unhandled,
      [],
      "a rejected re-read must not escape as an unhandled rejection",
    );
  });

  test("and the failure is still reported through the query state", async () => {
    const client = createTestQueryClient();

    await withRejectionWatch(async () => {
      revalidateLeagues(client, KEY, async () => {
        throw new Error("stream died");
      });
      await client.getQueryCache().find({ queryKey: KEY })?.promise?.catch(() => {});
    });

    // Swallowing the rejection must not swallow the *report*: the entry the hook
    // reads is where a reader is told, which is the whole reason the `catch`
    // above is allowed to be empty and must not start logging.
    const state = client.getQueryState(KEY);
    assert.equal(state?.status, "error");
    assert.match(String(state?.error), /stream died/);
  });

  test("a successful re-read writes the stream's last state to the entry", async () => {
    const client = createTestQueryClient();
    const data = { revision: "r2", refreshing: false } as unknown as ManagerLeaguesData;

    revalidateLeagues(client, KEY, async () => data);
    await client.getQueryCache().find({ queryKey: KEY })?.promise;

    assert.equal(client.getQueryState(KEY)?.status, "success");
    assert.deepEqual(client.getQueryData(KEY), data);
  });

  test("it re-reads past the entry's stale time", async () => {
    const client = createTestQueryClient();
    let reads = 0;
    const run = async () => {
      reads += 1;
      return { revision: `r${reads}` } as unknown as ManagerLeaguesData;
    };

    // Seeded as a fresh entry the hook's own `staleTime` would decline to
    // refetch. `revalidate` exists precisely to go past that, so `staleTime: 0`
    // in the helper is load-bearing rather than incidental.
    await client.fetchQuery({ queryKey: KEY, queryFn: run, staleTime: 600_000 });
    assert.equal(reads, 1);

    revalidateLeagues(client, KEY, run);
    await client.getQueryCache().find({ queryKey: KEY })?.promise;

    assert.equal(reads, 2, "the re-read ran despite the entry being fresh");
    assert.deepEqual(client.getQueryData(KEY), { revision: "r2" });
  });
});

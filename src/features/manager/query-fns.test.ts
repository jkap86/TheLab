import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchManagerLeagues,
  leaguesRevision,
  refreshSeqOf,
  type ManagerLeaguesData,
} from "./query-fns.ts";
import { installFetchMock, ndjsonResponse } from "./query-test-support.ts";
import type { ManagerLeague } from "./types";

const league = (id: string, wins = 1): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins, losses: 0, ties: 0 },
  settings: null,
  roster_positions: null,
  scoring_settings: null,
});

const user = { user_id: "u1", username: "alice", display_name: "Alice", avatar: null };

const result = (leagues: ManagerLeague[], extra: Record<string, unknown> = {}) => ({
  type: "result",
  user,
  season: "2026",
  leagues,
  stale: false,
  refreshing: false,
  ...extra,
});

test("fetchManagerLeagues", async (t) => {
  await t.test("publishes the cached payload before the refreshed one", async () => {
    // The whole reason the stream is worth keeping: the cached leagues are on
    // screen while the refresh runs, not after it.
    const mock = installFetchMock(() =>
      ndjsonResponse([
        result([league("a")], { stale: true, refreshing: true }),
        { type: "progress", phase: "refresh", loaded: 1, total: 2, failed: 0 },
        result([league("a"), league("b")], { summary: { leagues: 2, failed: 0, skipped: false } }),
      ]),
    );
    const published: ManagerLeaguesData[] = [];

    const final = await fetchManagerLeagues({
      searched: "alice",
      publish: (data) => published.push(data),
    });
    mock.restore();

    const first = published[0];
    assert.equal(first.result?.leagues.length, 1);
    assert.equal(first.refreshing, true);
    // A later payload replaces it, and the query resolves with that one.
    assert.equal(final.result?.leagues.length, 2);
    assert.equal(final.refreshing, false);
    assert.equal(final.progress, null);
    assert.deepEqual(published.at(-1), final);
    assert.ok(published.some((state) => state.progress?.loaded === 1));
  });

  await t.test("a cold sync publishes progress before any payload", async () => {
    const mock = installFetchMock(() =>
      ndjsonResponse([
        { type: "progress", phase: "initial", loaded: 3, total: 9, failed: 0 },
        result([league("a")]),
      ]),
    );
    const published: ManagerLeaguesData[] = [];

    await fetchManagerLeagues({ searched: "alice", publish: (d) => published.push(d) });
    mock.restore();

    // No cache to send first, so the loading screen counts up against a state
    // that carries progress and no result — which is why `result` is nullable.
    assert.equal(published[0].result, null);
    assert.equal(published[0].progress?.total, 9);
  });

  await t.test("a refresh that fails keeps the payload already sent", async () => {
    const mock = installFetchMock(() =>
      ndjsonResponse([
        result([league("a")], { stale: true, refreshing: true }),
        { type: "error", error: "Failed to sync leagues" },
      ]),
    );

    const final = await fetchManagerLeagues({ searched: "alice" });
    mock.restore();

    assert.equal(final.result?.leagues.length, 1);
    assert.equal(final.refreshError, "Failed to sync leagues");
    assert.equal(final.refreshing, false);
  });

  await t.test("a stream that dies mid-refresh keeps the payload too", async () => {
    const mock = installFetchMock(() =>
      ndjsonResponse([result([league("a")], { stale: true, refreshing: true })], {
        fail: true,
      }),
    );

    const final = await fetchManagerLeagues({ searched: "alice" });
    mock.restore();

    assert.equal(final.result?.leagues.length, 1);
    assert.ok(final.refreshError);
    // Only a message clears this, so without the backstop the header would
    // spin "Refreshing…" forever.
    assert.equal(final.refreshing, false);
  });

  await t.test("a failure with nothing to show is the query's own error", async () => {
    const mock = installFetchMock(() =>
      ndjsonResponse([{ type: "error", error: "Failed to sync leagues" }]),
    );

    await assert.rejects(
      () => fetchManagerLeagues({ searched: "alice" }),
      /Failed to sync leagues/,
    );
    mock.restore();
  });

  await t.test("a forced refresh is a parameter, not a cache-buster", async () => {
    const mock = installFetchMock(() => ndjsonResponse([result([league("a")])]));
    await fetchManagerLeagues({ searched: "alice", refresh: true });
    mock.restore();

    assert.equal(mock.calls[0], "/api/user/alice/leagues?refresh=1");
  });
});

/**
 * A stream that delivers `messages` and then waits, erroring with the
 * `AbortError` a real `fetch` errors a body with when the request's own signal
 * fires. `fail` errors it with an ordinary failure instead, which is the case
 * the abort must stay distinguishable from.
 */
function abortableResponse(
  messages: readonly unknown[],
  signal: AbortSignal | null | undefined,
  fail?: Error,
): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent < messages.length) {
        controller.enqueue(encoder.encode(JSON.stringify(messages[sent++]) + "\n"));
        return;
      }
      if (fail) throw fail;
      // Rejecting from `pull` errors the stream, so the read pending on the
      // other side rejects with this — exactly what an aborted body does.
      await new Promise<never>((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

/** Run `body` with every unhandled rejection it provokes collected. */
async function withUnhandledRejections<T>(
  body: () => Promise<T>,
): Promise<{ value: T; unhandled: unknown[] }> {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    const value = await body();
    // Unhandled rejections are reported a turn later, so give them one.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { value, unhandled };
  } finally {
    process.off("unhandledRejection", listener);
  }
}

/**
 * What an aborted refresh costs, which is nothing.
 *
 * An unmount, a navigation and React Query cancelling a query all abort the
 * request in flight, and the body rejects with an `AbortError`. That used to
 * land in `refreshError` — a message the header shows and the cache keeps — so a
 * reader who walked away mid-refresh came back to "the operation was aborted"
 * written over leagues that had synced perfectly well. It is teardown, not a
 * failure, and the difference is `isAbortError` in `features/shared/api`.
 */
test("a cancelled leagues stream", async (t) => {
  await t.test("keeps the cached payload and reports no failure", async () => {
    const controller = new AbortController();
    const mock = installFetchMock((_url, _call, init) =>
      abortableResponse(
        [result([league("a")], { stale: true, refreshing: true })],
        init?.signal,
      ),
    );

    const { value: final, unhandled } = await withUnhandledRejections(async () => {
      const pending = fetchManagerLeagues({
        searched: "alice",
        signal: controller.signal,
      });
      // The cached payload is through; the refresh half is what gets cut off.
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      return pending;
    });
    mock.restore();

    assert.equal(final.result?.leagues.length, 1, "the cached leagues survive");
    assert.equal(final.refreshError, null, "and nothing claims a refresh failed");
    // Only a message clears these and no further message is coming, so without
    // the backstop a remount inside the stale window would spin forever.
    assert.equal(final.refreshing, false);
    assert.equal(final.progress, null);
    assert.deepEqual(unhandled, [], "and the cancelled body rejects nowhere");
  });

  await t.test("does not overwrite an error an earlier message reported", async () => {
    // A refresh that genuinely failed, and *then* the reader navigated away.
    // The abort must neither add a message nor clear the real one.
    const controller = new AbortController();
    const mock = installFetchMock((_url, _call, init) =>
      abortableResponse(
        [
          result([league("a")], { stale: true, refreshing: true }),
          { type: "error", error: "Failed to sync leagues" },
        ],
        init?.signal,
      ),
    );

    const pending = fetchManagerLeagues({ searched: "alice", signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const final = await pending;
    mock.restore();

    assert.equal(final.refreshError, "Failed to sync leagues");
  });

  await t.test("with nothing to show, comes out as the abort itself", async () => {
    // No payload arrived, so there is nothing to hand back — and inventing one
    // would file it under an entry React Query has just cancelled. The abort
    // goes out as-is, which is what says *cancelled* rather than failed.
    const controller = new AbortController();
    const mock = installFetchMock((_url, _call, init) =>
      abortableResponse([], init?.signal),
    );

    const pending = fetchManagerLeagues({ searched: "alice", signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, (error: Error) => {
      assert.equal(error.name, "AbortError");
      return true;
    });
    mock.restore();
  });

  await t.test("publishes no state carrying an abort", async () => {
    // The published states are what the cache holds, so this is the assertion
    // the reported bug is actually about: nothing written to the entry mentions
    // a refresh that was merely cancelled.
    const controller = new AbortController();
    const mock = installFetchMock((_url, _call, init) =>
      abortableResponse(
        [result([league("a")], { stale: true, refreshing: true })],
        init?.signal,
      ),
    );
    const published: ManagerLeaguesData[] = [];

    const pending = fetchManagerLeagues({
      searched: "alice",
      signal: controller.signal,
      publish: (data) => published.push(data),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await pending;
    mock.restore();

    assert.ok(published.length > 0);
    for (const state of published) assert.equal(state.refreshError, null);
    assert.equal(published.at(-1)?.result?.leagues.length, 1);
  });

  await t.test("a real mid-refresh failure is still reported", async () => {
    // The other half of the branch, in the same shape: only an `AbortError` is
    // teardown, and everything else still costs the refresh.
    const mock = installFetchMock((_url, _call, init) =>
      abortableResponse(
        [result([league("a")], { stale: true, refreshing: true })],
        init?.signal,
        new Error("stream died"),
      ),
    );

    const final = await fetchManagerLeagues({ searched: "alice" });
    mock.restore();

    assert.equal(final.result?.leagues.length, 1);
    assert.equal(final.refreshError, "stream died");
    assert.equal(final.refreshing, false);
  });
});

test("leaguesRevision", async (t) => {
  await t.test("the same leagues in a new array are the same revision", () => {
    // The identity of the array is what the old hooks refetched on; the content
    // is what actually decides whether a dependent read is behind.
    const before = leaguesRevision([league("a"), league("b")], "2026", 0);
    const after = leaguesRevision([league("b"), league("a")], "2026", 0);
    assert.equal(before, after);
  });

  await t.test("a league joined, left or won is a new revision", () => {
    const base = leaguesRevision([league("a")], "2026", 0);
    assert.notEqual(base, leaguesRevision([league("a"), league("b")], "2026", 0));
    assert.notEqual(base, leaguesRevision([league("a", 2)], "2026", 0));
    assert.notEqual(base, leaguesRevision([league("a")], "2025", 0));
  });

  await t.test("a completed refresh is a new revision on its own", () => {
    // Rosters aren't on this payload at all, so a sync that persisted a waiver
    // claim leaves every field here identical while making the dependent reads
    // stale — the sequence is what covers that.
    assert.notEqual(
      leaguesRevision([league("a")], "2026", 0),
      leaguesRevision([league("a")], "2026", 1),
    );
  });

  await t.test("the sequence survives a re-run of the query", () => {
    const revision = leaguesRevision([league("a")], "2026", 3);
    assert.equal(refreshSeqOf(revision), 3);
    assert.equal(refreshSeqOf(undefined), 0);
    assert.equal(refreshSeqOf(""), 0);
  });

  await t.test("a refresh over the stream bumps it exactly once", async () => {
    const mock = installFetchMock(() =>
      ndjsonResponse([
        result([league("a")], { stale: true, refreshing: true }),
        result([league("a")], { summary: { leagues: 1, failed: 0, skipped: false } }),
      ]),
    );

    const final = await fetchManagerLeagues({
      searched: "alice",
      previousRevision: leaguesRevision([league("a")], "2026", 2),
    });
    mock.restore();

    assert.equal(refreshSeqOf(final.revision), 3);
  });

  await t.test("a sync that lost the lock does not count as a refresh", async () => {
    // `locked` means another caller holds this manager's lock and is still
    // writing: nothing landed that this stream saw, and the leagues below are
    // whatever that one has committed so far. Counting it would invalidate all
    // five dependent reads against a list still being filled in, on every
    // request that loses the race.
    const mock = installFetchMock(() =>
      ndjsonResponse([
        result([league("a")], {
          stale: true,
          summary: { leagues: 0, failed: 0, skipped: true, locked: true },
        }),
      ]),
    );

    const final = await fetchManagerLeagues({
      searched: "alice",
      previousRevision: leaguesRevision([league("a")], "2026", 2),
    });
    mock.restore();

    assert.equal(refreshSeqOf(final.revision), 2, "the sequence stands still");
    assert.equal(
      final.revision,
      leaguesRevision([league("a")], "2026", 2),
      "so dependent reads are not invalidated",
    );
  });
});

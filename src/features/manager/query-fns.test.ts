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
});

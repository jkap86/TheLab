import assert from "node:assert/strict";
import test from "node:test";

import { QueryObserver, type QueryClient } from "@tanstack/react-query";

import { MANAGER_STALE_TIMES } from "./manager-query.ts";
import type { ManagerLeaguesData } from "./leagues-stream.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  ndjsonResponse,
} from "./query-test-support.ts";
import { userLeaguesQuery } from "./use-user-leagues.ts";

/**
 * What the account's leagues cost across a navigation, without a renderer.
 *
 * This read is the app's most expensive — a manager sync behind a blocking
 * advisory lock, ~11 Sleeper requests a league on a cold account — and until
 * this hook became a query it was held in `useState`, so *every mount* paid for
 * it again. The two tools that read it are separate routes and one of them is
 * reached from the other, so remounting is the ordinary way they are used rather
 * than an edge case.
 *
 * Driving `QueryObserver` directly is what lets these assertions be about
 * request *counts*, which is the thing the change was for. A page mounting is an
 * observer subscribing; navigating away is it unsubscribing.
 */

/** A canonical Sleeper id, which is what these two pages hold. */
const USER_ID = "12345678901234567";

const league = (id: string) => ({
  league_id: id,
  name: `League ${id}`,
  status: "in_season",
  season: "2026",
  record: null,
});

/** The stream's happy path: one cached `result`, then the stream closes. */
const resultMessage = (leagues: string[]) => ({
  type: "result",
  leagues: leagues.map(league),
  season: "2026",
  refreshing: false,
  user: { user_id: USER_ID, username: "alice" },
});

/** Mount a consumer of the query — the pick tracker's picker, or the checker. */
function mount(client: QueryClient, userId: string | null) {
  const observer = new QueryObserver<ManagerLeaguesData, Error>(
    client,
    userLeaguesQuery(userId, client) as never,
  );
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unmount: unsubscribe };
}

const leaguesOf = (observer: QueryObserver<ManagerLeaguesData, Error>) =>
  observer.getCurrentResult().data?.result?.leagues ?? null;

test("the account's leagues across a navigation", async (t) => {
  await t.test("are not re-streamed while they are fresh", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock(() => ndjsonResponse([resultMessage(["a", "b"])]));

    // /lineupchecker → /tools → /lineupchecker: the middle page reads nothing,
    // so the query is unmounted throughout and remounted at the end.
    const first = mount(client, USER_ID);
    await flush();
    first.unmount();
    await flush();
    const back = mount(client, USER_ID);
    await flush();

    assert.equal(mock.countOf("/leagues"), 1);
    // And the page renders the cached list rather than a loading screen.
    assert.equal(leaguesOf(back.observer)?.length, 2);
    back.unmount();
    mock.restore();
  });

  await t.test("are one request for two tools open at once", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock(() => ndjsonResponse([resultMessage(["a"])]));

    // The pick tracker's picker and the lineup checker's list name the same key,
    // so concurrent readers collapse to one in-flight stream.
    const picker = mount(client, USER_ID);
    const checker = mount(client, USER_ID);
    await flush();

    assert.equal(mock.countOf("/leagues"), 1);
    assert.equal(leaguesOf(picker.observer)?.length, 1);
    assert.equal(leaguesOf(checker.observer)?.length, 1);
    picker.unmount();
    checker.unmount();
    mock.restore();
  });

  await t.test("fill from the first result, before the stream ends", async () => {
    const client = createTestQueryClient();
    // A cached payload, then a refreshed one — the stale-while-revalidate shape
    // this route answers in. The list must fill at the *first*, which is the
    // promise this hook keeps and what `isPending` would get wrong.
    //
    // The stream is held open between the two rather than timed, since the
    // claim is about ordering: what is asserted is that the published state
    // reaches a reader while the query is still pending, and a race against a
    // `setTimeout` would pass for the wrong reason on a slow machine.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = installFetchMock(() => {
      const encoder = new TextEncoder();
      let sent = 0;
      const messages = [
        { ...resultMessage(["a"]), refreshing: true },
        { ...resultMessage(["a", "b"]), summary: { locked: false } },
      ];
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (sent === 1) await held;
            if (sent < messages.length) {
              controller.enqueue(
                encoder.encode(JSON.stringify(messages[sent++]) + "\n"),
              );
              return;
            }
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
      );
    });

    const page = mount(client, USER_ID);
    await flush();
    assert.equal(leaguesOf(page.observer)?.length, 1, "the cached payload shows");
    assert.equal(
      page.observer.getCurrentResult().isFetching,
      true,
      "and it shows while the stream is still open",
    );

    release();
    await flush();
    assert.equal(leaguesOf(page.observer)?.length, 2, "the refresh replaces it");
    assert.equal(mock.countOf("/leagues"), 1);
    page.unmount();
    mock.restore();
  });

  await t.test("are never asked for without an account", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock(() => ndjsonResponse([resultMessage(["a"])]));

    // The pick tracker's whole no-account path: the id form still works, and
    // nothing is fetched for a reader who has resolved nobody.
    const page = mount(client, null);
    await flush();

    assert.equal(mock.countOf("/leagues"), 0);
    assert.equal(leaguesOf(page.observer), null);
    page.unmount();
    mock.restore();
  });

  await t.test("are a different entry per account", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) =>
      ndjsonResponse([resultMessage(url.includes("999") ? ["z"] : ["a", "b"])]),
    );

    const first = mount(client, USER_ID);
    await flush();
    first.unmount();
    const second = mount(client, "999");
    await flush();

    assert.equal(mock.countOf("/leagues"), 2);
    // No `keepPreviousData` here: a new account must not show the last one's
    // leagues under its name, the rule `useLeagueDetail` keeps for a league.
    assert.equal(leaguesOf(second.observer)?.length, 1);
    second.unmount();
    mock.restore();
  });

  await t.test("reuse the manager area's own freshness window", () => {
    // Not a number of its own: this is the same route the manager tool reads,
    // and two stale times for one answer is how the two tools start disagreeing
    // about when it is worth asking again.
    const options = userLeaguesQuery(USER_ID, createTestQueryClient());
    assert.equal(options.staleTime, MANAGER_STALE_TIMES.leagues);
    // A failed stream is this page's whole content, so it surfaces at once.
    assert.equal(options.retry, false);
  });
});

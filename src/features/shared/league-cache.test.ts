import assert from "node:assert/strict";
import test from "node:test";

import {
  QueryObserver,
  type QueryClient,
  type QueryObserverOptions,
} from "@tanstack/react-query";

import { fetchJson, fetchScoped } from "./api.ts";
import { LEAGUE_DETAIL_STALE_TIME, leagueQueryKeys } from "./league-query.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
} from "./query-test-support.ts";
import { timelineQueryKeys, TIMELINE_STALE_TIME } from "./timeline-query.ts";

/**
 * What opening a league costs, in requests.
 *
 * The League Details read is four queries now rather than one, and every claim
 * the split makes is a claim about *when each of them fires* — so these tests
 * drive `QueryObserver`s directly and assert request counts, the same way
 * `features/manager/query-cache.test.ts` does for the manager tabs. A renderer
 * would tell us what was drawn; what the work was for is what was asked.
 *
 * The options below mirror the hooks in `use-league-detail.ts` — the keys, the
 * fetchers and the stale times are the real ones, so a key that stopped
 * separating the board from the rosters fails here.
 */

/** Mount a consumer of a query — a panel, or a card prefetching ahead of one. */
function mount<T>(client: QueryClient, options: QueryObserverOptions<T, Error>) {
  const observer = new QueryObserver<T, Error>(client, options);
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unmount: unsubscribe };
}

/** An `AdpRead` as the drawer builds one: a key, and the GET that carries it. */
function board(query: string) {
  return {
    key: query,
    method: "GET" as const,
    search: new URLSearchParams(query),
    body: null,
  };
}

const BOARD = board("board_season=2026&steepness=2.75");
const NARROWED = board("board_season=2026&steepness=2.75&rounds_min=12");

const coreOptions = (leagueId: string) => ({
  queryKey: leagueQueryKeys.core(leagueId),
  queryFn: () =>
    fetchJson<{ league_id: string }>(
      `/api/league/${leagueId}`,
      "Failed to load league",
    ),
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

const valuesOptions = (leagueId: string, read = BOARD) => ({
  queryKey: leagueQueryKeys.values(leagueId, read.key),
  queryFn: () =>
    fetchScoped<{ ktc: Record<string, number> }>(
      `/api/league/${leagueId}/values`,
      read,
      "Failed to price this league",
    ),
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

const outlookOptions = (leagueId: string) => ({
  queryKey: leagueQueryKeys.outlook(leagueId),
  queryFn: () =>
    fetchJson<{ weeks: number[] } | null>(
      `/api/league/${leagueId}/outlook`,
      "Failed to project this league",
    ),
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

const weekOptions = (leagueId: string, week: number | null) => ({
  queryKey: leagueQueryKeys.week(leagueId, week ?? 0),
  queryFn: () =>
    fetchJson<{ week: number } | null>(
      `/api/league/${leagueId}/week?week=${week}`,
      "Failed to read this week",
    ),
  enabled: week !== null,
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

/** `useTimeline`'s own options — the read this change stopped firing on open. */
const timelineOptions = (leagueId: string | null) => ({
  queryKey: timelineQueryKeys.timeline({ kind: "league" as const, id: leagueId ?? "" }),
  queryFn: () =>
    fetchJson<{ events: unknown[] }>(
      `/api/league/${leagueId}/timeline`,
      "Failed to load the league's timeline",
    ),
  enabled: leagueId !== null,
  staleTime: TIMELINE_STALE_TIME,
});

/** Open a whole season panel: the core, and the two enrichments beside it. */
function openPanel(client: QueryClient, leagueId: string, read = BOARD) {
  return [
    mount(client, coreOptions(leagueId)),
    mount(client, valuesOptions(leagueId, read)),
    mount(client, outlookOptions(leagueId)),
  ];
}

test("opening a league", async (t) => {
  await t.test("asks for the core and the enrichments separately", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123");
    await flush();

    // Four routes, three requests on a season panel — the week is not asked for
    // at all, which is what "not requested" is spelled as now.
    assert.equal(mock.countOf("/api/league/123"), 3);
    assert.equal(mock.countOf("/values"), 1);
    assert.equal(mock.countOf("/outlook"), 1);
    assert.equal(mock.countOf("/week"), 0);
    mock.restore();
  });

  await t.test("does not fetch the timeline", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123");
    // The rail is behind a `History` key, so nothing has a source to ask about
    // until it is pressed — modelled here as the disabled query it becomes.
    mount(client, timelineOptions(null));
    await flush();

    assert.equal(mock.countOf("/timeline"), 0);
    mock.restore();
  });

  await t.test("opening the history is what fetches it, once", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    const first = mount(client, timelineOptions("123"));
    await flush();
    assert.equal(mock.countOf("/timeline"), 1);

    // Closed and reopened inside the timeline's own (hour-long) stale time: the
    // heaviest read either host makes is not re-made.
    first.unmount();
    mount(client, timelineOptions("123"));
    await flush();
    assert.equal(mock.countOf("/timeline"), 1);
    mock.restore();
  });

  await t.test("reopening the same league costs nothing while fresh", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    const open = openPanel(client, "123");
    await flush();
    assert.equal(mock.calls.length, 3);

    // The panel mounts on expand and unmounts on collapse, so this is what
    // closing a card and opening it again actually does.
    for (const q of open) q.unmount();
    openPanel(client, "123");
    await flush();
    assert.equal(mock.calls.length, 3);
    mock.restore();
  });
});

test("changing the ADP board", async (t) => {
  await t.test("re-fetches the values and nothing else", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123");
    await flush();
    mock.calls.length = 0;

    // The drawer narrows: only the two value columns are about to move.
    mount(client, valuesOptions("123", NARROWED));
    await flush();

    assert.equal(mock.countOf("/values"), 1);
    assert.equal(mock.countOf("/outlook"), 0);
    // The structural read is not in the board's key at all, so there is no path
    // by which a narrowed board could reach it.
    assert.equal(
      mock.calls.filter((url) => /\/api\/league\/123(\?|$)/.test(url)).length,
      0,
    );
    mock.restore();
  });

  await t.test("two spellings of one board are one entry", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    mount(client, valuesOptions("123", board("board_season=2026&steepness=2.75")));
    await flush();
    mount(client, valuesOptions("123", board("steepness=2.75&board_season=2026")));
    await flush();

    assert.equal(mock.countOf("/values"), 1);
    mock.restore();
  });
});

test("changing the week", async (t) => {
  await t.test("re-fetches the week and nothing else", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123");
    mount(client, weekOptions("123", 4));
    await flush();
    mock.calls.length = 0;

    mount(client, weekOptions("123", 5));
    await flush();

    assert.equal(mock.countOf("/week?week=5"), 1);
    assert.equal(mock.countOf("/values"), 0);
    assert.equal(mock.countOf("/outlook"), 0);
    assert.equal(
      mock.calls.filter((url) => /\/api\/league\/123(\?|$)/.test(url)).length,
      0,
    );
    mock.restore();
  });

  await t.test("a season panel never asks at all", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    mount(client, weekOptions("123", null));
    await flush();

    assert.equal(mock.countOf("/week"), 0);
    mock.restore();
  });
});

test("switching leagues", async (t) => {
  await t.test("reads the new league rather than serving the old one", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ league: url }));

    const first = mount(client, coreOptions("123"));
    await flush();
    for (const q of [first]) q.unmount();

    const second = mount(client, coreOptions("124"));
    await flush();

    assert.equal(mock.countOf("/api/league/124"), 1);
    // The one thing this must never do: a league's rosters under another's name.
    assert.deepEqual(second.observer.getCurrentResult().data, {
      league: "/api/league/124",
    });
    mock.restore();
  });
});

test("an enrichment that fails", async (t) => {
  await t.test("leaves the core data alone", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) =>
      url.includes("/values")
        ? jsonResponse({ error: "KTC is down" }, 500)
        : jsonResponse({ league_id: "123" }),
    );

    const core = mount(client, coreOptions("123"));
    const values = mount(client, valuesOptions("123"));
    const outlook = mount(client, outlookOptions("123"));
    await flush();

    assert.equal(values.observer.getCurrentResult().status, "error");
    // The rosters are somebody else's response now, so a failed lens costs its
    // own column and nothing else on the panel.
    assert.deepEqual(core.observer.getCurrentResult().data, { league_id: "123" });
    assert.equal(core.observer.getCurrentResult().status, "success");
    assert.equal(outlook.observer.getCurrentResult().status, "success");
    mock.restore();
  });
});

test("prefetching on intent", async (t) => {
  await t.test("a hover warms the core, and the open finds it cached", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    await client.prefetchQuery(coreOptions("123"));
    assert.equal(mock.countOf("/api/league/123"), 1);

    mount(client, coreOptions("123"));
    await flush();
    // The press costs nothing: the answer was already in the cache.
    assert.equal(mock.countOf("/api/league/123"), 1);
    mock.restore();
  });

  await t.test("hovering repeatedly is still one request", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    await client.prefetchQuery(coreOptions("123"));
    await client.prefetchQuery(coreOptions("123"));
    await client.prefetchQuery(coreOptions("123"));

    // `prefetchQuery` is a no-op against an entry inside its stale time, which is
    // the second bound on a pointer sweeping a hundred-league list (the first is
    // the debounce, which is `use-league-prefetch`'s own).
    assert.equal(mock.countOf("/api/league/123"), 1);
    mock.restore();
  });

  await t.test("it warms the core alone", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    await client.prefetchQuery(coreOptions("123"));

    // The three enrichments are the expensive reads; running a lineup solve per
    // team per week for every card a pointer crosses would cost far more than
    // the hover could save.
    assert.equal(mock.countOf("/values"), 0);
    assert.equal(mock.countOf("/outlook"), 0);
    assert.equal(mock.countOf("/week"), 0);
    assert.equal(mock.countOf("/timeline"), 0);
    mock.restore();
  });
});

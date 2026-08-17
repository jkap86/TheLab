import assert from "node:assert/strict";
import test from "node:test";

import {
  QueryObserver,
  type QueryClient,
  type QueryObserverOptions,
} from "@tanstack/react-query";

import { fetchJson, fetchScoped } from "./api.ts";
import { leagueDetailNeeds } from "./league-detail-needs.ts";
import { LEAGUE_DETAIL_STALE_TIME, leagueQueryKeys } from "./league-query.ts";
import { createQueryClient } from "./query-client.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
} from "./query-test-support.ts";
import {
  DEFAULT_PLAYER_COLUMNS,
  DEFAULT_WEEK_PLAYER_COLUMNS,
} from "./roster-metrics.ts";
import {
  DEFAULT_TEAM_COLUMNS,
  DEFAULT_WEEK_TEAM_COLUMNS,
} from "./standings-metrics.ts";
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
 * separating the board from the rosters fails here. What is *not* mirrored is
 * which of them are enabled: that comes from {@link leagueDetailNeeds} itself,
 * so the derivation these assertions are about is the one the panel runs.
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

const valuesOptions = (leagueId: string, read = BOARD, enabled = true) => ({
  queryKey: leagueQueryKeys.values(leagueId, read.key),
  queryFn: () =>
    fetchScoped<{ ktc: Record<string, number> }>(
      `/api/league/${leagueId}/values`,
      read,
      "Failed to price this league",
    ),
  enabled,
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

const outlookOptions = (leagueId: string, enabled = true) => ({
  queryKey: leagueQueryKeys.outlook(leagueId),
  queryFn: () =>
    fetchJson<{ weeks: number[] } | null>(
      `/api/league/${leagueId}/outlook`,
      "Failed to project this league",
    ),
  enabled,
  staleTime: LEAGUE_DETAIL_STALE_TIME,
});

const weekOptions = (leagueId: string, week: number | null, enabled = true) => ({
  queryKey: leagueQueryKeys.week(leagueId, week ?? 0),
  queryFn: () =>
    fetchJson<{ week: number } | null>(
      `/api/league/${leagueId}/week?week=${week}`,
      "Failed to read this week",
    ),
  // The hook's own `week !== null` guard is about the *URL* — there is no week to
  // put in the request line — and the caller's flag narrows it further.
  enabled: enabled && week !== null,
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

/**
 * One open of the panel: all four observers, enabled exactly as the hooks enable
 * them.
 *
 * The disabled ones are *mounted* rather than skipped, because that is what the
 * panel does — a hook is called on every render whatever its `enabled` says, and
 * a query that is mounted-but-off is the one that keeps its cache entry and can
 * be switched back on without a round trip. Skipping them here would model a
 * different thing and would hide exactly the reuse these tests are about.
 */
function openPanel(
  client: QueryClient,
  leagueId: string,
  {
    week = null,
    teamColumns = DEFAULT_TEAM_COLUMNS,
    playerColumns = DEFAULT_PLAYER_COLUMNS,
    read = BOARD,
    previewing = false,
  }: {
    week?: number | null;
    teamColumns?: readonly string[];
    playerColumns?: readonly string[];
    read?: ReturnType<typeof board>;
    /** Whether a columns editor has been opened — see `LeagueDetailPanel`. */
    previewing?: boolean;
  } = {},
) {
  const columnNeeds = leagueDetailNeeds({ week, teamColumns, playerColumns });
  const needs = previewing
    ? { ...columnNeeds, values: true, outlook: true }
    : columnNeeds;
  return [
    mount(client, coreOptions(leagueId)),
    mount(client, valuesOptions(leagueId, read, needs.values)),
    mount(client, outlookOptions(leagueId, needs.outlook)),
    mount(client, weekOptions(leagueId, week, needs.week)),
  ];
}

test("opening a league", async (t) => {
  await t.test("asks for the core and the enrichments separately", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123");
    await flush();

    // Four routes, two requests on a season panel opened at its defaults: the
    // week is not asked for at all, and neither is the KTC/ADP board that no
    // column on either table is pointed at. The outlook is, and structurally
    // rather than because a column names it — the roster halves list `optimal`
    // as their starters and the standings ranks on `weekly_optimal_points`.
    assert.equal(mock.countOf("/api/league/123"), 2);
    assert.equal(mock.countOf("/outlook"), 1);
    assert.equal(mock.countOf("/values"), 0);
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
    assert.equal(mock.calls.length, 2);

    // The panel mounts on expand and unmounts on collapse, so this is what
    // closing a card and opening it again actually does.
    for (const q of open) q.unmount();
    openPanel(client, "123");
    await flush();
    assert.equal(mock.calls.length, 2);
    mock.restore();
  });
});

/**
 * Which of the three enrichments a view actually asks for.
 *
 * The split made the panel render on the core; it did not stop it *asking* for
 * the other three, so a lineup checker opened on one Sunday ran a season-long
 * lineup solve per team and priced a KTC/ADP board it drew nothing from — both
 * competing with the week read it was opened for. {@link leagueDetailNeeds} is
 * the rule and this is it reaching `fetch`.
 */
test("what the current columns cost", async (t) => {
  await t.test("a week panel asks for the week alone", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123", {
      week: 4,
      teamColumns: DEFAULT_WEEK_TEAM_COLUMNS,
      playerColumns: DEFAULT_WEEK_PLAYER_COLUMNS,
    });
    await flush();

    assert.equal(mock.countOf("/week?week=4"), 1);
    assert.equal(mock.countOf("/outlook"), 0);
    assert.equal(mock.countOf("/values"), 0);
    mock.restore();
  });

  await t.test("aiming a slot at KTC is what prices the league", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    openPanel(client, "123", { teamColumns: ["ktc", "bench"] });
    await flush();

    assert.equal(mock.countOf("/values"), 1);
    mock.restore();
  });

  await t.test("a roster slot aimed at ADP prices it too", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    // Either catalogue can turn the read on: the two tables share one payload.
    openPanel(client, "123", { playerColumns: ["start", "adp"] });
    await flush();

    assert.equal(mock.countOf("/values"), 1);
    mock.restore();
  });

  await t.test("a week panel aimed at a season column asks for both", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    // The catalogue is one catalogue, so a rest-of-season metric can be aimed at
    // a week panel — and then it has to be answered.
    openPanel(client, "123", {
      week: 4,
      teamColumns: ["proj"],
      playerColumns: DEFAULT_WEEK_PLAYER_COLUMNS,
    });
    await flush();

    assert.equal(mock.countOf("/outlook"), 1);
    assert.equal(mock.countOf("/week?week=4"), 1);
    assert.equal(mock.countOf("/values"), 0);
    mock.restore();
  });

  await t.test("a season panel never asks for a week it doesn't have", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    // A `week_proj` column aimed at a season panel: there is no week to put in
    // the request line, which is what its cell says in words.
    openPanel(client, "123", {
      teamColumns: ["week_proj", "bench"],
      playerColumns: ["week_proj", "bench"],
    });
    await flush();

    assert.equal(mock.countOf("/week"), 0);
    mock.restore();
  });

  await t.test("switching a column off and on again costs one request", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    const priced = openPanel(client, "123", { teamColumns: ["ktc", "bench"] });
    await flush();
    assert.equal(mock.countOf("/values"), 1);
    for (const q of priced) q.unmount();

    // Aimed away: the query is disabled, and a disabled query keeps its entry.
    const off = openPanel(client, "123", { teamColumns: ["proj", "bench"] });
    await flush();
    assert.equal(mock.countOf("/values"), 1);
    for (const q of off) q.unmount();

    // Back on inside the stale time — re-enabled against the same key, answered
    // from what is already in the cache rather than re-fetched.
    openPanel(client, "123", { teamColumns: ["ktc", "bench"] });
    await flush();
    assert.equal(mock.countOf("/values"), 1);
    mock.restore();
  });

  await t.test("opening the columns editor fills its previews in", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    // The dialog previews every metric in the catalogue against this panel's own
    // subject, so a reader looking at the list is looking at what KTC would say.
    // The week is deliberately not widened: a season panel has none to preview.
    openPanel(client, "123", { previewing: true });
    await flush();

    assert.equal(mock.countOf("/values"), 1);
    assert.equal(mock.countOf("/outlook"), 1);
    assert.equal(mock.countOf("/week"), 0);
    mock.restore();
  });

  await t.test("the enrichments run beside the core, never behind it", async () => {
    const client = createTestQueryClient();
    // A core read that never answers: anything asked for while it is outstanding
    // was asked for in parallel with it. The needs come off the stored columns,
    // which need no fetch, so nothing here can become a waterfall.
    const mock = installFetchMock((url) =>
      /\/api\/league\/123$/.test(url)
        ? new Promise<Response>(() => {})
        : jsonResponse({ url }),
    );

    openPanel(client, "123", {
      week: 4,
      teamColumns: ["proj"],
      playerColumns: ["ktc"],
    });
    await flush();

    assert.equal(
      mock.calls.filter((url) => /\/api\/league\/123$/.test(url)).length,
      1,
    );
    assert.equal(mock.countOf("/outlook"), 1);
    assert.equal(mock.countOf("/values"), 1);
    assert.equal(mock.countOf("/week?week=4"), 1);
    mock.restore();
  });
});

test("changing the ADP board", async (t) => {
  await t.test("re-fetches the values and nothing else", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ url }));

    // A panel that is actually pricing something, since a board change is only a
    // change to a panel with a value column on it.
    const priced = { teamColumns: ["ktc", "bench"] };
    openPanel(client, "123", priced);
    await flush();
    mock.calls.length = 0;

    // The drawer narrows: only the two value columns are about to move.
    openPanel(client, "123", { ...priced, read: NARROWED });
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

    const stepped = {
      teamColumns: DEFAULT_WEEK_TEAM_COLUMNS,
      playerColumns: DEFAULT_WEEK_PLAYER_COLUMNS,
    };
    openPanel(client, "123", { ...stepped, week: 4 });
    await flush();
    mock.calls.length = 0;

    openPanel(client, "123", { ...stepped, week: 5 });
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

  await t.test("is a failed query, not a successful empty one", async () => {
    // The distinction the routes used to erase. `…/outlook` answered a broken
    // read with `200 null`, which lands here as `status: "success"` holding
    // null — the same result a league with no slots, no scoring settings or no
    // weeks left legitimately produces. Nothing below this line could tell them
    // apart, so a database busy for a second read as a league with nothing to
    // project until the entry went stale.
    const client = createTestQueryClient();
    const mock = installFetchMock((url) =>
      url.includes("/outlook")
        ? jsonResponse({ error: "The database is busy right now." }, 503)
        : jsonResponse({ league_id: "123" }),
    );

    const outlook = mount(client, outlookOptions("123"));
    await flush();

    const result = outlook.observer.getCurrentResult();
    assert.equal(result.status, "error");
    // Nothing was cached as an answer: the panel draws its em dash off an
    // *absent* value, which is a different thing from a null it was told to
    // trust.
    assert.equal(result.data, undefined);
    mock.restore();
  });

  await t.test("a league with nothing to project is still a success", async () => {
    // The other half, and the reason the fix is not "make every null an error":
    // `…/outlook` genuinely answers null for a league it cannot project, and
    // that is a 200 the client should keep, cache and never retry.
    const client = createTestQueryClient();
    const mock = installFetchMock(() => jsonResponse(null));

    const outlook = mount(client, outlookOptions("123"));
    await flush();

    const result = outlook.observer.getCurrentResult();
    assert.equal(result.status, "success");
    assert.equal(result.data, null);
    mock.restore();
  });

  await t.test("the configured retry runs on a failure and not on a null", async () => {
    // What the `200 null` cost that is invisible from the outside: the client's
    // one retry is spent on *failures*, so a transient 503 dressed as a success
    // was never asked again — the panel simply stayed empty. Driven on the app's
    // own retry setting rather than the tests' `retry: false`, since the setting
    // is the thing being asserted.
    const client = createQueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: Infinity } },
    });
    const mock = installFetchMock((url) =>
      url.includes("/outlook")
        ? jsonResponse({ error: "The database is busy right now." }, 503)
        : jsonResponse({ week: 5 }),
    );

    mount(client, outlookOptions("123"));
    mount(client, weekOptions("124", 5));
    await flush(50);

    assert.equal(mock.countOf("/api/league/123/outlook"), 2);
    // A 200 is an answer, and answers are not retried.
    assert.equal(mock.countOf("/api/league/124/week"), 1);
    mock.restore();
  });

  await t.test("a failure is not held as fresh the way an answer is", async () => {
    // The last consequence of the old shape, and the one with the longest tail:
    // a successful null sat in the cache for `LEAGUE_DETAIL_STALE_TIME`, so
    // closing the card and opening it again inside five minutes served the
    // failure back without asking anyone. A real failure has nothing to serve.
    const client = createTestQueryClient();
    const mock = installFetchMock((url, call) =>
      call === 0
        ? jsonResponse({ error: "The database is busy right now." }, 503)
        : jsonResponse({ weeks: [5, 6], url }),
    );

    const first = mount(client, outlookOptions("123"));
    await flush();
    assert.equal(first.observer.getCurrentResult().status, "error");
    first.unmount();

    // The panel mounts on expand and unmounts on collapse — this is the reader
    // closing the card and opening it again, well inside the stale time.
    const second = mount(client, outlookOptions("123"));
    await flush();

    assert.equal(mock.countOf("/outlook"), 2);
    assert.equal(second.observer.getCurrentResult().status, "success");
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

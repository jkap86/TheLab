import assert from "node:assert/strict";
import test from "node:test";

import {
  QueryObserver,
  keepPreviousData,
  type QueryClient,
  type QueryObserverOptions,
} from "@tanstack/react-query";

import { ADP_STALE_TIMES } from "../shared/adp-query.ts";
import {
  DEFAULT_COLUMNS,
  managerDataRequirements,
} from "./league-metrics.ts";
import { STALE_TIMES } from "./query-config.ts";
import {
  fetchJson,
  fetchManagerResource,
  invalidateManagerDependents,
} from "./query-fns.ts";
import { boardQueryKeys, managerQueryKeys } from "./query-keys.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
} from "./query-test-support.ts";

/**
 * What the cache does across a navigation, without a renderer.
 *
 * The manager tabs are three routes, so "switching tabs" is a component
 * unmounting and another mounting against the same key — which is exactly a
 * `QueryObserver` being unsubscribed and a new one subscribed. Driving the
 * observers directly is what lets these assertions be about *request counts*,
 * which is the thing the work was for, rather than about rendered output.
 */

/** Mount a consumer of a query — a page, or the drawer on top of it. */
function mount<T>(client: QueryClient, options: QueryObserverOptions<T, Error>) {
  const observer = new QueryObserver<T, Error>(client, options);
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unmount: unsubscribe };
}

/** A canonical Sleeper id, as the leagues stream reports one. */
const USER_ID = "12345678901234567";

const ktcOptions = (searched: string) => ({
  queryKey: managerQueryKeys.ktc(searched),
  queryFn: () =>
    fetchManagerResource<{ ok: string }>(searched, "ktc", "Failed to load values"),
  staleTime: STALE_TIMES.ktc,
});

const leaguesOptions = (searched: string) => ({
  queryKey: managerQueryKeys.leagues(searched),
  queryFn: () =>
    fetchManagerResource<{ ok: string }>(searched, "leagues", "Failed to load leagues"),
  staleTime: STALE_TIMES.leagues,
});

// Mirrors `useAdp`'s options, `keepPreviousData` included — the stale-flag test
// below is about exactly that line.
const adpOptions = (query: string) => ({
  queryKey: boardQueryKeys.adp(query),
  queryFn: () => fetchJson<{ query: string }>(`/api/adp?${query}`, "Failed to load ADP"),
  staleTime: ADP_STALE_TIMES.board,
  placeholderData: keepPreviousData,
});

test("navigating between sibling manager routes", async (t) => {
  await t.test("does not re-ask for leagues while they are fresh", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    // Leagues → Players → Leaguemates → Leagues: the middle two don't read this
    // query at all, so it is unmounted throughout and remounted at the end.
    const first = mount(client, leaguesOptions("alice"));
    await flush();
    first.unmount();
    await flush();
    const back = mount(client, leaguesOptions("alice"));
    await flush();

    assert.equal(mock.countOf("/leagues"), 1);
    // And the tab renders the cached answer rather than a loading screen.
    assert.ok(back.observer.getCurrentResult().data);
    back.unmount();
    mock.restore();
  });

  await t.test("keeps KTC across the tabs that read it", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const leaguesTab = mount(client, ktcOptions("alice"));
    await flush();
    leaguesTab.unmount();

    // A trip through Players and back — a new mount, a freshly built key array.
    const returned = mount(client, ktcOptions("alice"));
    await flush();

    assert.equal(mock.countOf("/ktc"), 1);
    assert.ok(returned.observer.getCurrentResult().data);
    returned.unmount();
    mock.restore();
  });

  await t.test(
    "sends the canonical id, so a page is one Sleeper lookup",
    async () => {
      // The five database-backed reads take a `user_id` and join it against what
      // the leagues sync wrote; without it each route opens by asking Sleeper who
      // the searched name is, which is four upstream requests per page load for
      // an id the leagues stream has already sent. See `resolveManagerIdRequest`.
      const client = createTestQueryClient();
      const mock = installFetchMock((url) => jsonResponse({ ok: url }));

      for (const path of ["players", "leaguemates", "ranks", "ktc"]) {
        const view = mount(client, {
          queryKey: [...managerQueryKeys.manager("alice"), path],
          queryFn: () =>
            fetchManagerResource<{ ok: string }>(
              "alice",
              path,
              "Failed",
              undefined,
              USER_ID,
            ),
        });
        await flush();
        view.unmount();
      }

      assert.equal(mock.calls.length, 4);
      for (const url of mock.calls) {
        assert.ok(url.includes(`user_id=${USER_ID}`), url);
      }
      mock.restore();
    },
  );

  await t.test("appends the id to a path that already has a query", async () => {
    // The ADP valuation's path *is* a query string — the drawer's whole board —
    // so the separator is chosen rather than assumed.
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const view = mount(client, {
      queryKey: managerQueryKeys.adpValue("alice", undefined, "steepness=3"),
      queryFn: () =>
        fetchManagerResource<{ ok: string }>(
          "alice",
          "adp-value?steepness=3",
          "Failed",
          undefined,
          USER_ID,
        ),
    });
    await flush();

    assert.equal(mock.calls[0], `/api/user/alice/adp-value?steepness=3&user_id=${USER_ID}`);
    view.unmount();
    mock.restore();
  });

  await t.test("asks without the id when there is none to send", async () => {
    // Direct navigation and older clients still work; the route resolves the
    // name exactly as it always did.
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const view = mount(client, {
      queryKey: managerQueryKeys.ranks("alice"),
      queryFn: () =>
        fetchManagerResource<{ ok: string }>("alice", "ranks", "Failed"),
    });
    await flush();

    assert.equal(mock.calls[0], "/api/user/alice/ranks");
    view.unmount();
    mock.restore();
  });

  await t.test("does not serve one manager's data to another", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const alice = mount(client, ktcOptions("alice"));
    await flush();
    alice.unmount();
    const bob = mount(client, ktcOptions("bob"));
    await flush();

    assert.equal(mock.countOf("/ktc"), 2);
    assert.deepEqual(bob.observer.getCurrentResult().data, { ok: "/api/user/bob/ktc" });
    bob.unmount();
    mock.restore();
  });
});

test("the ADP board", async (t) => {
  await t.test("is one request when the page and the drawer both want it", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ query: url }));
    const query = "limit=1000&season=2026";

    // The Players tab's ADP column, then the drawer opened over it.
    const page = mount(client, adpOptions(query));
    const drawer = mount(client, adpOptions(query));
    await flush();

    assert.equal(mock.countOf("/api/adp"), 1);
    assert.deepEqual(
      page.observer.getCurrentResult().data,
      drawer.observer.getCurrentResult().data,
    );
    page.unmount();
    drawer.unmount();
    mock.restore();
  });

  await t.test("shows a board the page already loaded the moment it opens", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ query: url }));
    const query = "limit=1000&season=2026";

    const page = mount(client, adpOptions(query));
    await flush();
    // The drawer is gated on being open — the gate is on the fetch, not the read.
    const drawer = mount(client, { ...adpOptions(query), enabled: false });

    assert.ok(drawer.observer.getCurrentResult().data);
    assert.equal(mock.countOf("/api/adp"), 1);
    page.unmount();
    drawer.unmount();
    mock.restore();
  });

  await t.test("is a different entry per filter, and cached per filter", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ query: url }));

    const first = mount(client, adpOptions("season=2026"));
    await flush();
    first.unmount();

    // Changing a filter is a real question, so it costs a request…
    const narrowed = mount(client, adpOptions("season=2026&superflex=1"));
    await flush();
    narrowed.unmount();
    assert.equal(mock.countOf("/api/adp"), 2);

    // …and restoring the previous one is answered from the cache, immediately.
    const restored = mount(client, adpOptions("season=2026"));
    assert.deepEqual(restored.observer.getCurrentResult().data, {
      query: "/api/adp?season=2026",
    });
    await flush();
    assert.equal(mock.countOf("/api/adp"), 2);
    restored.unmount();
    mock.restore();
  });

  await t.test("is one entry however the filters are ordered", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ query: url }));

    const one = mount(client, adpOptions("limit=1000&season=2026"));
    await flush();
    one.unmount();
    const other = mount(client, adpOptions("season=2026&limit=1000"));
    await flush();

    assert.equal(mock.countOf("/api/adp"), 1);
    other.unmount();
    mock.restore();
  });

  await t.test("holds the previous board through a filter change, flagged stale", async () => {
    // `useAdp`'s `keepPreviousData`, seen from the cache: a filter press is a
    // *different key* on the same observer, and what the drawer renders in the
    // gap is the old board — real rows, wrong filters — which is exactly what
    // `isPlaceholderData` exists to name. The drawer dims the rows on it; this
    // pins the flag's whole lifecycle so that dimming means what it says.
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ query: url }));

    const board = mount(client, adpOptions("season=2026"));
    await flush();
    assert.equal(board.observer.getCurrentResult().isPlaceholderData, false);

    // The press: same observer, new key — the hook re-rendering with new filters.
    board.observer.setOptions(adpOptions("season=2026&superflex=1"));
    const held = board.observer.getCurrentResult();
    assert.deepEqual(
      held.data,
      { query: "/api/adp?season=2026" },
      "the old board stays on screen rather than blanking",
    );
    assert.equal(held.isPlaceholderData, true, "and it is flagged as not this key's answer");

    // The new board lands: the flag drops with the data swap, never after it.
    await flush();
    const landed = board.observer.getCurrentResult();
    assert.deepEqual(landed.data, { query: "/api/adp?season=2026&superflex=1" });
    assert.equal(landed.isPlaceholderData, false);

    // Widening back is a cache hit: the first board, immediately, with no
    // stale beat and no third request.
    board.observer.setOptions(adpOptions("season=2026"));
    const restored = board.observer.getCurrentResult();
    assert.deepEqual(restored.data, { query: "/api/adp?season=2026" });
    assert.equal(restored.isPlaceholderData, false);
    assert.equal(mock.countOf("/api/adp"), 2);

    board.unmount();
    mock.restore();
  });
});

test("refreshing", async (t) => {
  await t.test("a failed background refetch keeps the last good answer", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url, call) =>
      call === 0 ? jsonResponse({ ok: url }) : jsonResponse({ error: "boom" }, 500),
    );

    const view = mount(client, ktcOptions("alice"));
    await flush();
    const loaded = view.observer.getCurrentResult().data;

    await client.invalidateQueries({ queryKey: managerQueryKeys.ktc("alice") });
    await flush(20);

    const result = view.observer.getCurrentResult();
    assert.equal(mock.countOf("/ktc"), 2);
    assert.ok(result.error, "the failure is reported");
    assert.deepEqual(result.data, loaded, "and the rows on screen survive it");
    view.unmount();
    mock.restore();
  });

  await t.test("explicit invalidation asks again", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const view = mount(client, leaguesOptions("alice"));
    await flush();
    assert.equal(mock.countOf("/leagues"), 1);

    await client.invalidateQueries({ queryKey: managerQueryKeys.leagues("alice") });
    await flush(20);

    assert.equal(mock.countOf("/leagues"), 2);
    view.unmount();
    mock.restore();
  });

  await t.test("a material revision invalidates the dependents and nothing else", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    // Everything a manager page holds at once, plus a board that belongs to
    // nobody, all freshly loaded.
    const board = boardQueryKeys.adp("season=2026");
    const mounted = [
      mount(client, leaguesOptions("alice")),
      mount(client, ktcOptions("alice")),
      mount(client, {
        queryKey: managerQueryKeys.ranks("alice"),
        queryFn: () =>
          fetchManagerResource<{ ok: string }>("alice", "ranks", "Failed to load ranks"),
        staleTime: STALE_TIMES.ranks,
      }),
      mount(client, adpOptions("season=2026")),
    ];
    await flush();
    const before = mock.calls.length;

    invalidateManagerDependents(client, "alice");
    await flush(20);

    assert.equal(mock.countOf("/ktc"), 2, "KTC is behind the sync");
    assert.equal(mock.countOf("/ranks"), 2, "so are the ranks");
    assert.equal(mock.countOf("/leagues"), 1, "the leagues are the change itself");
    assert.equal(mock.countOf("/api/adp?"), 1, "the board is not this manager's");
    assert.equal(mock.calls.length, before + 2);
    assert.ok(!client.getQueryState(board)?.isInvalidated);

    for (const view of mounted) view.unmount();
    mock.restore();
  });

  await t.test("a stable key rebuilt on every render is not a reason to ask", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    // Every render builds a new key array and a new leagues array; neither is a
    // change to what is being asked, which is the refetch loop this replaced.
    const view = mount(client, ktcOptions("alice"));
    await flush();
    for (let render = 0; render < 5; render += 1) {
      view.observer.setOptions(ktcOptions("alice"));
      await flush();
    }

    assert.equal(mock.countOf("/ktc"), 1);
    view.unmount();
    mock.restore();
  });
});

test("retention", async (t) => {
  await t.test("an entry nobody reads is collected after its gcTime", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));
    const options = { ...ktcOptions("alice"), gcTime: 20 };

    const view = mount(client, options);
    await flush();
    assert.ok(client.getQueryData(options.queryKey));

    view.unmount();
    // Still held while inside the window…
    assert.ok(client.getQueryData(options.queryKey));
    await flush(60);
    // …and gone past it, which is the "never cache indefinitely" half.
    assert.equal(client.getQueryData(options.queryKey), undefined);

    // So the next visit is a real request again.
    const later = mount(client, options);
    await flush();
    assert.equal(mock.countOf("/ktc"), 2);
    later.unmount();
    mock.restore();
  });
});

/**
 * What the optional card datasets cost when nothing on screen reads them.
 *
 * The leagues list's KTC and ADP-value reads are batch routes that solve every
 * team's optimal lineup in every league the manager plays in, and price every one
 * of those rosters against a crawled board. Both were gated on nothing but "are
 * there leagues", so a reader whose four stat columns named neither paid for both
 * on every visit and drew neither — which is invisible from the page, since the
 * columns that are showing look exactly right.
 *
 * Driven through `QueryObserver` rather than a renderer for this file's usual
 * reason: the assertion is a *request count*, which is what the work was for.
 */
test("optional card datasets", async (t) => {
  /** `useManagerKtc`'s options, gated the way the leagues list gates them. */
  const gatedKtc = (searched: string, columns: readonly string[]) => ({
    ...ktcOptions(searched),
    enabled: managerDataRequirements(columns).ktc,
  });

  const gatedAdpValue = (searched: string, columns: readonly string[]) => ({
    queryKey: managerQueryKeys.adpValue(searched, undefined, "steepness=3"),
    queryFn: () =>
      fetchManagerResource<{ ok: string }>(
        searched,
        "adp-value",
        "Failed to load draft values",
      ),
    staleTime: STALE_TIMES.adpValue,
    enabled: managerDataRequirements(columns).adp,
  });

  const PROJECTIONS_ONLY = ["points", "points_for", "proj", "proj_pts"];

  await t.test("asks for neither when no column reads one", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const ktc = mount(client, gatedKtc("alice", PROJECTIONS_ONLY));
    const adp = mount(client, gatedAdpValue("alice", PROJECTIONS_ONLY));
    await flush();

    assert.equal(mock.countOf("/ktc"), 0);
    assert.equal(mock.countOf("/adp-value"), 0);
    ktc.unmount();
    adp.unmount();
    mock.restore();
  });

  await t.test("asks for each one a column does read", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const ktc = mount(client, gatedKtc("alice", DEFAULT_COLUMNS));
    const adp = mount(client, gatedAdpValue("alice", DEFAULT_COLUMNS));
    await flush();

    assert.equal(mock.countOf("/ktc"), 1, "the default board shows a KTC rank");
    assert.equal(mock.countOf("/adp-value"), 1, "and a market rank");
    ktc.unmount();
    adp.unmount();
    mock.restore();
  });

  await t.test("asks for only the one a mixed board reads", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    const mixed = ["points", "proj", "proj_pts", "ktc_bench"];
    const ktc = mount(client, gatedKtc("alice", mixed));
    const adp = mount(client, gatedAdpValue("alice", mixed));
    await flush();

    assert.equal(mock.countOf("/ktc"), 1);
    assert.equal(mock.countOf("/adp-value"), 0);
    ktc.unmount();
    adp.unmount();
    mock.restore();
  });

  await t.test("re-aiming a slot back onto KTC reads the cache, not the route", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse({ ok: url }));

    // On, off, on — which is one press each way, and must not be three requests.
    const view = mount(client, gatedKtc("alice", DEFAULT_COLUMNS));
    await flush();
    assert.equal(mock.countOf("/ktc"), 1);

    view.observer.setOptions(gatedKtc("alice", PROJECTIONS_ONLY));
    await flush();
    view.observer.setOptions(gatedKtc("alice", DEFAULT_COLUMNS));
    await flush();

    // The entry is still inside its stale time, so enabling is a cache read —
    // nothing here invalidates, because the selection is not a fact about the
    // data.
    assert.equal(mock.countOf("/ktc"), 1);
    assert.ok(view.observer.getCurrentResult().data);
    view.unmount();
    mock.restore();
  });
});

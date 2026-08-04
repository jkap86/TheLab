import assert from "node:assert/strict";
import test from "node:test";

import {
  QueryObserver,
  type QueryClient,
  type QueryObserverOptions,
} from "@tanstack/react-query";

import { ADP_STALE_TIMES } from "../shared/adp-query.ts";
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

const adpOptions = (query: string) => ({
  queryKey: boardQueryKeys.adp(query),
  queryFn: () => fetchJson<{ query: string }>(`/api/adp?${query}`, "Failed to load ADP"),
  staleTime: ADP_STALE_TIMES.board,
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

import assert from "node:assert/strict";
import test from "node:test";

import { QueryObserver, type QueryClient } from "@tanstack/react-query";

import type { UserInfo } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import {
  cachedLeaguesRevision,
  dependentsFellBehind,
  publishManagerLeagues,
} from "./leagues-cache.ts";
import { leaguesRevision, type ManagerLeaguesData } from "./leagues-stream.ts";
import {
  dependentManagerQueryKeys,
  managerQueryKeys,
} from "./manager-query.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
  ndjsonResponse,
} from "./query-test-support.ts";
import { userLeaguesQuery } from "./use-user-leagues.ts";

/**
 * Who notices that a manager's derived reads have gone behind.
 *
 * The bug this pins is one of ownership rather than of arithmetic. The revision
 * comparison was correct and lived in `useFilteredLeagues`, which is the manager
 * tool — but the entry it watches is written by three tools, so the comparison
 * only happened while *that* tool was mounted. A reader who visited the manager
 * tabs, walked over to the lineup checker or the pick tracker, let one of those
 * refresh the leagues past their stale time, and walked back, arrived to a page
 * whose first sighting of the new revision was its own initial one. Nothing was
 * invalidated, and the shares, ranks, values and ADP valuation on screen stayed
 * the previous revision's for up to their own stale times — ten minutes for the
 * two shares reads, fifteen for KTC and the valuation.
 *
 * The keys here are the app's own factories rather than strings, since what is
 * being asserted is that the invalidation reaches the entries the hooks actually
 * file under.
 */

const USERNAME = "alice";
const SEASON = "2026";

const league = (id: string, wins = 1): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  status: "in_season",
  season: SEASON,
  total_rosters: 12,
  avatar: null,
  record: { wins, losses: 0, ties: 0 },
  settings: null,
  roster_positions: null,
  scoring_settings: null,
});

const USER: UserInfo = {
  user_id: "1",
  username: USERNAME,
  display_name: "Alice",
  avatar: null,
  avatar_url: null,
};

/** One state of the stream, as {@link fetchManagerLeagues} publishes it. */
const state = (leagues: ManagerLeague[], refreshSeq: number): ManagerLeaguesData => ({
  result: {
    type: "result",
    user: USER,
    season: SEASON,
    leagues,
    stale: false,
    refreshing: false,
  },
  progress: null,
  refreshing: false,
  refreshError: null,
  revision: leaguesRevision(leagues, SEASON, refreshSeq),
});

/** A published state from a cold sync that has no payload yet. */
const progressOnly = (): ManagerLeaguesData => ({
  result: null,
  progress: { type: "progress", phase: "initial", loaded: 2, total: 9, failed: 0 },
  refreshing: true,
  refreshError: null,
  revision: "",
});

/** Fill every manager-derived entry, as a visit to the manager tabs would. */
function seedDependents(client: QueryClient, searched = USERNAME): void {
  for (const queryKey of dependentManagerQueryKeys(searched)) {
    client.setQueryData(queryKey, { from: "revision A" });
  }
}

/** Which of those entries the cache now considers stale. */
const invalidated = (client: QueryClient, searched = USERNAME): string[] =>
  dependentManagerQueryKeys(searched)
    .filter((queryKey) => client.getQueryState(queryKey)?.isInvalidated)
    .map((queryKey) => String(queryKey[2]));

const ALL_DEPENDENTS = ["players", "leaguemates", "ranks", "ktc", "adp-value"];

test("publishing a manager's leagues", async (t) => {
  await t.test("invalidates every derived read when the revision moves", () => {
    const client = createTestQueryClient();
    client.setQueryData(managerQueryKeys.leagues(USERNAME), state([league("a")], 0));
    seedDependents(client);

    publishManagerLeagues(client, USERNAME, state([league("a"), league("b")], 1));

    assert.deepEqual(invalidated(client).sort(), [...ALL_DEPENDENTS].sort());
  });

  await t.test("does not invalidate on the first population", () => {
    // A cold cache has nothing on screen that could be behind — and the derived
    // reads are gated on the leagues arriving, so there is nothing to re-ask.
    const client = createTestQueryClient();
    seedDependents(client);

    publishManagerLeagues(client, USERNAME, state([league("a")], 0));

    assert.deepEqual(invalidated(client), []);
    assert.ok(client.getQueryData(managerQueryKeys.leagues(USERNAME)));
  });

  await t.test("does not invalidate when the revision holds still", () => {
    // The whole point of a revision: a refresh that changed nothing costs
    // nothing, where the identity of the leagues array cost five requests.
    const client = createTestQueryClient();
    publishManagerLeagues(client, USERNAME, state([league("a")], 0));
    seedDependents(client);

    publishManagerLeagues(client, USERNAME, state([league("a")], 0));

    assert.deepEqual(invalidated(client), []);
  });

  await t.test("treats a missing revision as no claim, either side", () => {
    // Two ways to have none: an empty cache, and a `progress` state from a cold
    // sync that has no leagues to report yet. Neither is a *different* answer.
    assert.equal(dependentsFellBehind(undefined, "1|2026|a"), false);
    assert.equal(dependentsFellBehind("1|2026|a", undefined), false);
    assert.equal(dependentsFellBehind(null, null), false);
    assert.equal(dependentsFellBehind("", "1|2026|a"), false);
    assert.equal(dependentsFellBehind("1|2026|a", ""), false);
    assert.equal(dependentsFellBehind("1|2026|a", "2|2026|a"), true);

    const client = createTestQueryClient();
    publishManagerLeagues(client, USERNAME, state([league("a")], 0));
    seedDependents(client);
    publishManagerLeagues(client, USERNAME, progressOnly());
    assert.deepEqual(invalidated(client), [], "a payload-less state says nothing");
  });

  await t.test("never invalidates the leagues entry it just wrote", () => {
    // The loop this must not close: leagues refresh → dependents stale →
    // leagues refresh. `dependentManagerQueryKeys` excludes the entry that
    // changed, and it already holds the new data.
    const client = createTestQueryClient();
    publishManagerLeagues(client, USERNAME, state([league("a")], 0));
    publishManagerLeagues(client, USERNAME, state([league("a")], 1));

    const leaguesKey = managerQueryKeys.leagues(USERNAME);
    assert.equal(client.getQueryState(leaguesKey)?.isInvalidated, false);
    assert.equal(
      (client.getQueryData(leaguesKey) as ManagerLeaguesData).revision,
      state([league("a")], 1).revision,
    );
  });

  await t.test("leaves another manager's reads alone", () => {
    const client = createTestQueryClient();
    publishManagerLeagues(client, USERNAME, state([league("a")], 0));
    seedDependents(client, "bob");

    publishManagerLeagues(client, USERNAME, state([league("a")], 1));

    assert.deepEqual(invalidated(client, "bob"), []);
  });

  await t.test("reads back the revision the fetcher continues from", () => {
    const client = createTestQueryClient();
    assert.equal(cachedLeaguesRevision(client, USERNAME), undefined);
    publishManagerLeagues(client, USERNAME, state([league("a")], 3));
    assert.equal(
      cachedLeaguesRevision(client, USERNAME),
      leaguesRevision([league("a")] as never, SEASON, 3),
    );
    // Lower-cased, so `/manager/Jkap` and a stored `jkap` are one entry.
    assert.equal(
      cachedLeaguesRevision(client, "ALICE"),
      cachedLeaguesRevision(client, USERNAME),
    );
  });
});

test("a refresh run by another tool", async (t) => {
  await t.test(
    "invalidates the manager's derived reads with the manager unmounted",
    async () => {
      // The reported sequence, end to end. Only the leagues stream is driven
      // through an observer — the manager tabs are not on screen at all, which
      // is exactly the condition under which the old comparison never ran.
      const client = createTestQueryClient();
      let call = 0;
      const mock = installFetchMock((url) => {
        if (!url.includes("/leagues")) return jsonResponse({ ok: url });
        call += 1;
        return ndjsonResponse([
          {
            type: "result",
            user: { user_id: "1", username: USERNAME },
            season: SEASON,
            // Revision A on the first read, B on the second: a league won since.
            leagues: call === 1 ? [league("a")] : [league("a", 2)],
            stale: false,
            refreshing: false,
          },
        ]);
      });

      // 1. The manager tabs loaded, filling the leagues entry and everything
      //    derived from it.
      const managerTab = mountLeagues(client, USERNAME);
      await flush();
      const revisionA = cachedLeaguesRevision(client, USERNAME);
      assert.ok(revisionA, "the leagues entry holds revision A");
      seedDependents(client);

      // 2. Away to another tool, so nothing manager-scoped is mounted.
      managerTab.unmount();
      await flush();

      // 3. That tool refreshes the shared entry — a stale read, its own mount.
      await client.invalidateQueries({ queryKey: managerQueryKeys.leagues(USERNAME) });
      const otherTool = mountLeagues(client, USERNAME);
      await flush(20);

      // 4. Revision B landed, and the derived reads know they are behind.
      assert.notEqual(cachedLeaguesRevision(client, USERNAME), revisionA);
      assert.deepEqual(invalidated(client).sort(), [...ALL_DEPENDENTS].sort());
      // …and the entry that changed is not itself marked stale, or the refresh
      // would provoke the refresh that provoked it.
      assert.equal(
        client.getQueryState(managerQueryKeys.leagues(USERNAME))?.isInvalidated,
        false,
      );
      assert.equal(mock.countOf("/leagues"), 2, "two reads, not a loop");

      otherTool.unmount();
      mock.restore();
    },
  );

  await t.test("makes the manager tool re-ask on its next mount", async () => {
    // What the invalidation is *for*: the manager page comes back and the reads
    // it re-mounts are fetched again rather than served from a stale entry
    // sitting well inside its ten- and fifteen-minute windows.
    const client = createTestQueryClient();
    const mock = installFetchMock((url) =>
      url.includes("/leagues")
        ? ndjsonResponse([
            {
              type: "result",
              user: { user_id: "1", username: USERNAME },
              season: SEASON,
              leagues: [league("a")],
              stale: false,
              refreshing: false,
            },
          ])
        : jsonResponse({ ok: url }),
    );

    const ktcOptions = {
      queryKey: managerQueryKeys.ktc(USERNAME),
      queryFn: () =>
        fetch(`/api/user/${USERNAME}/ktc`).then((res) => res.json() as Promise<unknown>),
      staleTime: 15 * 60 * 1000,
    };

    const ktcTab = mount(client, ktcOptions);
    await flush();
    assert.equal(mock.countOf("/ktc"), 1);
    ktcTab.unmount();

    // Inside its stale time, a remount alone asks for nothing…
    const unchanged = mount(client, ktcOptions);
    await flush();
    assert.equal(mock.countOf("/ktc"), 1);
    unchanged.unmount();

    // …until another tool's refresh moves the revision.
    publishManagerLeagues(client, USERNAME, state([league("a")], 0));
    publishManagerLeagues(client, USERNAME, state([league("a")], 1));

    const returned = mount(client, ktcOptions);
    await flush(20);
    assert.equal(mock.countOf("/ktc"), 2, "the stale answer is re-asked for");
    returned.unmount();
    mock.restore();
  });
});

/** A page reading the shared leagues query — the picker, or the checker's list. */
function mountLeagues(client: QueryClient, username: string) {
  return mount(client, userLeaguesQuery(username, client) as never);
}

function mount<T>(client: QueryClient, options: object) {
  const observer = new QueryObserver<T, Error>(client, options as never);
  const unmount = observer.subscribe(() => {});
  return { observer, unmount };
}

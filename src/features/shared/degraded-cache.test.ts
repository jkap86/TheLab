import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  QueryObserver,
  type QueryClient,
  type QueryObserverOptions,
} from "@tanstack/react-query";

import type {
  LeagueValuesPayload,
  ManagerAdpValuePayload,
  ManagerKtcPayload,
  ManagerMatchupsPayload,
  ManagerRanksPayload,
} from "@/shared/contract";

import {
  adpValueDegraded,
  degradedStaleTime,
  ktcDegraded,
  matchupsDegraded,
  ranksDegraded,
  valuesDegraded,
} from "./degraded.ts";
import { fetchJson } from "./api.ts";
import { LEAGUE_DETAIL_STALE_TIME, leagueQueryKeys } from "./league-query.ts";
import { MATCHUPS_STALE_TIME, lineupQueryKeys } from "./lineup-query.ts";
import { MANAGER_STALE_TIMES, managerQueryKeys } from "./manager-query.ts";
import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
} from "./query-test-support.ts";

/**
 * **A `200` carrying a failed section must not be remembered as a success.**
 *
 * The assertion is a request *count*, which is what the whole design was for:
 * these five reads are allowed to answer partially, and the price of that
 * permission is that the partial answer stays retryable. Before
 * {@link degradedStaleTime} it did not — a database busy for one second put an
 * empty payload in this cache for five minutes on the ranks, fifteen on the two
 * valuations, and there was no failure for the query client's retry to act on.
 *
 * Driven through `QueryObserver` directly rather than through the hooks, the
 * habit `query-cache.test.ts` established: "switching tabs" is an observer
 * unsubscribing and another subscribing against the same key, and what these
 * tests are about is how many times `fetch` was called across that.
 *
 * All five keys and windows come from `features/shared`, the lineup checker's
 * included: its key already lived here because a shared part invalidates it, and
 * its stale time moved beside it rather than being spelled out again — a test
 * that re-declares the number it is asserting about asserts nothing.
 */

/** Mount a consumer of a query — a page, or a panel on top of it. */
function mount<T>(client: QueryClient, options: QueryObserverOptions<T, Error>) {
  const observer = new QueryObserver<T, Error>(client, options);
  return { unmount: observer.subscribe(() => {}) };
}

/**
 * Ask, unmount, remount, ask again — and report how many requests that took.
 *
 * One request means the second mount read the cache; two means the entry was
 * stale and the read was made again, which is the whole behaviour under test.
 */
async function requestsAcrossARemount<T>(
  options: (client: QueryClient) => QueryObserverOptions<T, Error>,
  answers: readonly unknown[],
): Promise<number> {
  const client = createTestQueryClient();
  const mock = installFetchMock((_url, call) =>
    jsonResponse(answers[Math.min(call, answers.length - 1)]),
  );
  try {
    const first = mount(client, options(client));
    await flush();
    first.unmount();

    const second = mount(client, options(client));
    await flush();
    second.unmount();

    return mock.calls.length;
  } finally {
    mock.restore();
  }
}

const ranksPayload = (
  projections: ManagerRanksPayload["projections"],
): ManagerRanksPayload => ({ season: "2026", weeks: [], projections, ranks: {} });

const ktcPayload = (
  lineups: ManagerKtcPayload["lineups"],
): ManagerKtcPayload => ({
  season: "2026",
  updated_at: null,
  weeks: [],
  lineups,
  leagues: {},
});

const adpPayload = (
  lineups: ManagerAdpValuePayload["lineups"],
): ManagerAdpValuePayload => ({
  season: "2026",
  weeks: [],
  lineups,
  leagues: {},
});

const valuesPayload = (
  ktc_status: LeagueValuesPayload["ktc_status"],
  adp_status: LeagueValuesPayload["adp_status"],
): LeagueValuesPayload => ({
  superflex: true,
  ktc_updated_at: null,
  ktc_status,
  adp_status,
  adp_board: "dynasty",
  adp_draft_count: 3,
  ktc: {},
  adp: {},
  adp_position: {},
});

const matchupsPayload = (
  projections: ManagerMatchupsPayload["projections"],
): ManagerMatchupsPayload => ({
  season: "2026",
  week: 5,
  projections,
  matchups: {},
});

/**
 * One read's three claims, bound to its own payload type.
 *
 * A closure per read rather than a table of differently-typed options, because
 * a table would union five payload shapes into one and every entry after the
 * first would stop typechecking against it — which is the drift these tests are
 * supposed to catch, not to suffer from.
 */
function scenario<T>(
  name: string,
  options: () => QueryObserverOptions<T, Error>,
  answered: T,
  failed: T,
): { name: string; run: (t: TestContext) => Promise<void> } {
  return {
    name,
    run: async (t) => {
      await t.test("is reused across a remount when it answered", async () => {
        // Unchanged behaviour, and the reason a *conditional* stale time is the
        // fix rather than simply shortening these windows: an answer —
        // including a legitimately empty one — still costs one request per
        // stale window.
        assert.equal(await requestsAcrossARemount(options, [answered]), 1);
      });

      await t.test("is re-asked for when a section of it failed", async () => {
        assert.equal(await requestsAcrossARemount(options, [failed]), 2);
      });

      await t.test("stops being re-asked for once the retry answers", async () => {
        // Three mounts: the first gets a degraded payload, the second re-asks
        // and gets a good one, the third reads the cache. Anything else here
        // would be a page that re-fetches forever.
        const client = createTestQueryClient();
        const answers = [failed, answered, answered];
        const mock = installFetchMock((_url, call) =>
          jsonResponse(answers[Math.min(call, answers.length - 1)]),
        );
        try {
          for (let i = 0; i < 3; i += 1) {
            const consumer = mount(client, options());
            await flush();
            consumer.unmount();
          }
          assert.equal(mock.calls.length, 2);
        } finally {
          mock.restore();
        }
      });
    },
  };
}

/** The five reads, each with the options its hook actually mounts. */
const READS = [
  scenario<ManagerRanksPayload>(
    "the manager's ranks",
    () => ({
      queryKey: managerQueryKeys.ranks("alice", undefined, { projections: true }),
      queryFn: () => fetchJson<ManagerRanksPayload>("/api/user/alice/ranks", "x"),
      staleTime: degradedStaleTime(MANAGER_STALE_TIMES.ranks, ranksDegraded),
    }),
    ranksPayload("ok"),
    ranksPayload("error"),
  ),
  scenario<ManagerKtcPayload>(
    "the manager's KTC values",
    () => ({
      queryKey: managerQueryKeys.ktc("alice"),
      queryFn: () => fetchJson<ManagerKtcPayload>("/api/user/alice/ktc", "x"),
      staleTime: degradedStaleTime(MANAGER_STALE_TIMES.ktc, ktcDegraded),
    }),
    ktcPayload("ok"),
    ktcPayload("error"),
  ),
  scenario<ManagerAdpValuePayload>(
    "the manager's ADP valuation",
    () => ({
      queryKey: managerQueryKeys.adpValue("alice", undefined, "steepness=2"),
      queryFn: () =>
        fetchJson<ManagerAdpValuePayload>("/api/user/alice/adp-value", "x"),
      staleTime: degradedStaleTime(MANAGER_STALE_TIMES.adpValue, adpValueDegraded),
    }),
    adpPayload("ok"),
    adpPayload("error"),
  ),
  scenario<LeagueValuesPayload>(
    "a League Details panel's prices",
    () => ({
      queryKey: leagueQueryKeys.values("55", "steepness=2"),
      queryFn: () => fetchJson<LeagueValuesPayload>("/api/league/55/values", "x"),
      staleTime: degradedStaleTime(LEAGUE_DETAIL_STALE_TIME, valuesDegraded),
    }),
    valuesPayload("ok", "ok"),
    // One lens down and the other fine: the entry they share is still one the
    // browser must not keep.
    valuesPayload("error", "ok"),
  ),
  scenario<ManagerMatchupsPayload>(
    "the lineup checker's week",
    () => ({
      queryKey: lineupQueryKeys.matchups("alice", 5),
      queryFn: () =>
        fetchJson<ManagerMatchupsPayload>("/api/user/alice/matchups?week=5", "x"),
      staleTime: degradedStaleTime(MATCHUPS_STALE_TIME, matchupsDegraded),
    }),
    matchupsPayload("ok"),
    matchupsPayload("error"),
  ),
];

for (const read of READS) {
  test(read.name, (t) => read.run(t));
}

test("a League Details panel keeps the lens that did answer", async () => {
  // Partial success is the point of reporting the two apart: an ADP outage must
  // not blank the KTC column, and the payload the client holds still carries it.
  const client = createTestQueryClient();
  const priced: LeagueValuesPayload = {
    ...valuesPayload("ok", "error"),
    ktc: { "4034": 6200 },
  };
  const mock = installFetchMock(() => jsonResponse(priced));
  try {
    const observer = new QueryObserver<LeagueValuesPayload, Error>(client, {
      queryKey: leagueQueryKeys.values("55", "steepness=2"),
      queryFn: () => fetchJson<LeagueValuesPayload>("/api/league/55/values", "x"),
      staleTime: degradedStaleTime(LEAGUE_DETAIL_STALE_TIME, valuesDegraded),
    });
    const unmount = observer.subscribe(() => {});
    await flush();

    const result = observer.getCurrentResult();
    assert.equal(result.isSuccess, true);
    assert.deepEqual(result.data?.ktc, { "4034": 6200 });
    assert.deepEqual(result.data?.adp, {});
    assert.equal(result.data?.ktc_status, "ok");
    assert.equal(result.data?.adp_status, "error");
    unmount();
  } finally {
    mock.restore();
  }
});

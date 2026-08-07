import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { InfiniteQueryObserver, type QueryClient } from "@tanstack/react-query";

import type { TradesPagePayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import {
  createTestQueryClient,
  flush,
  installFetchMock,
  jsonResponse,
} from "../shared/query-test-support.ts";
import { DEFAULT_LEAGUE_FILTERS } from "../shared/league-filters/defaults.ts";
import { DEFAULT_TRADE_FILTERS } from "./filters.ts";
import { advanceFiltered, EMPTY_FILTERED } from "./incremental.ts";
import { tradesBoardQuery } from "./hooks/use-trades.ts";
import { resolveLeagueScope, tradeQueryKey } from "./trade-query.ts";
import type { TradeRequest } from "./trade-query.ts";
import { foldTradePages } from "./trades-data.ts";

/**
 * The board's own cache, driven without a renderer.
 *
 * The thing under test is an *accumulation*: the page assumes loaded trades only
 * ever append, and React Query's `maxPages` broke that assumption silently at
 * page 21 — dropping the oldest page, shrinking the list under the scroll, and
 * taking the only page that carries `total`/`scopeTotal` with it. A keyset walk
 * has no previous-page path to read a dropped page back with, so the loss was
 * permanent for that board. Driving `InfiniteQueryObserver` directly is what
 * lets these assertions be about the *cache*, which is where the bug lived.
 */

const PAGE_SIZE = 5;

/** How many pages the fake board has before it runs out. */
const TOTAL_PAGES = 26;

const TOTAL = 500;
const SCOPE_TOTAL = 900;

/** One page of a keyset walk: `?cursor=` names the page, absent means the first. */
function boardPage(url: string): TradesPagePayload {
  const cursor = new URL(url, "http://localhost").searchParams.get("cursor");
  const index = cursor === null ? 0 : Number(cursor);
  const first = index === 0;
  return {
    season: "2026",
    trades: Array.from({ length: PAGE_SIZE }, (_, i) => ({
      transaction_id: `t${index * PAGE_SIZE + i}`,
      league_id: i % 2 === 0 ? "L1" : "L2",
      week: null,
      completed_at: 1_700_000_000_000 - index,
      sides: [],
    })),
    // Null on the last page — the only signal the board is exhausted.
    nextCursor: index + 1 < TOTAL_PAGES ? String(index + 1) : null,
    total: first ? TOTAL : null,
    scopeTotal: first ? SCOPE_TOTAL : null,
    players: {},
    managers: {},
    ktc: {},
    pickKtc: {},
    pickSlots: {},
  } as unknown as TradesPagePayload;
}

const request = (over: Partial<TradeRequest> = {}): TradeRequest => ({
  season: "2026",
  scope: { kind: "all" },
  filters: DEFAULT_TRADE_FILTERS,
  bounds: { from: null, to: null },
  user: null,
  ...over,
});

function mount(client: QueryClient, req: TradeRequest) {
  // The page's own options, so what is exercised is what ships. The cast is only
  // the observer's five type parameters, which `useInfiniteQuery` infers and a
  // direct construction does not.
  const observer = new InfiniteQueryObserver(
    client,
    tradesBoardQuery(req, tradeQueryKey(req)) as never,
  ) as unknown as InfiniteQueryObserver<TradesPagePayload>;
  const unmount = observer.subscribe(() => {});
  return { observer, unmount };
}

/** Pull pages until the board says there are none left, or `limit` is reached. */
async function loadPages(
  observer: InfiniteQueryObserver<TradesPagePayload>,
  limit: number,
): Promise<void> {
  await flush();
  for (let i = 0; i < limit; i++) {
    if (!observer.getCurrentResult().hasNextPage) return;
    await observer.fetchNextPage();
  }
}

const pagesOf = (observer: InfiniteQueryObserver<TradesPagePayload>) =>
  observer.getCurrentResult().data?.pages ?? [];

describe("the trades board's infinite query", () => {
  test("keeps every page past the old twenty-page ceiling", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse(boardPage(url)));

    const { observer, unmount } = mount(client, request());
    await loadPages(observer, 24);

    const pages = pagesOf(observer);
    assert.equal(pages.length, 25, "25 pages fetched");
    const data = foldTradePages(pages);
    assert.equal(data?.trades.length, 25 * PAGE_SIZE);
    // The assertion the eviction bug fails: page 1 is still there at page 25.
    assert.equal(data?.trades[0].transaction_id, "t0");
    assert.equal(
      new Set(data?.trades.map((t) => t.transaction_id)).size,
      25 * PAGE_SIZE,
      "no page was dropped and re-appended under a different cursor",
    );

    unmount();
    client.clear();
    mock.restore();
  });

  test("holds `total` and `scopeTotal` while the board grows", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse(boardPage(url)));

    const { observer, unmount } = mount(client, request());
    await flush();
    assert.equal(foldTradePages(pagesOf(observer))?.total, TOTAL);

    await loadPages(observer, 24);
    const data = foldTradePages(pagesOf(observer));
    // Both come off the first page only, so evicting it blanked the headline
    // the whole page is arranged around.
    assert.equal(data?.total, TOTAL);
    assert.equal(data?.scopeTotal, SCOPE_TOTAL);

    unmount();
    client.clear();
    mock.restore();
  });

  test("stops when the server reports no next cursor", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse(boardPage(url)));

    const { observer, unmount } = mount(client, request());
    // Asked for more pages than exist: the walk has to stop on `nextCursor` and
    // not on a short page, which a full last page would otherwise look like.
    await loadPages(observer, TOTAL_PAGES + 10);

    assert.equal(pagesOf(observer).length, TOTAL_PAGES);
    assert.equal(observer.getCurrentResult().hasNextPage, false);
    assert.equal(mock.countOf("/api/trades"), TOTAL_PAGES);

    unmount();
    client.clear();
    mock.restore();
  });

  test("a page is one request, and pages are not re-fetched as the board grows", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse(boardPage(url)));

    const { observer, unmount } = mount(client, request());
    await loadPages(observer, 24);

    // 25 pages, 25 requests: no re-reading of an evicted page, and no
    // whole-season download reintroduced.
    assert.equal(mock.countOf("/api/trades"), 25);

    unmount();
    client.clear();
    mock.restore();
  });

  test("the incremental filter stays correct across many pages", async () => {
    const client = createTestQueryClient();
    const mock = installFetchMock((url) => jsonResponse(boardPage(url)));

    const { observer, unmount } = mount(client, request());
    await flush();

    // The residual pass as the page runs it: judge what is new, keep what was
    // judged. Fed the growing array one page at a time, exactly as the page
    // feeds it.
    let filtered = EMPTY_FILTERED;
    const generation = tradeQueryKey(request());
    for (let i = 0; i < 25; i++) {
      const trades = foldTradePages(pagesOf(observer))?.trades ?? [];
      filtered = advanceFiltered(filtered, trades, generation, "n2", () => "allowed");
      assert.equal(filtered.visible.length, trades.length, `page ${i + 1}`);
      if (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
    }

    // One last pass over whatever the final fetch appended, so the accumulator
    // has seen the whole board rather than everything but the last page.
    const trades = foldTradePages(pagesOf(observer))?.trades ?? [];
    filtered = advanceFiltered(filtered, trades, generation, "n2", () => "allowed");
    assert.equal(filtered.visible.length, trades.length);
    assert.ok(trades.length >= 25 * PAGE_SIZE);
    assert.equal(filtered.visible[0].transaction_id, "t0");
    // Judged once each, appended in arrival order — the property that fails the
    // moment the source array stops being an extension of what was judged.
    assert.equal(filtered.judged, trades.length);
    assert.deepEqual(
      filtered.visible.map((t) => t.transaction_id),
      trades.map((t) => t.transaction_id),
    );

    unmount();
    client.clear();
    mock.restore();
  });

  test("a large league scope is one POST, and the URL stays short", async () => {
    const client = createTestQueryClient();
    const seen: { method?: string; body?: string; url: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method,
        body: init?.body as string | undefined,
      });
      return jsonResponse(boardPage(String(input)));
    }) as typeof fetch;

    // Two thousand leagues, half of them matching — far past what a request
    // line can carry, and exactly the case that used to go unnarrowed.
    const leagues: ManagerLeague[] = Array.from({ length: 2000 }, (_, i) => ({
      league_id: `L${i}`,
      name: `L${i}`,
      season: "2026",
      status: "in_season",
      total_rosters: 12,
      avatar: null,
      record: null,
      settings: { type: i % 2 === 0 ? 2 : 0 },
      roster_positions: ["QB", "RB", "WR", "BN"],
      scoring_settings: { rec: 1 },
    }));
    const scope = resolveLeagueScope(
      leagues,
      { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
      true,
    );

    const { observer, unmount } = mount(client, request({ scope }));
    await loadPages(observer, 2);

    assert.equal(seen.length, 3);
    for (const call of seen) {
      assert.equal(call.method, "POST");
      assert.ok(call.url.length < 300, `URL was ${call.url.length} characters`);
      assert.ok(!call.url.includes("leagues="), "no id list on the request line");
      assert.equal(
        (JSON.parse(call.body ?? "{}") as { leagues?: string[] }).leagues?.length,
        1000,
        "every matching league id reaches the server",
      );
    }
    // And the cursor still travels on the query string, so the keyset walk is
    // the same one a GET does.
    assert.ok(seen[1].url.includes("cursor="));

    unmount();
    client.clear();
    globalThis.fetch = original;
  });
});

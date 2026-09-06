import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TradesPagePayload } from "@/shared/contract";

import {
  EMPTY_PAGES,
  canLoadMore,
  firstPageFailed,
  firstPageLoaded,
  morePageFailed,
  morePageLoaded,
  pagesHaveMore,
  retryingMore,
} from "./trades-pages.ts";

/**
 * What a failed request is allowed to do to a board.
 *
 * **The bug these pin took a hundred successfully loaded cards off screen.**
 * `useTrades` had one `error`, `TradesHome` checked it before rendering the
 * list, and a failed *second* page therefore replaced the whole board with an
 * error box — over a blip, on a walk that could have simply been resumed. It
 * also set `done: true`, which told the reader they had reached the end of a
 * board they had not.
 *
 * The transitions are pure so these can be driven without a renderer, which
 * this repo deliberately does not have.
 */

const trade = (id: string) => ({
  transaction_id: id,
  league_id: "L1",
  week: null,
  completed_at: 1_700_000_000_000,
  sides: [],
});

const page = (
  ids: readonly string[],
  nextCursor: string | null,
  over: Partial<TradesPagePayload> = {},
): TradesPagePayload =>
  ({
    season: "2026",
    trades: ids.map(trade),
    nextCursor,
    total: null,
    scopeTotal: null,
    players: {},
    managers: {},
    pickSlots: {},
    assetValues: {},
    values: null,
    ...over,
  }) as unknown as TradesPagePayload;

/** A board with one page loaded and a second page waiting. */
const loaded = () =>
  firstPageLoaded(page(["t0", "t1"], "c1", { total: 428, scopeTotal: 900 }));

const ids = (pages: ReturnType<typeof loaded>) =>
  pages.fold?.data.trades.map((t) => t.transaction_id) ?? [];

describe("the first page", () => {
  test("a page that lands starts the board and names the resume", () => {
    const pages = loaded();
    assert.deepEqual(ids(pages), ["t0", "t1"]);
    assert.equal(pages.nextCursor, "c1");
    assert.equal(pages.done, false);
    assert.equal(pages.error, null);
    assert.equal(pagesHaveMore(pages), true);
  });

  test("a page with no cursor is the whole board", () => {
    const pages = firstPageLoaded(page(["t0"], null));
    assert.equal(pages.done, true);
    assert.equal(pagesHaveMore(pages), false);
  });

  test("a first page that fails leaves nothing and says so", () => {
    // Nothing loaded, so this *is* the page. It is the only failure that gets
    // to be one.
    const pages = firstPageFailed("Failed to load trades");
    assert.equal(pages.fold, null);
    assert.equal(pages.error, "Failed to load trades");
    assert.equal(pages.loadMoreError, null);
    assert.equal(pagesHaveMore(pages), false);
  });
});

describe("a later page that fails", () => {
  test("every loaded trade stays exactly where it was", () => {
    // The whole point. This used to be an error box where the board had been.
    const before = loaded();
    const after = morePageFailed(before, "Network error");

    assert.deepEqual(ids(after), ["t0", "t1"]);
    assert.equal(after.fold, before.fold, "the fold is not even rebuilt");
    assert.equal(after.error, null, "the page-level error stays clear");
    assert.equal(after.loadMoreError, "Network error");
  });

  test("the board is not marked finished", () => {
    // `done` says the *server* named no cursor. A failed request said nothing.
    const after = morePageFailed(loaded(), "Network error");
    assert.equal(after.done, false);
    assert.equal(pagesHaveMore(after), true, "hasMore still reflects the server");
  });

  test("the cursor is untouched, so a retry resumes from the same place", () => {
    const after = morePageFailed(loaded(), "Network error");
    assert.equal(after.nextCursor, "c1");
  });

  test("the denominators are untouched", () => {
    const after = morePageFailed(loaded(), "Network error");
    assert.equal(after.fold?.data.total, 428);
    assert.equal(after.fold?.data.scopeTotal, 900);
  });
});

describe("retrying a failed page", () => {
  test("a standing failure suspends the automatic walk", () => {
    // `hasMore` is still true, so the sentinel is still watching; without this
    // the observer would retry against a failing route on every scroll event.
    const failed = morePageFailed(loaded(), "Network error");
    assert.equal(
      canLoadMore(failed, { loading: false, busy: false, force: false }),
      false,
    );
  });

  test("an explicit retry gets past it", () => {
    const failed = morePageFailed(loaded(), "Network error");
    assert.equal(
      canLoadMore(failed, { loading: false, busy: false, force: true }),
      true,
    );
  });

  test("a retry clears the note before it fetches", () => {
    const failed = morePageFailed(loaded(), "Network error");
    const retrying = retryingMore(failed);
    assert.equal(retrying.loadMoreError, null);
    assert.equal(retrying.nextCursor, "c1", "and still resumes from the same place");
    assert.deepEqual(ids(retrying), ["t0", "t1"], "with the board intact");
  });

  test("a successful retry appends and clears the failure", () => {
    const failed = morePageFailed(loaded(), "Network error");
    const after = morePageLoaded(retryingMore(failed), page(["t2", "t3"], "c2"));

    assert.deepEqual(ids(after), ["t0", "t1", "t2", "t3"]);
    assert.equal(after.loadMoreError, null);
    assert.equal(after.nextCursor, "c2");
  });

  test("retrying twice cannot duplicate a row", () => {
    // The same cursor asked for twice returns the same page. Appending it twice
    // would draw every row twice under a count that says otherwise.
    const failed = morePageFailed(loaded(), "Network error");
    const once = morePageLoaded(retryingMore(failed), page(["t2", "t3"], "c2"));
    const twice = morePageLoaded(once, page(["t2", "t3"], "c2"));

    assert.deepEqual(ids(twice), ["t0", "t1", "t2", "t3"]);
    assert.equal(new Set(ids(twice)).size, 4);
  });

  test("a retry racing a slow response cannot duplicate either", () => {
    // Both land; the second is a no-op on the rows and simply restates the
    // cursor. The synchronous `busy` ref is what usually stops the second
    // request existing at all — this is the belt to that pair of braces.
    const failed = morePageFailed(loaded(), "Network error");
    const slow = morePageLoaded(retryingMore(failed), page(["t2"], "c2"));
    const retry = morePageLoaded(slow, page(["t2"], "c2"));
    assert.deepEqual(ids(retry), ["t0", "t1", "t2"]);
  });

  test("a retried page that ends the board still ends it", () => {
    const failed = morePageFailed(loaded(), "Network error");
    const after = morePageLoaded(retryingMore(failed), page(["t2"], null));
    assert.equal(after.done, true);
    assert.equal(pagesHaveMore(after), false);
    assert.equal(after.loadMoreError, null);
  });
});

describe("a reset while a page is in the air", () => {
  test("a response arriving after a reset is dropped", () => {
    // Changing filters while a failed page is pending resets the board; the
    // in-flight response belongs to a question nobody is asking, and appending
    // it would put one board's trades under another's count.
    const reset = EMPTY_PAGES;
    const after = morePageLoaded(reset, page(["t2", "t3"], "c2"));
    assert.equal(after, reset, "the reset state is handed straight back");
    assert.equal(after.fold, null);
  });

  test("a reset clears both failures", () => {
    // A new subject has no failed request of its own yet.
    assert.equal(EMPTY_PAGES.error, null);
    assert.equal(EMPTY_PAGES.loadMoreError, null);
    assert.equal(EMPTY_PAGES.done, false);
    assert.equal(EMPTY_PAGES.nextCursor, null);
  });

  test("a reset board cannot be walked until a first page lands", () => {
    assert.equal(
      canLoadMore(EMPTY_PAGES, { loading: false, busy: false, force: false }),
      false,
    );
    assert.equal(
      canLoadMore(EMPTY_PAGES, { loading: false, busy: false, force: true }),
      false,
      "not even a retry, since there is no cursor to resume from",
    );
  });
});

describe("the guards on asking for another page", () => {
  test("a board with no cursor asks for nothing", () => {
    const finished = firstPageLoaded(page(["t0"], null));
    assert.equal(
      canLoadMore(finished, { loading: false, busy: false, force: false }),
      false,
    );
  });

  test("a first page in flight holds the walk", () => {
    assert.equal(
      canLoadMore(loaded(), { loading: true, busy: false, force: false }),
      false,
    );
  });

  test("a request already out holds the walk, retry or not", () => {
    // This is the guard that stops a duplicate page existing in the first
    // place, and it is why the hook reads a ref rather than `loadingMore`: a
    // value a render closed over is `false` for both of two calls in one frame.
    for (const force of [false, true]) {
      assert.equal(
        canLoadMore(loaded(), { loading: false, busy: true, force }),
        false,
        `force: ${force}`,
      );
    }
  });

  test("an ordinary walk with nothing wrong goes ahead", () => {
    assert.equal(
      canLoadMore(loaded(), { loading: false, busy: false, force: false }),
      true,
    );
  });
});

describe("hasMore is the server's answer, never the request's", () => {
  test("it is true through a failure and false at a real end", () => {
    assert.equal(pagesHaveMore(loaded()), true);
    assert.equal(pagesHaveMore(morePageFailed(loaded(), "boom")), true);
    assert.equal(pagesHaveMore(firstPageLoaded(page(["t0"], null))), false);
    assert.equal(pagesHaveMore(firstPageFailed("boom")), false);
  });
});

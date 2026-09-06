import type { TradesPagePayload } from "@/shared/contract";

import { appendTradePage } from "./trades-data.ts";
import type { TradesFold } from "./trades-data.ts";

/**
 * The paging state machine, as transitions rather than as `setState` bodies.
 *
 * **Pure and separate from the hook for this repo's usual reason**: a function
 * taking its inputs as arguments is one a test can call, where the same logic
 * inside a hook is only reachable through a renderer — and there is no renderer
 * here, by choice. What lives in `hooks/use-trades` afterwards is the fetching,
 * the abort lineage and the refs; every *rule* about what a failure means is
 * here.
 *
 * The rules are worth stating together, because the bug they close came from
 * their all being one field:
 *
 * - **A first page failing and a later page failing are two different events.**
 *   The first leaves nothing to show. The second leaves a hundred cards on
 *   screen that loaded perfectly, and until these were split one dropped
 *   request replaced all of them with an error box.
 * - **A failure never ends the board.** `done` says the *server* named no
 *   cursor. A failed request said nothing at all, so the cursor it would have
 *   resumed from is exactly where it was — which is what makes a retry a retry
 *   rather than a guess.
 * - **A failure suspends the walk without lying about it.** `hasMore` keeps
 *   reporting what the server said; what stops the sentinel firing again is the
 *   standing `loadMoreError`, which only an explicit retry clears.
 * - **A response that lands after a reset is dropped.** The subject changed, so
 *   appending would put one board's trades under another's count.
 */

/** What the board has walked, and what went wrong doing it. */
export type TradesPages = {
  /** The board so far, folded as pages arrive. Null before the first lands. */
  fold: TradesFold | null;
  /** Where to resume, or null where the server named no more. */
  nextCursor: string | null;
  /** The board is exhausted — a page landed and named no cursor. */
  done: boolean;
  /** The first page failed; there is nothing to show. */
  error: string | null;
  /** A later page failed, behind trades that are on screen and stay there. */
  loadMoreError: string | null;
};

/** Nothing asked for yet — and the shape a subject change resets to. */
export const EMPTY_PAGES: TradesPages = {
  fold: null,
  nextCursor: null,
  done: false,
  error: null,
  loadMoreError: null,
};

/** The board a successful first page makes. */
export function firstPageLoaded(page: TradesPagePayload): TradesPages {
  return {
    fold: appendTradePage(null, page),
    nextCursor: page.nextCursor,
    done: page.nextCursor === null,
    error: null,
    loadMoreError: null,
  };
}

/**
 * A first page that failed.
 *
 * `done` is true here and only here: there is no cursor to resume from, so
 * there is nothing for a sentinel to do — and the page is showing the error
 * rather than a list, so there is no sentinel on screen either. The way back is
 * {@link TradesState.retry}, which starts the subject over.
 */
export function firstPageFailed(message: string): TradesPages {
  return { ...EMPTY_PAGES, done: true, error: message };
}

/**
 * A later page that landed.
 *
 * A `null` fold means the board was reset while this was in the air — a filter
 * changed, or the reader navigated — and the page belongs to a question nobody
 * is asking any more.
 */
export function morePageLoaded(
  previous: TradesPages,
  page: TradesPagePayload,
): TradesPages {
  if (previous.fold === null) return previous;
  return {
    // Skips a trade already on the board, so a page that arrives twice — a
    // retry racing a response that was slow rather than lost — cannot
    // duplicate a row.
    fold: appendTradePage(previous.fold, page),
    nextCursor: page.nextCursor,
    done: page.nextCursor === null,
    error: null,
    loadMoreError: null,
  };
}

/**
 * A later page that failed.
 *
 * **Everything about the board is left exactly as it was.** The fold, the
 * cursor and `done` are untouched: the cards stay on screen, the walk resumes
 * from the same place, and the board is not marked finished. Only the note
 * changes, and the list draws it under the last card with a key beside it.
 */
export function morePageFailed(
  previous: TradesPages,
  message: string,
): TradesPages {
  return { ...previous, loadMoreError: message };
}

/** Clear a standing failure, which is what a retry does before it fetches. */
export function retryingMore(previous: TradesPages): TradesPages {
  return { ...previous, loadMoreError: null };
}

/**
 * Whether another page may be asked for.
 *
 * `force` is the retry: it is the one thing that gets past a standing failure,
 * which is what keeps the sentinel — still watching, because `hasMore` is still
 * true — from retrying against a failing route on every scroll event.
 *
 * `busy` is the caller's synchronous in-flight ref rather than its `loadingMore`
 * state, and that is the guard that stops a retry duplicating a page: a value a
 * render closed over is `false` for both of two calls in one frame.
 */
export function canLoadMore(
  pages: TradesPages,
  options: { loading: boolean; busy: boolean; force: boolean },
): boolean {
  if (pages.nextCursor === null) return false;
  if (options.loading || options.busy) return false;
  return options.force || pages.loadMoreError === null;
}

/**
 * Whether the server says there is more.
 *
 * **Never error state.** A failed request is a fact about the request, and
 * reporting it as the end of the board would tell the reader they had reached
 * the bottom of a list they had not.
 */
export function pagesHaveMore(pages: TradesPages): boolean {
  return pages.nextCursor !== null && !pages.done;
}

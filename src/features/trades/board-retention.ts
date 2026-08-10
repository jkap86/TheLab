/**
 * How many *abandoned* trade boards the cache keeps.
 *
 * The board's own retention is already argued in `hooks/use-trades`: pages are
 * never evicted (a keyset walk has no previous-page path to read a dropped one
 * back with), and a filter change is a different key rather than an
 * invalidation, so widening back finds the old board still loaded with the
 * reader's scroll position. Both are worth keeping and neither is what this is
 * about.
 *
 * What it is about is *how many* of those a reader can accumulate. Every filter
 * set is its own entry holding every page scrolled through it plus every player,
 * manager, price and pick slot those pages named, and `TRADES_GC_TIME` retires
 * one only five minutes after the last reader lets go. Five minutes is a long
 * time at the keyboard: a reader working through a search — three managers, then
 * a player, then a wider window, then back — mints an entry per press and holds
 * all of them at once. On a phone that is the same budget the shares sheet was
 * discarding pages over.
 *
 * So the bound is on the *count*, not on the time, which is what makes it safe:
 * the entries that get dropped are the ones nobody has looked at for longest,
 * the board on screen is never one of them, and neither is the one the reader
 * just came from — {@link TRADE_BOARDS_KEPT} is deliberately more than the one
 * that would make "widen back" a hit, because coming back two steps is as
 * ordinary as coming back one.
 *
 * Pure, and separate from the hook, for the reason `trades-data` and
 * `incremental` are: what it decides is invisible on screen in both directions.
 * Too eager and a reader loses a board they were about to return to; too lazy
 * and it does nothing at all, which profiles as "the bound didn't help" rather
 * than as a bug.
 */

/**
 * Abandoned boards kept beside the one on screen.
 *
 * Three rather than one: the board a reader just left is the obvious one to
 * keep, and the two before it cover the back-and-forth that a bank of filters
 * invites — narrow, look, widen, narrow differently. Past that a board is
 * something the reader moved on from several presses ago, and re-reading its
 * first page costs one request against holding every page they ever scrolled.
 */
export const TRADE_BOARDS_KEPT = 3;

/** One cached board, as much of it as the decision depends on. */
export type TradeBoardEntry = {
  /** The board's own key — the normalised query string. */
  key: string;
  /** When its data last arrived; the recency the bound is read against. */
  updatedAt: number;
  /** Components currently reading it. Non-zero is a board on screen. */
  observers: number;
};

/**
 * Which cached boards to drop, given the one now being read.
 *
 * Two exclusions carry the safety, and both are absolute rather than a matter of
 * ordering. **A board with observers is never dropped** — it is on screen, or it
 * is the placeholder `keepPreviousData` is showing while the next one lands, and
 * removing either is a list blanking under someone's thumb. **The active key is
 * never dropped**, even before its first page has arrived and while its
 * `updatedAt` is therefore 0, which is exactly when a pure recency sort would
 * choose it first.
 *
 * The rest go oldest-first by when their data last arrived, which is the right
 * clock: it is when the reader last *looked* at that board, not when they first
 * built it. Ties break on the key so the answer is deterministic.
 */
export function retiredTradeBoards(
  boards: readonly TradeBoardEntry[],
  activeKey: string,
  keep: number = TRADE_BOARDS_KEPT,
): string[] {
  const candidates = boards.filter(
    (board) => board.key !== activeKey && board.observers === 0,
  );
  if (candidates.length <= keep) return [];

  return candidates
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
    .slice(keep)
    .map((board) => board.key);
}

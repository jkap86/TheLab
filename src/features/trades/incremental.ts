import type { Trade } from "@/shared/trades";

/**
 * Filtering a growing list without re-filtering the part of it that hasn't
 * changed.
 *
 * **The problem is the stream meeting the filters.** The page holds two filter
 * sets and applies both on the client over the whole season, which is the shape
 * those filters demand rather than a shortcut. That was fine when the season
 * arrived at once and stopped being fine when it started arriving in fifty
 * pieces: each piece is a new `trades` array, every `useMemo` over it re-runs,
 * and both passes walk the *whole* accumulated list again. Over a 50k-trade
 * season that is fifty passes averaging 25k trades each — ~1.2M predicate
 * evaluations to filter 50k trades, and the cost lands at the end of the stream
 * where the list is longest and the reader is already scrolling it.
 *
 * The observation this rests on is that **the trades only ever append**. A chunk
 * goes on the end and nothing before it moves, so a trade the filters have
 * already judged has already been judged correctly — the verdict on trade #400
 * does not depend on trade #40,000 existing. So a chunk costs only its own
 * length, and the whole season costs one pass rather than fifty partial ones.
 *
 * What that buys is not only CPU. The output arrays keep their identity when a
 * chunk adds nothing that matches, so a filtered-out chunk re-renders nothing
 * downstream — where a fresh `[]` every chunk would re-render the list, the
 * virtualizer and its measurement cache regardless.
 *
 * A full pass still happens, and the rule for when is the whole safety argument:
 * **anything that could change a verdict already reached forces one.** That is
 * what {@link filterGeneration} is for — the caller hands over a string that
 * changes whenever the predicate's meaning does, and a change to it throws the
 * accumulated answer away rather than appending to an answer computed under
 * different rules.
 */

/** What {@link advanceFiltered} carries between chunks. */
export type FilteredTrades = {
  /**
   * The generation the results below were computed under. Compared, never
   * interpreted — see {@link advanceFiltered}.
   */
  generation: string;
  /**
   * How many of the input trades have been judged. The next call starts here,
   * which is what makes a chunk cost its own length.
   */
  judged: number;
  /**
   * The id of the last trade judged, so the next call can check it is being
   * handed the *same* list extended rather than a different one of a compatible
   * length. Null before anything has been judged.
   */
  judgedThrough: string | null;
  /** Trades in a league the league filters admit, in arrival order. */
  inLeagues: readonly Trade[];
  /** Those of {@link inLeagues} the trade filters also admit. */
  visible: readonly Trade[];
};

export const EMPTY_FILTERED: FilteredTrades = {
  generation: "",
  judged: 0,
  judgedThrough: null,
  inLeagues: [],
  visible: [],
};

/**
 * Judge whatever is new in `trades` and append it to `previous`, or judge all of
 * it if the rules have changed since.
 *
 * `generation` is the caller's statement that the two predicates mean the same
 * thing they did last time. It is compared for equality and never read, so what
 * goes in it is the caller's problem — but it has to cover *everything* the
 * predicates close over, which on this page is both filter sets, the resolved
 * date bounds, and the league list itself where a league filter is active (a
 * league arriving late can change which trades its own filter admits). Getting
 * that wrong shows up as a stale list rather than as an error, which is why the
 * page derives it in one place.
 *
 * The append path also guards against `trades` having been *replaced* rather
 * than extended — a shorter list, or one whose already-judged prefix isn't the
 * same, is a different season or a reset, and falls back to a full pass. That is
 * belt and braces against the stream's own guarantee, and it costs one length
 * comparison and one identity check per chunk.
 */
export function advanceFiltered(
  previous: FilteredTrades,
  trades: readonly Trade[],
  generation: string,
  inLeague: (trade: Trade) => boolean,
  matches: (trade: Trade) => boolean,
): FilteredTrades {
  const appendable =
    previous.generation === generation &&
    previous.judged <= trades.length &&
    // The already-judged prefix is the same prefix: one identity check at the
    // boundary, which is the only place a replaced list of a compatible length
    // could otherwise slip through as an extension.
    previous.judgedThrough ===
      (previous.judged === 0
        ? null
        : (trades[previous.judged - 1]?.transaction_id ?? null));

  const from = appendable ? previous.judged : 0;
  if (appendable && from === trades.length) return previous;

  // Built only once something belongs in them, so a chunk that contributes
  // nothing hands the previous arrays straight back — which is what keeps the
  // list, the virtualizer and its measurement cache from re-rendering for a
  // change nobody can see. Late in a narrowed season most chunks are this.
  let inLeagues: Trade[] | null = appendable ? null : [];
  let visible: Trade[] | null = appendable ? null : [];

  for (let i = from; i < trades.length; i++) {
    const trade = trades[i];
    if (!inLeague(trade)) continue;
    (inLeagues ??= [...previous.inLeagues]).push(trade);
    if (matches(trade)) (visible ??= [...previous.visible]).push(trade);
  }

  return {
    generation,
    judged: trades.length,
    judgedThrough: trades[trades.length - 1]?.transaction_id ?? null,
    inLeagues: inLeagues ?? previous.inLeagues,
    visible: visible ?? previous.visible,
  };
}

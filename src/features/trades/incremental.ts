import type { Trade } from "@/shared/trades";

/**
 * The client's residual pass over trades the server has already filtered —
 * three-state, so a verdict is reached once and a trade that *can't* be judged
 * yet is the only thing ever reconsidered.
 *
 * **What this is for now.** Every filter is applied in SQL, so in the ordinary
 * case there is nothing left to do here and this is close to an identity
 * function, costing one predicate call per newly arrived trade. Two cases keep
 * it:
 *
 * - The league rules run on the client (they are a slot and scoring engine over
 *   Sleeper's JSONB, and a second copy in SQL would drift), so their *answer* is
 *   sent as `?leagues=`. Past ~500 ids that answer doesn't fit in a query string
 *   and the request goes unnarrowed — the page then narrows what comes back.
 * - The league list is its own request. A page whose leagues haven't landed yet
 *   cannot say whether a trade's league passes the rules.
 *
 * **The three states are what that second case needs.** The old accumulator had
 * two — in or out — so an unjudgeable trade had to be counted as *out*, and the
 * only way to correct that later was to throw the whole answer away and re-walk
 * everything. That was the `n${allowedLeagues.size}` segment in the page's
 * generation string: every league that arrived cost a full re-pass over every
 * trade held, and the passes got longer as the list grew. Now an unjudgeable
 * trade goes in a pending bucket, and league metadata arriving re-runs the
 * predicate over *that bucket alone* — bounded by how many trades arrived before
 * their leagues did, and usually zero.
 *
 * The observation the append path rests on is unchanged: **trades only ever
 * append**. A page goes on the end and nothing before it moves, so a verdict
 * already reached is still correct — trade #400's does not depend on #40,000
 * existing. What that buys beyond CPU is identity: when nothing new is admitted,
 * the output array is the previous one, so the list, the virtualizer and its
 * measurement cache re-render for nothing they could show.
 */

/** What the page can say about one trade. */
export type Verdict =
  | "allowed"
  /** Rejected, permanently — nothing arriving later can change this. */
  | "denied"
  /**
   * Not yet decidable, because the metadata the rules read hasn't arrived.
   * Reconsidered when — and only when — `leagueGeneration` changes.
   */
  | "unknown";

/** What {@link advanceFiltered} carries between pages. */
export type FilteredTrades = {
  /**
   * The generation the verdicts below were reached under: everything the
   * predicate closes over *except* the league metadata. Compared, never
   * interpreted; a change throws the whole answer away.
   */
  generation: string;
  /**
   * The league metadata's own generation. A change re-runs the predicate over
   * {@link FilteredTrades.pending} and nothing else, which is the point of the
   * split.
   */
  leagueGeneration: string;
  /** How many of the input trades have been judged. The next call starts here. */
  judged: number;
  /**
   * The id of the last trade judged, so the next call can check it is being
   * handed the *same* list extended rather than a different one of a compatible
   * length. Null before anything has been judged.
   */
  judgedThrough: string | null;
  /** Indices into the input, ascending — the admitted trades, in arrival order. */
  allowed: readonly number[];
  /** Indices into the input, ascending — awaiting metadata. */
  pending: readonly number[];
  /** {@link FilteredTrades.allowed} resolved against the input; what renders. */
  visible: readonly Trade[];
};

export const EMPTY_FILTERED: FilteredTrades = {
  generation: "",
  leagueGeneration: "",
  judged: 0,
  judgedThrough: null,
  allowed: [],
  pending: [],
  visible: [],
};

/**
 * Judge whatever is new, re-judge whatever was pending if the league metadata
 * moved, and leave everything else alone.
 *
 * `generation` is the caller's statement that the predicate means what it meant
 * last time, for every reason *other* than league metadata — the filter sets and
 * the resolved window. It is compared for equality and never read, so what goes
 * in it is the caller's problem, and getting it wrong shows up as a stale list
 * rather than as an error, which is why the page derives it in one place.
 *
 * `leagueGeneration` is the same statement about the leagues alone, and the
 * reason it is a second argument rather than another segment of the first: a
 * change to it must not discard verdicts, only revisit the ones that were never
 * reached. Splitting them is the difference between a league arriving costing a
 * walk of the pending bucket and it costing a walk of the season.
 *
 * The append path also guards against `trades` having been *replaced* rather
 * than extended — a shorter list, or one whose already-judged prefix isn't the
 * same, is a different query or a reset, and falls back to a full pass. That is
 * belt and braces against the query cache's own guarantee, and it costs one
 * length comparison and one identity check per page.
 */
export function advanceFiltered(
  previous: FilteredTrades,
  trades: readonly Trade[],
  generation: string,
  leagueGeneration: string,
  judge: (trade: Trade) => Verdict,
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

  if (!appendable) {
    return judgeAll(trades, generation, leagueGeneration, judge);
  }

  const metadataMoved = previous.leagueGeneration !== leagueGeneration;
  const fresh = trades.length - previous.judged;
  // Nothing new and nothing to reconsider: the cheapest call and by far the most
  // common one, and the one that keeps `visible`'s identity stable.
  if (fresh === 0 && !metadataMoved) return previous;

  // Re-judged only when the metadata moved, and only these.
  let resolved: number[] | null = null;
  let pending: number[] | null = null;
  if (metadataMoved && previous.pending.length > 0) {
    resolved = [];
    pending = [];
    for (const index of previous.pending) {
      const verdict = judge(trades[index]);
      if (verdict === "allowed") resolved.push(index);
      else if (verdict === "unknown") pending.push(index);
    }
  }

  const admitted: number[] = [];
  for (let i = previous.judged; i < trades.length; i++) {
    const verdict = judge(trades[i]);
    if (verdict === "allowed") admitted.push(i);
    else if (verdict === "unknown") (pending ??= [...previous.pending]).push(i);
  }

  if (admitted.length === 0 && !resolved?.length && pending === null) {
    // Judged further, admitted nothing: `visible` and `allowed` keep their
    // identity, which is what stops a page of non-matches from re-rendering the
    // list and invalidating its measurement cache.
    return {
      ...previous,
      leagueGeneration,
      judged: trades.length,
      judgedThrough: lastId(trades),
    };
  }

  // `resolved` holds indices from *before* the new ones, so it merges into the
  // existing allowed list rather than appending — the list renders in arrival
  // order, and a trade whose league landed late still belongs where it arrived
  // rather than at the end.
  const allowed = resolved?.length
    ? merge(previous.allowed, resolved).concat(admitted)
    : previous.allowed.concat(admitted);

  return {
    generation,
    leagueGeneration,
    judged: trades.length,
    judgedThrough: lastId(trades),
    allowed,
    pending: pending ?? previous.pending,
    visible: allowed.map((index) => trades[index]),
  };
}

/** A cold pass: the generation changed, or the list is not the one we judged. */
function judgeAll(
  trades: readonly Trade[],
  generation: string,
  leagueGeneration: string,
  judge: (trade: Trade) => Verdict,
): FilteredTrades {
  const allowed: number[] = [];
  const pending: number[] = [];
  for (let i = 0; i < trades.length; i++) {
    const verdict = judge(trades[i]);
    if (verdict === "allowed") allowed.push(i);
    else if (verdict === "unknown") pending.push(i);
  }
  return {
    generation,
    leagueGeneration,
    judged: trades.length,
    judgedThrough: lastId(trades),
    allowed,
    pending,
    visible: allowed.map((index) => trades[index]),
  };
}

/** Two ascending index lists into one. Both are sorted, so this is linear. */
function merge(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    out.push(a[i] <= b[j] ? a[i++] : b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

const lastId = (trades: readonly Trade[]) =>
  trades.length === 0 ? null : trades[trades.length - 1].transaction_id;

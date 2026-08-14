/**
 * How per-entry history rows become one peak and one trend per Sleeper player.
 *
 * The same duplicate problem `./values` documents — `sleeper_id` is resolved by
 * name, so two KTC entries can legitimately map to one player — met by the same
 * arrangement: `./queries` selects per-entry rows and this fold, pure and
 * tested, decides. The rules differ from `foldKtcValues`'s because the shapes
 * do:
 *
 * - **Peak is a max across every row.** A career high is a career high
 *   whichever of a player's entries carried it, exactly the per-board-highest
 *   reading the values fold takes.
 * - **Trend comes from one row, never a crossed pair.** A delta between row A's
 *   as-of price and row B's earlier price would be a move no series recorded —
 *   the `ktcPickDiscount` lesson about reading both ends off one row. The row
 *   that speaks for the player is the one with the highest as-of value (the row
 *   the values fold would surface for the same date), and if *that* row has no
 *   earlier endpoint the trend is null, even when some other row has one.
 */

/** One KTC entry's history stats at an anchor, as the read selects them. */
export type KtcSfHistoryRow = {
  sleeper_id: string;
  /** Highest superflex value on record at or before the anchor. */
  peak_sf: number | null;
  /** The as-of value at the anchor (within the lookback window), if any. */
  asof_sf: number | null;
  /** The as-of value one trend window earlier, if any. */
  prior_sf: number | null;
};

/** A player's history read: career-peak SF value and the windowed move. */
export type KtcSfHistory = { peak: number | null; trend: number | null };

/**
 * Whether a row outranks the current winner: higher as-of value, and on a tie
 * the higher earlier endpoint (null lowest). The tiebreak exists so the answer
 * cannot depend on row order — the property the values fold also keeps.
 */
function beats(row: KtcSfHistoryRow, seen: KtcSfHistoryRow): boolean {
  const asof = row.asof_sf as number;
  if (seen.asof_sf === null || asof > seen.asof_sf) return true;
  if (asof < seen.asof_sf) return false;
  return (row.prior_sf ?? -Infinity) > (seen.prior_sf ?? -Infinity);
}

export function foldKtcSfHistory(
  rows: readonly KtcSfHistoryRow[],
): Record<string, KtcSfHistory> {
  // The row whose trend speaks for the player, tracked beside the fold so the
  // choice is by as-of value and never by row order.
  const best = new Map<string, KtcSfHistoryRow>();
  const out: Record<string, KtcSfHistory> = {};

  for (const row of rows) {
    const current = out[row.sleeper_id];
    const peak =
      current === undefined || current.peak === null
        ? row.peak_sf
        : row.peak_sf === null
          ? current.peak
          : Math.max(current.peak, row.peak_sf);

    const seen = best.get(row.sleeper_id);
    if (row.asof_sf !== null && (seen === undefined || beats(row, seen))) {
      best.set(row.sleeper_id, row);
    }

    out[row.sleeper_id] = { peak, trend: current?.trend ?? null };
  }

  for (const [id, row] of best) {
    out[id] = {
      peak: out[id].peak,
      trend:
        row.asof_sf !== null && row.prior_sf !== null
          ? row.asof_sf - row.prior_sf
          : null,
    };
  }

  return out;
}

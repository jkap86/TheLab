import type { MetricRank } from "@/shared/contract";

// Relative with an explicit extension: this module is read by Node's test
// runner, which resolves neither the `@/*` aliases nor the shared barrel.
import { ordinal } from "../../shared/format.ts";

/**
 * A rank cell's text. The em dash covers both "no answer yet" (the payload
 * has not landed) and "nothing to rank" (the metric was degenerate
 * league-wide) — the reader's next move is the same either way.
 */
export function formatRank(rank: MetricRank | null): string {
  if (!rank) return "—";
  return `${ordinal(rank.rank)} of ${rank.of}`;
}

/**
 * How full a tile's meter is: 100% for 1st, 0% for last.
 *
 * **`of - 1` is the divisor, not `of`.** A meter that ran `rank / of` would
 * leave 1st of 12 sitting at 92% and last of 12 at 8%, so neither end of the
 * scale would ever be reached and the bar would read as a broken gauge rather
 * than as a position. A one-roster league (`of === 1`) has no spread to show
 * and draws empty, as does a null rank.
 */
export function rankFill(rank: MetricRank | null): number {
  if (!rank || rank.of <= 1) return 0;
  return Math.round((1 - (rank.rank - 1) / (rank.of - 1)) * 100);
}

/**
 * The percentile a rank's *colour* is taken from, or null where there is no
 * position to colour.
 *
 * It exists because {@link rankFill} answers 0 to two different questions.
 * Last of twelve is 0 and so is "nothing to rank" — a null rank, or a
 * one-roster league with no spread — and the meter is right to draw both
 * empty. The ramp is not: painting an absent answer in full red claims a
 * result the page has not been given. So the degenerate cases come back as
 * null here and land on the neutral, and only a real last place is red.
 */
export function rankPercentile(rank: MetricRank | null): number | null {
  if (!rank || rank.of <= 1) return null;
  return rankFill(rank);
}

/*
 * The ramp itself now lives in `features/shared`, because the lineup checker's
 * projected-outcome pip draws from it too. Re-exported here rather than moved
 * out of every caller's import: the tiles below read a rank's colour and its
 * meter's width from one place, and splitting the pair across two modules is
 * how the bar and the hue would come to disagree.
 *
 * Relative with an extension, like `ordinal` above — Node's test runner
 * resolves neither the alias nor the barrel.
 */
export { rankColor } from "../../shared/rank-ramp.ts";

/**
 * Where one figure sits among the league's, as a rank the meters and the ramp
 * above can read.
 *
 * The server ranks the nine metrics a card's tiles show; this is the same
 * reading taken client-side for a figure it does not rank — today the bench
 * total under whichever lens the expanded card is on, which changes with a
 * control rather than with the payload. It is **standard competition ranking**,
 * the same rule `MetricRank` documents: tied figures share the better rank and
 * the next distinct one skips.
 *
 * Null where there is nothing to rank, which is two cases and not one: a field
 * of fewer than two, and a field where every figure is zero — a league with no
 * projections read, or one whose KeepTradeCut board could not be. "1st of 12"
 * among all-zero totals is a claim, which is exactly why `LineupRanks` ships
 * null for it rather than a rank.
 */
export function placeAmong(
  value: number,
  all: readonly number[],
): MetricRank | null {
  if (all.length <= 1 || all.every((figure) => figure === 0)) return null;
  return { rank: all.filter((figure) => figure > value).length + 1, of: all.length };
}

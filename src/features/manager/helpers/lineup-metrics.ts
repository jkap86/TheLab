import type { MetricRank } from "@/shared/contract";

// Relative with an explicit extension: this module is read by Node's test
// runner, which resolves neither the `@/*` aliases nor the shared barrel.
import { ordinal } from "../../shared/format.ts";

/**
 * A rank cell's text. The em dash covers both "no answer yet" (the payload
 * has not landed) and "nothing to rank" (the metric was degenerate
 * league-wide) — the reader's next move is the same either way.
 *
 * **The field size is not printed, and that is a deliberate reversal.** It used
 * to read `2nd of 12`, which put a nine- or ten-character string in a tile that
 * takes an equal quarter of a card: at four columns the figure was the widest
 * thing on the row and read as a sentence rather than as a reading. The
 * denominator survives in exactly one place on the card — the configuration
 * window's `Teams` field — where it is the scale every other count beside it is
 * read against, and it survives in the *maths* here unchanged: {@link rankFill}
 * and {@link rankPercentile} both still divide by `rank.of`, so the meter and
 * the ramp know the field size even though the text no longer states it.
 */
export function formatRank(rank: MetricRank | null): string {
  if (!rank) return "—";
  return ordinal(rank.rank);
}

/*
 * The ramp and the three readings it is fed from now live in
 * `features/shared`: the lineup checker's projected-outcome pip draws the same
 * green and red, and the league detail's standings pane — which moved to that
 * folder with the history rail — draws its own meters and places its own bench.
 * A module there cannot import one from `features/manager`, so they went rather
 * than being reached back for.
 *
 * Re-exported here rather than moved out of every caller's import: the tiles
 * read a rank's colour and its meter's width from one place, and splitting the
 * pair across two modules is how the bar and the hue would come to disagree.
 *
 * Relative with an extension, like `ordinal` above — Node's test runner
 * resolves neither the alias nor the barrel.
 */
export {
  placeAmong,
  rankColor,
  rankFill,
  rankPercentile,
} from "../../shared/rank-ramp.ts";

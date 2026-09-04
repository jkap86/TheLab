/**
 * What identifies a rank column, now that a KeepTradeCut column carries its own
 * market and QB board.
 *
 * A column used to *be* its metric id: nine metrics, at most four chosen, and a
 * card's ranks keyed by the same nine names the server produced. Moving the two
 * KTC axes into the column makes the same metric able to sit in two bays —
 * "KTC total, dynasty, superflex" beside "KTC total, dynasty, 1QB" — so a
 * second name is needed for the second reading, and every surface that names a
 * column has to spell it the same way. That spelling is {@link lineupColumnKey}
 * and this file is its only home: the client stores columns, the request names
 * the variants it needs, the route ranks them and the card reads them back, and
 * a key spelled twice is a rank quietly attributed to the wrong board.
 *
 * It lives in `shared/ktc` rather than beside the contract because both axes
 * are this folder's vocabulary and the whole reason a column needs a key at all
 * is that they exist. Pure, and free of runtime imports — the client half of
 * the columns store deep-imports it exactly as it already deep-imports
 * `./board-choice` and `./roster`, neither of which may reach this folder's
 * server-only barrel.
 */

import type {
  KtcBoardChoice,
  KtcLineupChoice,
  LineupColumn,
  LineupMetricId,
} from "@/shared/contract";

import { parseKtcBoardChoice, parseKtcLineupChoice } from "./board-choice.ts";

/**
 * Which metrics read a KeepTradeCut board, as the third exhaustive
 * `Record<LineupMetricId, …>` in the app — the compiler seam `METRIC_ORDER` and
 * `LINEUP_METRIC_LABELS` are the other two. A new metric id breaks this until
 * somebody says whether it has a market, which is the question that decides
 * whether its column carries two axes or ignores them.
 */
const READS_A_MARKET: Record<LineupMetricId, boolean> = {
  ros_starters: false,
  ros_bench: false,
  capital_total: false,
  capital_bench: false,
  capital_starters: false,
  ktc_total: true,
  ktc_starters: true,
  ktc_bench: true,
  ktc_picks: true,
};

/** Whether this metric is priced on a market, and therefore carries the axes. */
export function isKtcMetric(metric: LineupMetricId): boolean {
  return READS_A_MARKET[metric];
}

/**
 * One pricing a KTC metric can be read on: a market choice and a QB-board
 * choice, both still *choices* rather than a league's resolved answer.
 *
 * Unresolved on purpose. `auto` on either axis is a rule about each league, so
 * a page of a hundred leagues reading `auto:auto` is one variant and not a
 * hundred — which is exactly what makes the request short and the ranking
 * cheap. The resolution happens per league, inside the route, against the same
 * `resolveKtcFormat` / `resolveKtcLineup` the card labels its tile with.
 */
export type KtcVariant = { format: KtcBoardChoice; lineup: KtcLineupChoice };

/**
 * The variant every column opens on and the one the nine base ranks are
 * computed for: the league's own market, the league's own QB board.
 */
export const AUTO_VARIANT: KtcVariant = { format: "auto", lineup: "auto" };

/** True where a variant is the one the base ranks already answer. */
export function isAutoVariant(variant: KtcVariant): boolean {
  return variant.format === "auto" && variant.lineup === "auto";
}

/** `dynasty:sf` — one variant, as one token. */
export function ktcVariantKey(variant: KtcVariant): string {
  return `${variant.format}:${variant.lineup}`;
}

/**
 * How a column is named wherever a rank is keyed by one.
 *
 * **A column on `auto` is keyed by its bare metric id**, which is what keeps
 * the nine base ranks readable without the client having to know what the
 * server resolved: `auto` is the pricing every league reads for itself, so the
 * base ranks *are* that column's answer. Anything forcing an axis takes the
 * triple. The five non-KTC metrics ignore both axes entirely, so they can never
 * name a second key — which is also why they can never occupy two bays.
 */
export function lineupColumnKey(column: LineupColumn): string {
  if (!isKtcMetric(column.metric)) return column.metric;
  const variant = { format: column.format, lineup: column.lineup };
  return isAutoVariant(variant)
    ? column.metric
    : `${column.metric}:${ktcVariantKey(variant)}`;
}

/**
 * The distinct non-`auto` variants a set of columns needs ranked, which is what
 * the request carries.
 *
 * **The variants and not the columns**, and the difference is a round trip. The
 * ranks a column reads are the four KTC metrics of its own variant, so the
 * request only has to name the *pricings* — deduped, and with `auto:auto`
 * dropped because the base ranks always ship. That is what keeps adding a ROS
 * column, or a KTC column on the league's own board, free of a refetch, while a
 * forced market costs the one it has always cost.
 */
export function ktcVariantsOf(
  columns: readonly LineupColumn[],
): KtcVariant[] {
  const seen = new Map<string, KtcVariant>();
  for (const column of columns) {
    if (!isKtcMetric(column.metric)) continue;
    const variant = { format: column.format, lineup: column.lineup };
    if (isAutoVariant(variant)) continue;
    seen.set(ktcVariantKey(variant), variant);
  }
  return [...seen.values()];
}

/**
 * Read the request's variant list back.
 *
 * Every token folds to something valid — an unreadable half becomes `auto`, on
 * `parseKtcBoardChoice`'s terms — and `auto:auto` is dropped, since the base
 * ranks answer it. A garbled parameter therefore costs the columns that named
 * it their forced board and nothing else, which is the same degradation an
 * unreadable `?ktc_board=` always had.
 */
export function parseKtcVariants(value: string | null): KtcVariant[] {
  if (!value) return [];
  return ktcVariantsOf(
    value
      .split(",")
      .filter(Boolean)
      .map((token) => {
        const [format, lineup] = token.split(":");
        return {
          // A metric that is priced, so the variant survives `ktcVariantsOf`'s
          // own filter — the list is variants, not columns.
          metric: "ktc_total" as LineupMetricId,
          format: parseKtcBoardChoice(format),
          lineup: parseKtcLineupChoice(lineup),
        };
      }),
  );
}

/** The request's spelling of a variant list — `dynasty:sf,redraft:auto`. */
export function serializeKtcVariants(variants: readonly KtcVariant[]): string {
  return variants.map(ktcVariantKey).join(",");
}

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
 * is that they exist. **The QB-board axis has since grown a second reader** —
 * the three capital metrics, whose ADP fold splits superflex drafts from
 * standard ones exactly as KeepTradeCut splits its two columns — so this file
 * names what prices each metric rather than which are KTC's, and a capital
 * column that has forced a board takes a key of its own (`capital_total:sf`).
 * The vocabulary is still `shared/ktc`'s: {@link KtcLineupChoice} and
 * `resolveKtcLineup` are one question about a league, asked by two valuations. Pure, and free of runtime imports — the client half of
 * the columns store deep-imports it exactly as it already deep-imports
 * `./board-choice` and `./roster`, neither of which may reach this folder's
 * server-only barrel.
 */

import type {
  KtcBoardChoice,
  KtcLineupChoice,
  LineupColumn,
  LineupMetricId,
  LineupPosition,
  LineupSlot,
} from "@/shared/contract";

import { FANTASY_POSITIONS } from "../projections/positions.ts";
import { STARTING_SLOTS } from "../projections/starting-slots.ts";
import { parseKtcBoardChoice, parseKtcLineupChoice } from "./board-choice.ts";

/**
 * What prices a metric, as the third exhaustive `Record<LineupMetricId, …>` in
 * the app — the compiler seam `METRIC_ORDER` and `LINEUP_METRIC_LABELS` are the
 * other two. A new metric id breaks this until somebody says what values it,
 * which is the question that decides which of the two pricing axes its column
 * carries.
 *
 * **One record rather than one per axis**, because the three questions below
 * are three readings of one fact and asking them separately is how a metric
 * could come to read a market it is not priced on. The three answers are:
 *
 * - `"none"` — points, scored under the league's own scoring settings. No board
 *   enters them, so a projection column carries neither axis.
 * - `"adp"` — the draft-capital curve, off the drafts this manager's leagues
 *   actually ran. There is no ADP *market* — nobody publishes a second one —
 *   but the fold does split superflex drafts from standard ones, because a
 *   quarterback goes at a wholly different point on the two boards. So a
 *   capital column carries the QB board axis and not the market one.
 * - `"ktc"` — KeepTradeCut, which publishes two markets and prices every entry
 *   on both QB boards. Both axes.
 */
type PricedBy = "none" | "adp" | "ktc";

const PRICED_BY: Record<LineupMetricId, PricedBy> = {
  ros_total: "none",
  ros_starters: "none",
  ros_bench: "none",
  capital_total: "adp",
  capital_bench: "adp",
  capital_starters: "adp",
  ktc_total: "ktc",
  ktc_starters: "ktc",
  ktc_bench: "ktc",
  ktc_picks: "ktc",
};

/**
 * Whether this metric is priced on a KeepTradeCut market, and therefore carries
 * the market axis as well as the QB one.
 */
export function isKtcMetric(metric: LineupMetricId): boolean {
  return PRICED_BY[metric] === "ktc";
}

/** Whether this metric is priced off ADP, and therefore carries the QB axis alone. */
export function isAdpMetric(metric: LineupMetricId): boolean {
  return PRICED_BY[metric] === "adp";
}

/**
 * Whether this metric splits on how a league starts quarterbacks — which both
 * priced valuations do, and no projection does.
 *
 * The question the picker asks to decide whether to draw the QB-board track,
 * and the one {@link lineupColumnKey} asks before letting a forced board name a
 * second column. It is deliberately *not* `isKtcMetric || isAdpMetric` spelled
 * at each call site: a third valuation arriving would have to answer it here
 * once rather than in every reader.
 */
export function readsQbBoard(metric: LineupMetricId): boolean {
  return PRICED_BY[metric] !== "none";
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
 * The variant every column opens on and the one the ten base ranks are
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
 * the ten base ranks readable without the client having to know what the
 * server resolved: `auto` is the pricing every league reads for itself, so the
 * base ranks *are* that column's answer. Anything forcing an axis takes the
 * triple. The five non-KTC metrics ignore both axes entirely, so they can never
 * name a second key — which is also why they can never occupy two bays.
 */
export function lineupColumnKey(column: LineupColumn): string {
  return (
    pricedKey(column) +
    slotKeySuffix(column.slots) +
    positionKeySuffix(column.positions)
  );
}

/**
 * The key a column had before the position axis: metric, then whatever pricing
 * it has *forced* — and nothing at all where it has forced none.
 *
 * Three arms, one per answer in {@link PRICED_BY}, and each folds an axis the
 * metric does not read back to `auto` rather than trusting the column: a stray
 * board on a projections column must never become a second, indistinguishable
 * copy of it. `column()` on the client already forces the same two, so this is
 * a belt to its braces — and the belt is what a stored value hand-edited or
 * written by an older build meets first.
 *
 * **A metric priced on ADP takes the QB board alone** — `capital_total:sf` —
 * rather than the KeepTradeCut triple with a meaningless `auto` market in it.
 * The two spellings are disjoint and neither is ever parsed back (see
 * {@link positionKeySuffix}); what matters is that the server composes the same
 * ones, which it does through {@link qbBoardKeySuffix} and
 * {@link ktcVariantKey} rather than through a second copy of this.
 */
function pricedKey(column: LineupColumn): string {
  if (isKtcMetric(column.metric)) {
    const variant = { format: column.format, lineup: column.lineup };
    return isAutoVariant(variant)
      ? column.metric
      : `${column.metric}:${ktcVariantKey(variant)}`;
  }
  if (!readsQbBoard(column.metric)) return column.metric;
  return `${column.metric}${qbBoardKeySuffix(column.lineup)}`;
}

/**
 * What a forced QB board adds to the key of a metric that reads one and no
 * market — nothing at all for `auto`.
 *
 * **Exported, because the route composes the same suffix from the other end**,
 * exactly as it does {@link positionKeySuffix}: a rank is a base metric key
 * plus this plus the position clause, where a column is
 * {@link lineupColumnKey} whole. Two entry points to one spelling, and not even
 * the separator repeated.
 *
 * `auto` folding away is the same rule the market axis lives by and for the
 * same reason: `auto` is the pricing every league reads for itself, so the base
 * ranks *are* that column's answer and renaming them would fill the card with
 * em dashes.
 */
export function qbBoardKeySuffix(lineup: KtcLineupChoice): string {
  return lineup === "auto" ? "" : `:${lineup}`;
}

/**
 * The position clause a narrowed column's key ends with, or nothing at all.
 *
 * **An un-narrowed column keys exactly as it always did**, which is the whole
 * of why this is a suffix rather than a segment: the ten base ranks the route
 * always ships are filed under bare metric ids, and appending an `all` token to
 * every key would rename every one of them — a card looking up a rank the
 * server had computed under another name, with an em dash where a number was.
 * It is the same argument {@link lineupColumnKey} already makes for folding
 * `auto:auto` away, one axis over.
 *
 * The token is the set joined by `+`, lower-cased, in the order
 * {@link normalizeLineupPositions} put it in — so two bays narrowed to the same
 * two positions in different press orders are one column and dedupe as one,
 * which is what the sort in that function exists for.
 *
 * **The key is written here and read as an opaque lookup, never parsed back**,
 * so the two vocabularies sharing a `:` costs nothing — and they are disjoint
 * anyway, no position being spelled `auto`, `dynasty`, `redraft`, `oneqb` or
 * `sf`. The request carries the axes themselves (see {@link parsePositionSets}),
 * not these strings.
 *
 * **Exported, because the route composes the same suffix from the other end.**
 * A rank is filed under a base metric key plus this, where a column is named by
 * {@link lineupColumnKey} whole — two entry points to one spelling rather than
 * two spellings a test has to keep in step, which is the standing rule of this
 * file: the client writes the key and the server writes the key, and a
 * separator repeated in two places is a separator that can come to differ.
 */
export function positionKeySuffix(
  positions: readonly LineupPosition[],
): string {
  return positions.length === 0 ? "" : `:${positionSetKey(positions)}`;
}

/**
 * The distinct non-empty position sets a selection needs ranked, which is the
 * second thing the request carries.
 *
 * **The sets and not the columns**, exactly as {@link ktcVariantsOf} names
 * variants rather than columns and for the identical reason: a position set is
 * a second way to *total* the same solved lineups, so what the server needs is
 * the list of narrowings, and every metric of every one of them falls out of
 * the solves it already ran. The empty set is dropped because the base ranks
 * are its answer — which is what keeps a reader who never touches this axis on
 * exactly the request they had.
 */
export function positionSetsOf(
  columns: readonly LineupColumn[],
): LineupPosition[][] {
  const seen = new Map<string, LineupPosition[]>();
  for (const column of columns) {
    if (column.positions.length === 0) continue;
    seen.set(positionSetKey(column.positions), [...column.positions]);
  }
  return [...seen.values()];
}

/** `qb+te` — one position set, as one token. */
export function positionSetKey(
  positions: readonly LineupPosition[],
): string {
  return positions.map((one) => one.toLowerCase()).join("+");
}

/**
 * Fold anything into a valid position set: known positions only, deduped, in
 * the solver's own canonical order.
 *
 * The order is {@link FANTASY_POSITIONS}' — derived from `SLOT_POSITIONS`, so
 * the axis cannot come to disagree with the table the solver seats from — and
 * sorting rather than preserving press order is what makes a set an identity: a
 * reader who pressed `TE` then `QB` and one who pressed them the other way are
 * asking one question, and two keys for it would be two columns of the same
 * numbers a rack could hold at once.
 */
export function normalizeLineupPositions(
  value: unknown,
): LineupPosition[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const upper = entry.toUpperCase();
    if (FANTASY_POSITIONS.includes(upper)) chosen.add(upper);
  }
  return FANTASY_POSITIONS.filter((one) => chosen.has(one)) as LineupPosition[];
}

/**
 * Read the request's position-set list back — `qb+te,rb`.
 *
 * Every token folds to something valid on {@link parseKtcVariants}' terms, and
 * a set that folds to *empty* is dropped rather than ranked: the base ranks
 * already answer the un-narrowed column, so a garbled parameter costs the
 * columns that named it their narrowing and nothing else. That is the same
 * degradation an unreadable `?ktc_boards=` has always had, and the opposite
 * call from `?season=` for the opposite reason — a narrowing that cannot be
 * read leaves an em dash on one window, where a season that cannot be read
 * would put one year's page under another's heading.
 */
export function parsePositionSets(
  value: string | null,
): LineupPosition[][] {
  if (!value) return [];
  const seen = new Map<string, LineupPosition[]>();
  for (const token of value.split(",")) {
    const positions = normalizeLineupPositions(token.split("+"));
    if (positions.length === 0) continue;
    seen.set(positionSetKey(positions), positions);
  }
  return [...seen.values()];
}

/** The request's spelling of a position-set list — `qb+te,rb`. */
export function serializePositionSets(
  sets: readonly (readonly LineupPosition[])[],
): string {
  return sets.map(positionSetKey).join(",");
}

/**
 * The slot clause a narrowed column's key carries, or nothing at all.
 *
 * **An `@` prefix, and it is the one thing here that is not
 * {@link positionKeySuffix}'s rule verbatim.** Both clauses are `+`-joined
 * lower-cased sets after a `:`, so `ros_starters:wr` and a slot set spelled the
 * same way would be one string for two different questions — a rank filed under
 * the seats a column counts, read back as the positions it counts. The prefix
 * is what keeps them apart, and it costs nothing: the key is written here and
 * read as an opaque lookup, never parsed back, and no slot and no position is
 * spelled with an `@`.
 *
 * Everything else is that function's argument unchanged. An un-narrowed column
 * keys exactly as it always did, which is why this is a suffix rather than a
 * segment — append an `@all` token to every key and every card on the page looks
 * up a rank the server filed under another name. The order is
 * {@link normalizeLineupSlots}', so two bays narrowed to the same seats in
 * different press orders are one column and dedupe as one.
 *
 * **Exported, because the route composes the same suffix from the other end.**
 * A rank is a base metric key plus the pricing plus this plus the position
 * clause, where a column is {@link lineupColumnKey} whole — two entry points to
 * one spelling, not even the separator repeated.
 */
export function slotKeySuffix(slots: readonly LineupSlot[]): string {
  return slots.length === 0 ? "" : `:@${slotSetKey(slots)}`;
}

/** `flex+super_flex` — one slot set, as one token. */
export function slotSetKey(slots: readonly LineupSlot[]): string {
  return slots.map((one) => one.toLowerCase()).join("+");
}

/**
 * The distinct non-empty slot sets a selection needs ranked, which is the
 * fourth thing the request carries.
 *
 * **The sets and not the columns**, on {@link positionSetsOf}' exact terms: a
 * slot set is a fourth way to *total* the same solved lineups, so what the
 * server needs is the list of narrowings and every metric of every one of them
 * falls out of the solves it already ran. The empty set is dropped because the
 * base ranks are its answer, which is what keeps a reader who never touches
 * this axis on exactly the request they had.
 */
export function slotSetsOf(
  columns: readonly LineupColumn[],
): LineupSlot[][] {
  const seen = new Map<string, LineupSlot[]>();
  for (const column of columns) {
    if (column.slots.length === 0) continue;
    seen.set(slotSetKey(column.slots), [...column.slots]);
  }
  return [...seen.values()];
}

/**
 * Fold anything into a valid slot set: startable slots only, deduped, in the
 * vocabulary's own canonical order.
 *
 * {@link normalizeLineupPositions}' rule one axis over, and the sort is what
 * makes a set an identity: a reader who pressed `SUPER_FLEX` then `FLEX` and
 * one who pressed them the other way are asking one question, and two keys for
 * it would be two columns of the same numbers a rack could hold at once.
 *
 * The vocabulary is the whole of {@link STARTING_SLOTS} and **not the slots the
 * reader's leagues happen to start**, which is the one place this is
 * deliberately wider than the track that writes it. The picker offers the
 * leagues' own union — a key for a seat nobody starts could never seat anybody —
 * but an account whose IDP league has since gone is a stored `@dl` that is
 * still a perfectly good question about the leagues it was asked of, and
 * dropping it here would silently widen that column to the whole lineup.
 */
export function normalizeLineupSlots(value: unknown): LineupSlot[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const upper = entry.toUpperCase();
    if (STARTING_SLOTS.includes(upper)) chosen.add(upper);
  }
  return STARTING_SLOTS.filter((one) => chosen.has(one)) as LineupSlot[];
}

/**
 * Read the request's slot-set list back — `flex+super_flex,qb`.
 *
 * **No `@` here, and that is not an inconsistency.** The prefix exists to keep
 * two clauses apart inside one key string; a parameter named `slots` has
 * nothing to be told apart from. Every token folds on
 * {@link parsePositionSets}' terms and a set that folds to empty is dropped
 * rather than ranked: the base ranks already answer the un-narrowed column, so
 * a garbled parameter costs the columns that named it their narrowing and
 * nothing else.
 */
export function parseSlotSets(value: string | null): LineupSlot[][] {
  if (!value) return [];
  const seen = new Map<string, LineupSlot[]>();
  for (const token of value.split(",")) {
    const slots = normalizeLineupSlots(token.split("+"));
    if (slots.length === 0) continue;
    seen.set(slotSetKey(slots), slots);
  }
  return [...seen.values()];
}

/** The request's spelling of a slot-set list — `flex+super_flex,qb`. */
export function serializeSlotSets(
  sets: readonly (readonly LineupSlot[])[],
): string {
  return sets.map(slotSetKey).join(",");
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
          // Un-narrowed on both axes, because a variant is a *pricing* and the
          // two narrowings travel on their own parameters — see
          // `parsePositionSets` and `parseSlotSets`. A set here would make one
          // narrowing's ranks the only ones a forced board got.
          positions: [],
          slots: [],
        };
      }),
  );
}

/** The request's spelling of a variant list — `dynasty:sf,redraft:auto`. */
export function serializeKtcVariants(variants: readonly KtcVariant[]): string {
  return variants.map(ktcVariantKey).join(",");
}

/**
 * The distinct QB boards the *capital* columns have forced, which is the third
 * thing the request carries.
 *
 * **The boards and not the columns**, on {@link ktcVariantsOf}' exact terms: a
 * QB board is a second way to *price* the same solved lineups, so what the
 * server needs is the list of boards and every capital metric of every one of
 * them falls out of the solves it was going to run anyway. `auto` is dropped
 * because the base ranks answer it — which is what keeps a reader who never
 * touches this axis on exactly the request they had.
 *
 * Separate from the KTC variant list rather than folded into it, because the
 * two name different things: a KTC variant is a market *and* a board, and a
 * capital column has no market to name. Folding them would send the ADP fold a
 * `dynasty` half it cannot read and would make `dynasty:sf` and `redraft:sf`
 * two capital pricings where there is only one.
 */
export function adpBoardsOf(
  columns: readonly LineupColumn[],
): KtcLineupChoice[] {
  const seen = new Set<KtcLineupChoice>();
  for (const column of columns) {
    if (!isAdpMetric(column.metric)) continue;
    if (column.lineup === "auto") continue;
    seen.add(column.lineup);
  }
  return [...seen];
}

/**
 * Read the request's ADP board list back — `sf,oneqb`.
 *
 * Every token folds through `parseKtcLineupChoice` and an unreadable one
 * becomes `auto`, which is then dropped: a garbled parameter costs the columns
 * that named it their forced board and nothing else, the degradation
 * {@link parseKtcVariants} already has and for the same reason.
 */
export function parseAdpBoards(value: string | null): KtcLineupChoice[] {
  if (!value) return [];
  const seen = new Set<KtcLineupChoice>();
  for (const token of value.split(",")) {
    const choice = parseKtcLineupChoice(token);
    if (choice !== "auto") seen.add(choice);
  }
  return [...seen];
}

/** The request's spelling of an ADP board list — `sf,oneqb`. */
export function serializeAdpBoards(
  boards: readonly KtcLineupChoice[],
): string {
  return boards.join(",");
}

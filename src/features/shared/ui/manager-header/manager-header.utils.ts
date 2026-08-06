import type { OverallRecord } from "../../record";
import type { HeaderProgress, HeaderSyncSummary } from "./manager-header.types.ts";

/**
 * The decisions the header makes before it draws anything: which of two paddings
 * a seam wants, whether the transient state line has anything to say, what the
 * refresh pill's digits are, and which segments the record bar carries.
 *
 * They live here rather than inline for the usual reason — each is a rule with a
 * reason behind it, and a rule spelled out in markup is a rule nothing tests. The
 * module value-imports nothing, so its tests run under Node's own runner.
 */

/**
 * The padding under the plate's body.
 *
 * The key is machined into the plate's bottom-right corner, so this is the seam
 * between it and the readout directly above — the dial, or the kickoff
 * countdown. It is measured against the *lit* case rather than the boxes: a
 * narrowed key glows and so does the countdown's running cell, and two lit faces
 * a few pixels apart read as one crowded part (the rule the old straddling key
 * spent 20px of clearance on downward). At `pb-5` that seam was 3px on a laptop,
 * which is exactly the failure; `pb-6` makes it 7px. Charged only where there is
 * a key.
 */
export function bodyPadding(hasFilters: boolean): string {
  return hasFilters ? "pb-6 sm:pb-6" : "pb-2 sm:pb-3";
}

/**
 * The padding around the transient state line.
 *
 * That line becomes the plate's bottom edge whenever it is drawn, so the key
 * seats itself in *its* corner instead and it needs the same clearance as
 * {@link bodyPadding}. It buys that below rather than to the right: reserving a
 * right-hand gutter wide enough for the key left ~190px of a 390px screen for two
 * pills that fit on one line before, so the one state the reader most wants to
 * read at a glance was the one that wrapped.
 */
export function statePadding(hasFilters: boolean): string {
  return hasFilters ? "px-5 pb-6 pt-2 sm:px-6" : "px-5 py-2 sm:px-6";
}

/**
 * Whether the state line has anything to say.
 *
 * It carries only what is transient — a refresh in flight, a sync that failed —
 * so it is drawn only when there is something to say: with the countdown up in
 * the readout slot, an always-present row would be an empty band under the record
 * for the whole season.
 */
export function hasSyncState({
  refreshing,
  summary,
  refreshError,
}: {
  refreshing?: boolean;
  summary?: HeaderSyncSummary;
  refreshError?: string | null;
}): boolean {
  return Boolean(
    refreshing || (summary && (summary.failed > 0 || summary.locked)) || refreshError,
  );
}

/**
 * What follows the word "Refreshing" — the league count where the stream is
 * reporting one, an ellipsis otherwise.
 *
 * Only a `refresh` phase counts: an `initial` sync is the cold load, which the
 * page shows as a loading state rather than as a pill over cached rows. A total
 * of zero has no fraction to write.
 */
export function refreshingSuffix(progress: HeaderProgress | null | undefined): string {
  return progress && progress.phase === "refresh" && progress.total > 0
    ? ` ${progress.loaded}/${progress.total}`
    : "…";
}

/** One band of the record bar — a count, and the tone that reads as its outcome. */
export type RecordBarPart = { key: string; count: number; tone: string };

/**
 * The record's three counts as the bands that carry them, zero-count bands
 * dropped so a tieless season doesn't reserve a sliver for its ties.
 *
 * Callers still branch on `record.games === 0` themselves: an unplayed season
 * keeps an empty rail rather than dropping the bar, so the plate is the same
 * height in September as in December, and that is a different state from "no
 * band happened to be non-zero".
 */
export function recordBarParts(record: OverallRecord): RecordBarPart[] {
  return [
    {
      key: "w",
      count: record.wins,
      tone: "bg-gradient-to-r from-active/50 to-active shadow-[0_0_10px_rgba(0,255,229,0.35)]",
    },
    { key: "l", count: record.losses, tone: "bg-foreground/[0.16]" },
    { key: "t", count: record.ties, tone: "bg-amber-400/50" },
  ].filter((part) => part.count > 0);
}

/**
 * The instant the readout counts down to, or null where there is nothing to
 * count.
 *
 * `scheduled` is {@link useKickoff}'s three-valued answer and each value means
 * something different: `undefined` is "still asking", where the header shows the
 * dial rather than a placeholder of its own — appearing once with the right
 * instant beats appearing twice with two — and `null` is Sleeper saying the
 * season isn't scheduled yet, which is the cue to fall back on the NFL calendar
 * table's provisional date.
 */
export function resolveKickoff(
  scheduled: number | null | undefined,
  provisional: number | null,
): number | null {
  return scheduled === undefined ? null : (scheduled ?? provisional);
}

import type { OverallRecord } from "../../record";
import type { HeaderProgress, HeaderSyncSummary } from "./manager-header.types.ts";

/**
 * The decisions the header makes before it draws anything: whether the transient
 * state line has anything to say, what the refresh pill's digits are, which
 * segments the record bar carries, and which instant the readout counts to.
 *
 * They live here rather than inline for the usual reason — each is a rule with a
 * reason behind it, and a rule spelled out in markup is a rule nothing tests. The
 * module value-imports nothing, so its tests run under Node's own runner.
 */

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
 * What a partly-refreshed sync has to say, or null where it has nothing.
 *
 * A refresh that dropped leagues to a Sleeper failure leaves the list below
 * mixed — most rows just refreshed, a few as old as the last pass — and the page
 * cannot otherwise be told apart from a complete one. It states the two counts
 * rather than the failure alone ("97 of 100 leagues refreshed" beats "3 failed
 * to sync") because what a reader needs is how much of what they are looking at
 * is current, and the failure count on its own leaves that to arithmetic.
 *
 * **Gated on actual failures, not on `complete`.** A summary is incomplete for
 * three reasons and only this one is worth a line: a sync that lost the lock has
 * its own note, and a throttled skip is ordinary operation — a warning on that
 * would sit on the plate through every quiet minute after an upstream hiccup.
 */
export function partialSyncNote(summary: HeaderSyncSummary): string | null {
  if (!summary || summary.failed <= 0) return null;
  return `${summary.leagues} of ${summary.total} leagues refreshed`;
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

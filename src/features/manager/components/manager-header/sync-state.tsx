import type { ReactNode } from "react";

import type { LeaguesResult, SyncProgress } from "../../types";
import { refreshingSuffix } from "./manager-header.utils.ts";

/**
 * The plate's state line: a refresh in flight, and the two ways a sync can leave
 * the list below incomplete.
 *
 * It carries only what is transient, so the caller draws it only where there is
 * something to say (`hasSyncState`) — with the countdown up in the readout slot,
 * an always-present row would be an empty band under the record for the whole
 * season. That is also what makes it the plate's bottom edge whenever it appears,
 * which is why the filters' key takes its clearance out of *this* padding then
 * (see `statePadding`).
 */
export function SyncStateLine({
  refreshing,
  progress,
  summary,
  refreshError,
  padding,
}: {
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
  refreshError?: string | null;
  /** The seam under the row — see `statePadding`, which is what sizes it. */
  padding: string;
}) {
  return (
    <div
      // The one part of the plate that appears and disappears, and every line in
      // it is something the page cannot otherwise be told apart from a complete
      // one: a refresh in flight, leagues that failed, a list another sync is
      // still filling in.
      role="status"
      className={`relative flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-foreground/10 text-[11px] ${padding}`}
    >
      {refreshing && <RefreshingPill progress={progress} />}
      {summary && summary.failed > 0 && (
        <Warning>{summary.failed} failed to sync</Warning>
      )}
      {/* A sync running elsewhere kept this one from writing, so the list below
          is whatever that one has committed so far — on a first visit, a
          fraction of it. Said out loud for the reason the failed-league count
          is: the page cannot otherwise be told apart from a complete one. */}
      {summary?.locked && (
        <Warning>Syncing elsewhere — this list may be incomplete</Warning>
      )}
      {refreshError && <Warning>Refresh failed — showing cached data</Warning>}
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-300">
      {children}
    </span>
  );
}

function RefreshingPill({ progress }: { progress: SyncProgress | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-active/30 bg-active/10 px-2.5 py-0.5 text-active">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-active/40 border-t-active"
      />
      Refreshing
      {/* The running tally is hidden from the live region around this: it moves
          once per league, and a polite region re-reading "Refreshing 41/121"
          every few hundred milliseconds is the announcement talking over the
          page it is describing. "Refreshing" is announced once and stays true. */}
      <span aria-hidden="true">{refreshingSuffix(progress)}</span>
    </span>
  );
}

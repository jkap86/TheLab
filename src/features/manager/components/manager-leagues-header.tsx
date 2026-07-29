import { Avatar } from "@/features/shared";

import type { LeaguesResult, SyncProgress } from "../types";

export function LeaguesHeader({
  user,
  leagueCount,
  totalCount,
  season,
  refreshing,
  progress,
  summary,
  refreshError,
}: {
  user: LeaguesResult["user"];
  leagueCount: number;
  totalCount: number;
  season: string;
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
  /**
   * A refresh that failed after cached leagues were already served. Shown as a
   * pill rather than replacing the page: the list below is stale, not wrong.
   */
  refreshError: string | null;
}) {
  const filtered = leagueCount !== totalCount;
  return (
    <header className="mb-8 border-b border-foreground/10 pb-6">
      <div className="flex items-center gap-4">
        <Avatar
          url={user.avatar_url}
          name={user.display_name || user.username}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-4xl font-semibold tracking-tight">
            {user.display_name || user.username}
          </h1>
          <p className="text-sm text-foreground/45">@{user.username}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-lg font-medium">
          {filtered ? (
            <>
              {leagueCount} of {totalCount} league{totalCount === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {totalCount} league{totalCount === 1 ? "" : "s"}
            </>
          )}
        </span>
        <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm text-foreground/55">
          {season}
        </span>
        {refreshing && <RefreshingPill progress={progress} />}
        {summary && summary.failed > 0 && (
          <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-sm text-amber-300">
            {summary.failed} failed to sync
          </span>
        )}
        {refreshError && (
          <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-sm text-amber-300">
            Refresh failed — showing cached leagues
          </span>
        )}
      </div>
    </header>
  );
}

function RefreshingPill({ progress }: { progress: SyncProgress | null }) {
  const suffix =
    progress && progress.phase === "refresh" && progress.total > 0
      ? ` ${progress.loaded}/${progress.total}`
      : "…";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-active/30 bg-active/10 px-3 py-1 text-sm text-active">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-active/40 border-t-active" />
      Refreshing{suffix}
    </span>
  );
}

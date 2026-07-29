import type { LeaguesResult, SyncProgress } from "../types";
import { ManagerHeader } from "./manager-header";

/**
 * The leagues view's header: the shared manager header, with how many leagues
 * are showing as its count line.
 */
export function LeaguesHeader({
  user,
  searched,
  leagueCount,
  totalCount,
  season,
  refreshing,
  progress,
  summary,
  refreshError,
}: {
  user: LeaguesResult["user"];
  searched: string;
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
    <ManagerHeader
      user={user}
      searched={searched}
      active="leagues"
      season={season}
      refreshing={refreshing}
      progress={progress}
      summary={summary}
      refreshError={refreshError}
    >
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
    </ManagerHeader>
  );
}

import type { LeaguesResult, SyncProgress } from "../types";

export function LeaguesHeader({
  user,
  leagueCount,
  season,
  refreshing,
  progress,
  summary,
}: {
  user: LeaguesResult["user"];
  leagueCount: number;
  season: string;
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
}) {
  return (
    <header className="mb-8 border-b border-white/10 pb-6">
      <div className="flex items-center gap-4">
        {user.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={user.avatar_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl font-semibold text-white/40">
            {(user.display_name || user.username).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-4xl font-semibold tracking-tight">
            {user.display_name || user.username}
          </h1>
          <p className="text-sm text-white/45">@{user.username}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-lg font-medium">
          {leagueCount} league{leagueCount === 1 ? "" : "s"}
        </span>
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm text-white/55">
          {season}
        </span>
        {refreshing && <RefreshingPill progress={progress} />}
        {summary && summary.failed > 0 && (
          <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-sm text-amber-300">
            {summary.failed} failed to sync
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

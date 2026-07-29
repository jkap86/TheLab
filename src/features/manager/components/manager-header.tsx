import Link from "next/link";

import { Avatar } from "@/features/shared";

import type { LeaguesResult, SyncProgress } from "../types";

/** The manager views sharing this header, in the order they're shown. */
const TABS = [
  { key: "leagues", label: "Leagues" },
  { key: "players", label: "Players" },
  { key: "leaguemates", label: "Leaguemates" },
] as const;

export type ManagerTab = (typeof TABS)[number]["key"];

/**
 * Who is being looked at, which view of them is open, and how fresh it is.
 *
 * Shared by every `/manager/[searched]/…` view rather than written per page: the
 * identity, the season and the sync state are the same facts on all of them, and
 * only the count line under them differs — which is what `children` is. The tabs
 * are the whole reason a second view is reachable at all, so they live here too.
 *
 * `searched` is the URL segment rather than the resolved username, so the links
 * stay on whatever spelling the visitor arrived with (Sleeper resolves a user id
 * as readily as a name).
 */
export function ManagerHeader({
  user,
  searched,
  active,
  season,
  refreshing,
  progress,
  summary,
  refreshError,
  children,
}: {
  user: LeaguesResult["user"];
  searched: string;
  active: ManagerTab;
  season: string;
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
  /**
   * A refresh that failed after cached data was already served. Shown as a
   * pill rather than replacing the page: what's below is stale, not wrong.
   */
  refreshError?: string | null;
  /** The view's own count line, shown beside the season and sync state. */
  children: React.ReactNode;
}) {
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

      <nav className="mt-5 flex items-center gap-1 rounded-lg bg-foreground/5 p-0.5 self-start w-fit">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/manager/${encodeURIComponent(searched)}/${tab.key}`}
            aria-current={tab.key === active ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              tab.key === active
                ? "bg-foreground/10 text-foreground"
                : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {children}
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
            Refresh failed — showing cached data
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

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
 * Rendered as one rail card — the same glass and cyan accent the league rows
 * below use — so the top of the page reads as a single object rather than a
 * stack of loose rows. The identity, tabs and count share the card's top zone;
 * the league filters, when a view has any, sit in a second zone under a hairline
 * (`filters`). Every `/manager/[searched]/…` view renders this: the identity,
 * the season and the sync state are the same facts on all of them, and only the
 * count line — `children`, shown in the meta cluster — differs.
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
  filters,
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
  /**
   * The view's league filters, dropped into the card's second zone. Omitted
   * where a view has nothing to filter (e.g. a manager with no leagues), which
   * leaves the card a single zone.
   */
  filters?: React.ReactNode;
  /** The view's own count line, shown in the meta cluster beside the season. */
  children: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="relative isolate overflow-hidden rounded-2xl border border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_-22px_rgba(0,0,0,0.8)]">
        {/* The cyan rail down the card, echoing the league rows' accent. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-[2] w-1 bg-gradient-to-b from-active to-active/30 shadow-[0_0_16px_rgba(0,255,229,0.4)]"
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 pl-6 pr-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              url={user.avatar_url}
              name={user.display_name || user.username}
              size="lg"
            />
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">
              {user.display_name || user.username}
            </h1>
          </div>

          <span
            aria-hidden="true"
            className="hidden w-px self-stretch bg-foreground/10 md:block"
          />

          <nav className="flex items-center gap-6" aria-label="Manager views">
            {TABS.map((tab) => {
              const isActive = tab.key === active;
              return (
                <Link
                  key={tab.key}
                  href={`/manager/${encodeURIComponent(searched)}/${tab.key}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative whitespace-nowrap py-1.5 text-sm font-semibold transition-colors ${
                    isActive
                      ? "text-foreground after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-active after:shadow-[0_0_12px_rgba(0,255,229,0.55)]"
                      : "text-foreground/50 hover:text-foreground/80"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
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
        </div>

        {filters}
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

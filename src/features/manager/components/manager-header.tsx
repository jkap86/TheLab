import Link from "next/link";
import { useId, type ReactNode } from "react";

import { Avatar } from "@/features/shared";

import { formatRecord, formatWinPct } from "../format";
import type { OverallRecord } from "../record";
import type { LeaguesResult, SyncProgress } from "../types";

/** The manager views sharing this header, in the order they're shown. */
const TABS = [
  { key: "leagues", label: "Leagues" },
  { key: "players", label: "Players" },
  { key: "leaguemates", label: "Leaguemates" },
] as const;

export type ManagerTab = (typeof TABS)[number]["key"];

/** A view's own headline count, shown as a cell in the readout's side rail. */
export type HeaderStat = {
  label: string;
  value: ReactNode;
  /** The dim second line — usually what the count is out of. */
  sub?: ReactNode;
};

/**
 * Who is being looked at, which view of them is open, how fresh it is, and how
 * their season is going.
 *
 * One rail card in two zones. The top zone is identity, tabs and state; the
 * bottom is the *readout* — the manager's record across the filtered leagues,
 * shown as shape before digits (a dial for the win percentage, a proportion bar
 * for the wins and losses behind it), with the view's own count in a side rail.
 * That bottom zone is where the league filters used to sit: they are behind
 * {@link LeagueFiltersModal} now, whose trigger is up in the state cluster.
 *
 * Every `/manager/[searched]/…` view renders this. The identity, the season, the
 * sync state and the record are the same facts on all of them; only `stat`
 * differs, which is why it is a prop rather than three copies of this card.
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
  record,
  scope,
  leagueCount,
  stat,
  filters,
  board,
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
  /** The manager's season summed over the leagues the filters leave. */
  record: OverallRecord;
  /**
   * Those filters in words. With the controls in a modal this is the only thing
   * saying what the record is counted over, so it sits with the numbers rather
   * than on the button that opens them.
   */
  scope: string;
  /** How many leagues the filters leave — what `record.leagues` is out of. */
  leagueCount: number;
  /** The view's own headline count. */
  stat: HeaderStat;
  /**
   * The filters' trigger. Omitted where a view has nothing to filter (e.g. a
   * manager with no leagues), which leaves the state cluster to the season.
   */
  filters?: ReactNode;
  /**
   * The ADP board's trigger, beside the filters' own. Two buttons rather than
   * two tabs of one dialog, because they narrow different populations — these
   * leagues against every crawled draft — and merging them would suggest one
   * selection where there are two.
   */
  board?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="relative isolate overflow-hidden rounded-2xl border border-foreground/10 bg-gradient-to-br from-foreground/[0.055] to-foreground/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_-22px_rgba(0,0,0,0.8)]">
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
            <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm text-foreground/55">
              {season}
            </span>
            {filters}
            {board}
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

        <div className="flex flex-wrap items-center gap-x-7 gap-y-5 border-t border-foreground/10 py-4 pl-6 pr-5">
          <WinPctGauge pct={record.pct} />
          <RecordSplit record={record} scope={scope} />

          <div className="flex w-full flex-col gap-3 border-t border-foreground/10 pt-3.5 sm:ml-auto sm:w-auto sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
            <StatCell label={stat.label} value={stat.value} sub={stat.sub} />
            <StatCell
              label="Rostered"
              value={record.leagues}
              sub={`of ${leagueCount} shown`}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The win percentage as a dial.
 *
 * The number is the one figure on the card that is a verdict rather than a
 * count, so it is drawn against the field it lives in — half the ring is a .500
 * season — where a bare `.537` reads as another statistic. Pure SVG, so it
 * renders on the server and stays out of the bundle; `useId` keeps the gradient
 * id unique in case two ever share a page.
 */
function WinPctGauge({ pct }: { pct: number | null }) {
  const gradientId = useId();
  // r=44 in a 100-unit box: circumference to the third decimal, so the arc lands
  // where the label says it does.
  const circumference = 2 * Math.PI * 44;

  return (
    <div className="relative grid h-[108px] w-[108px] flex-none place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-active)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-active)" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="6"
          className="stroke-foreground/[0.07]"
        />
        {pct !== null && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            className="drop-shadow-[0_0_6px_rgba(0,255,229,0.45)]"
          />
        )}
      </svg>
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-mono text-[25px] font-semibold leading-none tabular-nums tracking-tight">
          {formatWinPct(pct)}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40">
          Win pct
        </span>
      </div>
    </div>
  );
}

/**
 * The record behind that dial: the figure, the proportion it comes from, and
 * what it was counted over.
 *
 * Nothing played is its own state rather than `0-0` and `.000`, which would
 * dress a season that hasn't started up as a season of losses — see
 * {@link aggregateRecord}. The two ways to get there are distinguished, because
 * "your filters left nothing" and "week 1 hasn't happened" are different
 * problems for the reader.
 */
function RecordSplit({
  record,
  scope,
}: {
  record: OverallRecord;
  scope: string;
}) {
  if (record.games === 0) {
    return (
      <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <span className="text-lg font-medium text-foreground/45">
          {record.leagues === 0
            ? "No records in these leagues"
            : "Season hasn't started"}
        </span>
        <span className="text-xs text-foreground/35">
          {record.leagues === 0
            ? "Nothing here holds a roster yet."
            : `${record.leagues} team${record.leagues === 1 ? "" : "s"} drafted, no games played.`}
        </span>
        <ScopeLine scope={scope} />
      </div>
    );
  }

  const parts: { key: string; label: string; count: number; tone: string }[] = [
    {
      key: "w",
      label: "Won",
      count: record.wins,
      tone: "bg-gradient-to-r from-active/50 to-active shadow-[0_0_12px_rgba(0,255,229,0.35)]",
    },
    { key: "l", label: "Lost", count: record.losses, tone: "bg-foreground/[0.16]" },
    { key: "t", label: "Tied", count: record.ties, tone: "bg-amber-400/50" },
  ];

  return (
    <div className="flex min-w-[240px] flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[25px] font-semibold leading-none tabular-nums tracking-tight">
          {formatRecord(record)}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40">
          across{" "}
          <span className="tabular-nums">{record.leagues}</span> league
          {record.leagues === 1 ? "" : "s"}
        </span>
      </div>

      {/* The same three numbers as proportion — where a .520 season and a .680
          one are told apart at a glance rather than by reading. */}
      <div aria-hidden="true" className="flex h-2 gap-0.5">
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <span
              key={part.key}
              className={`block rounded-sm ${part.tone}`}
              style={{ flexGrow: part.count }}
            />
          ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/45">
        {/* Ties are dropped when there are none, the same convention
            `formatRecord` follows — most leagues never tie, and a `Tied 0`
            standing next to two real numbers reads as a third one. */}
        {parts
          .filter((part) => part.key !== "t" || record.ties > 0)
          .map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-[7px] w-[7px] rounded-[2px] ${
                  part.key === "w"
                    ? "bg-active"
                    : part.key === "t"
                      ? "bg-amber-400/70"
                      : "bg-foreground/25"
                }`}
              />
              {part.label}{" "}
              <b className="font-mono font-semibold tabular-nums text-foreground/70">
                {part.count}
              </b>
            </span>
          ))}
        <ScopeLine scope={scope} />
      </div>
    </div>
  );
}

/** What the record was counted over — the filter selection, in words. */
function ScopeLine({ scope }: { scope: string }) {
  return (
    <span className="text-xs text-foreground/35">
      <span className="text-foreground/25">Counting</span> {scope}
    </span>
  );
}

function StatCell({ label, value, sub }: HeaderStat) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40">
        {label}
      </span>
      <span className="font-mono text-[17px] font-semibold leading-none tabular-nums">
        {value}
      </span>
      {sub && <span className="text-[11px] text-foreground/35">{sub}</span>}
    </div>
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

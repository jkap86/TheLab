import type {
  LeagueLineupEntry,
  LeagueRecord,
  LineupMetricId,
  ManagerLeague,
} from "@/shared/contract";

import { formatRank, LINEUP_METRIC_LABELS } from "../helpers/lineup-metrics";
import { LineupBreakdown } from "./lineup-breakdown";

/**
 * One league: the name and the chosen rank columns, with everything else — the
 * season line, the manager's team and record, the solved lineup — behind a
 * `<details>` disclosure. The card stays hook-free on purpose: the one
 * interaction it owns is the disclosure, and the platform already ships it.
 */

/**
 * Sleeper's `status`, as words rather than its own vocabulary.
 *
 * An unknown status falls through to the raw string rather than to a
 * placeholder: Sleeper adds them, and showing the one it sent is more use than
 * hiding it behind "unknown".
 */
const STATUS_LABELS: Record<string, string> = {
  pre_draft: "Pre-draft",
  drafting: "Drafting",
  in_season: "In season",
  complete: "Complete",
};

/** `8–5`, or `8–5–1` where the league has ties and this manager has one. */
function formatRecord(record: LeagueRecord): string {
  const base = `${record.wins}–${record.losses}`;
  return record.ties > 0 ? `${base}–${record.ties}` : base;
}

// Spelled out per count so Tailwind sees each class it must generate.
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function LeagueCard({
  league,
  columns,
  entry,
}: {
  league: ManagerLeague;
  /** The chosen rank columns, in canonical order — see `useLineupColumns`. */
  columns: readonly LineupMetricId[];
  /** This league's solve + ranks, once the batched lineups read lands. */
  entry?: LeagueLineupEntry | null;
}) {
  const status = STATUS_LABELS[league.status] ?? league.status;
  // Sleeper stores an unset team name as an empty string about as often as it
  // omits the key, so blank is folded in with null rather than rendered as one:
  // `?? "—"` alone leaves those cards with a silent gap where every other card
  // has a dash.
  const teamName = league.team_name?.trim() || null;

  return (
    <li className="@container rounded-2xl border border-foreground/12 bg-foreground/[0.04] shadow-[0_24px_60px_-34px_var(--surface-shadow)] backdrop-blur-xl">
      <details className="group">
        <summary className="block cursor-pointer list-none p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate font-display text-base font-semibold tracking-tight">
              {league.name}
            </p>
            <span className="shrink-0 text-xs text-foreground/50 transition-colors group-hover:text-foreground/80">
              <span className="group-open:hidden">▸</span>
              <span className="hidden group-open:inline">▾</span>
            </span>
          </div>

          <div
            className={`mt-3 grid gap-3 ${GRID_COLS[columns.length] ?? "grid-cols-4"}`}
          >
            {columns.map((id) => (
              <div key={id} className="min-w-0">
                <p className="truncate text-[10px] font-semibold tracking-wide text-foreground/60">
                  {LINEUP_METRIC_LABELS[id].column}
                </p>
                {/* Full opacity on the accent: the light-mode teal is only
                    ~5:1 against the page, and an alpha drops it below AA. */}
                <p className="mt-0.5 truncate font-display text-sm font-semibold tabular-nums text-active">
                  {formatRank(entry?.ranks[id] ?? null)}
                </p>
              </div>
            ))}
          </div>
        </summary>

        <div className="border-t border-foreground/10 px-4 pb-4 pt-3">
          <p className="truncate text-xs text-foreground/60">
            {league.season} · {status} · {league.total_rosters}-team
          </p>

          {/* The manager's own half. A league with neither a team name nor a
              record — one whose rosters have not been read — renders no row at
              all rather than an empty one pretending to be a `0–0`. */}
          {(teamName || league.record) && (
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-foreground/80">
                {teamName ?? "—"}
              </span>
              {league.record && (
                <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-active">
                  {formatRecord(league.record)}
                </span>
              )}
            </div>
          )}

          {entry && entry.lineup.starters.length > 0 && (
            <LineupBreakdown lineup={entry.lineup} />
          )}
        </div>
      </details>
    </li>
  );
}

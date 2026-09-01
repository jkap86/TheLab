import type { LeagueRecord, ManagerLeague } from "@/shared/contract";
import { Avatar } from "@/features/shared";

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

export function LeagueCard({ league }: { league: ManagerLeague }) {
  const status = STATUS_LABELS[league.status] ?? league.status;
  // Sleeper stores an unset team name as an empty string about as often as it
  // omits the key, so blank is folded in with null rather than rendered as one:
  // `?? "—"` alone leaves those cards with a silent gap where every other card
  // has a dash.
  const teamName = league.team_name?.trim() || null;

  return (
    <li className="@container rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-4 shadow-[0_24px_60px_-34px_var(--surface-shadow)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Avatar url={league.avatar_url} name={league.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-semibold tracking-tight">
            {league.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-foreground/60">
            {league.season} · {status} · {league.total_rosters}-team
          </p>
        </div>
      </div>

      {/* The manager's own half of the card. A league with neither a team name
          nor a record — one whose rosters have not been read — renders no row
          at all rather than an empty one pretending to be a `0–0`. */}
      {(teamName || league.record) && (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-foreground/10 pt-3">
          <span className="truncate text-sm text-foreground/80">
            {teamName ?? "—"}
          </span>
          {league.record && (
            /* Full opacity: the light-mode accent is only ~5:1 against the
               page, and an alpha on it drops this below AA. */
            <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-active">
              {formatRecord(league.record)}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

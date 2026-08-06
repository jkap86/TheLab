import { formatRecord } from "../format";
import type { ManagerLeague } from "../types";

/** Small presentational pieces shared by the standings, roster and share views. */

// Moved to `features/shared` once the ADP drawer needed it there too;
// re-exported under its old name for this feature's own consumers
// (`player-shares`, `subject-parts`, `subject-rail`).
export { PositionBadge } from "@/features/shared/ui/position-badge";

// The two panel states went to `features/shared/ui/panel-message` with the league
// detail panel, which is what wrote them and which the trades board now opens a
// card into. Re-exported under their old names because this feature's own
// consumers — the players and leaguemates tabs, the shares sheet, the leagues
// layout — already import them from here.
export { PanelLoading, PanelMessage } from "@/features/shared/ui/panel-message";

// `teamLabel`, `managerLabel` and `TeamAvatar` went with that panel too, and
// leave no re-export behind: the standings table and the draft-pick chips were
// their only readers, and both moved.

/** The row-expander arrow. `md` is the league cards' size, `sm` the lists'. */
export function Chevron({
  open,
  size = "sm",
}: {
  open: boolean;
  size?: "sm" | "md";
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${
        size === "md"
          ? "h-4 w-4 text-foreground/40"
          : "h-3.5 w-3.5 text-foreground/30"
      } ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One of the manager's leagues under an expanded share row, named and sized —
 * the same row whether what's shared is a player or a leaguemate.
 */
export function SharedLeagueRow({ league }: { league: ManagerLeague }) {
  // A record only says something once a game has been played. In the offseason
  // every one of these is 0-0, which is a column of nothing on every row of
  // every player — the same reason the roster panel doesn't asterisk byes.
  //
  // Resolved to a string here rather than tested in the JSX, where a falsy
  // `0` would render itself.
  const record = league.record;
  const played =
    record && (record.wins || record.losses || record.ties)
      ? formatRecord(record)
      : null;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1 pl-6">
      <span className="min-w-0 truncate text-sm text-foreground/70">
        {league.name}
      </span>
      <span className="shrink-0 text-[0.7rem] tabular-nums text-foreground/40">
        {played && <>{played} · </>}
        {league.total_rosters} teams
      </span>
    </li>
  );
}

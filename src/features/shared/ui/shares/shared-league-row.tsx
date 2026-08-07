import type { ManagerLeague } from "@/shared/manager";

import { formatRecord } from "../../format";

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

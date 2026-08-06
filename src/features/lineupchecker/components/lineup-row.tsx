import type { ManagerLeague } from "@/shared/manager";

// The modules rather than the barrel, relative rather than aliased — see
// {@link LineupStatColumns}' own note on why both halves matter. The type above
// is erased, so it keeps the alias.
import { Avatar } from "../../shared/ui/avatar";
import { LIST_ROW_SURFACE, RowSheen } from "../../shared/ui/list-row";

import { matchupState, opponentLabel } from "../opponent";
import type { LeagueMatchup } from "../types";
import { LineupStatColumns } from "./lineup-columns";

/**
 * One league in the lineup checker's list: which league, who it is playing this
 * week, and the four stat columns the tool will fill in.
 *
 * It wears {@link LIST_ROW_SURFACE} rather than a surface of its own, which is
 * the point of that class: league cards, share cards and these read as one
 * material because they are one. What it deliberately does *not* take is
 * {@link LIST_ROW_HOVER} — a row that lifts under the pointer is promising to
 * open into something, and this one has nothing behind it yet.
 *
 * The opponent sits on a line of its own under the league name rather than beside
 * it. Sharing the line reads fine on a laptop and crowds a 390px screen, where
 * the name, an avatar, a username and four columns are competing for one row; a
 * second line costs nothing at either width, since the row's height is set by the
 * stat columns anyway.
 */
export function LineupRow({
  league,
  week,
  matchup,
}: {
  league: ManagerLeague;
  /** The week the read is for, or null when none is stored — see {@link matchupState}. */
  week: number | null;
  /** This league's matchup, or undefined where the week isn't stored for it. */
  matchup: LeagueMatchup | undefined;
}) {
  return (
    <li className={LIST_ROW_SURFACE}>
      <RowSheen />

      {/* `relative`, so the sheen stays behind this: an absolutely positioned
          sibling paints above static content whatever the source order. */}
      <div className="relative flex w-full flex-col items-stretch gap-3 px-4 py-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* `h2`, not `h3`: the only heading above this on the page is its own
              `h1`, so a level 3 would skip a level in the outline. */}
          <h2 className="min-w-0 truncate font-display text-sm font-semibold tracking-tight">
            {league.name}
          </h2>
          <Opponent week={week} matchup={matchup} />
        </div>

        {/* Numbers only, at every width — the billet above the list is what
            names these columns, exactly as it is on the leagues page. */}
        <LineupStatColumns />
      </div>
    </li>
  );
}

/**
 * Who the row is playing, in the four states {@link matchupState} distinguishes.
 *
 * Three of them are a kind of nothing and each says which: a season with nothing
 * stored ahead of today, a league the crawler has not reached this week, and a
 * genuine bye. Drawing all three as one em dash would tell a reader their league
 * has no game when what it has is no data — the distinction the payload is shaped
 * to carry, spent here rather than thrown away at the last step.
 */
function Opponent({
  week,
  matchup,
}: {
  week: number | null;
  matchup: LeagueMatchup | undefined;
}) {
  const state = matchupState(week, matchup);

  if (state.kind === "opponent") {
    const label = opponentLabel(state.opponent);
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-foreground/60">
        <span className="shrink-0 text-foreground/35">vs</span>
        <Avatar url={state.opponent.avatar_url} name={label} />
        <span
          // The team name is demoted rather than dropped, the standings' own
          // rule: it is a nickname for one league, so it belongs on the hover
          // and the person's name belongs on the row.
          title={state.opponent.team_name ?? undefined}
          className="min-w-0 truncate font-medium text-foreground/80"
        >
          {label}
        </span>
      </p>
    );
  }

  const note =
    state.kind === "bye"
      ? "Bye this week"
      : state.kind === "no-week"
        ? "No week scheduled"
        : "Matchup not synced yet";

  return <p className="truncate text-xs text-foreground/35">{note}</p>;
}

import { ordinal } from "../format";
import type { DraftPickAsset, LeagueTeamView } from "../types";
import { managerLabel } from "./ui";

/**
 * A team's future draft picks, grouped by season.
 *
 * One row per season — the season on the left, its rounds as chips on the right —
 * because a portfolio is scanned season by season ("what do I have in 2027?"). A
 * pick the team still holds is a plain chip; one it acquired in a trade is tinted
 * and carries the roster it came from, so "1st" and "1st from Bob" read as the
 * different assets they are. The origin is resolved on the client from the teams
 * it already has rather than sent per pick.
 *
 * Renders nothing when the team owns no picks, which is every team in a redraft
 * league and any dynasty whose picks have never moved — there is no empty state to
 * show for "the pick market here is quiet".
 */
export function DraftPicks({
  picks,
  rosterId,
  teamsById,
}: {
  picks: DraftPickAsset[];
  /** The team these picks belong to — how an own pick is told from an acquired one. */
  rosterId: number;
  /** Every team in the league, for naming the roster an acquired pick came from. */
  teamsById: Map<number, LeagueTeamView>;
}) {
  if (picks.length === 0) return null;

  // Picks arrive sorted by season, so a single pass groups them without a sort.
  const bySeason: { season: string; picks: DraftPickAsset[] }[] = [];
  for (const pick of picks) {
    const last = bySeason.at(-1);
    if (last && last.season === pick.season) last.picks.push(pick);
    else bySeason.push({ season: pick.season, picks: [pick] });
  }

  return (
    <div className="mt-3">
      {/* `h3` beside the roster's own section headings — see `RosterSection`. */}
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground/35">
        Draft Picks
      </h3>
      <ul className="flex flex-col gap-1.5">
        {bySeason.map(({ season, picks }) => (
          <li key={season} className="flex items-baseline gap-2">
            <span className="w-10 shrink-0 text-xs tabular-nums text-foreground/45">
              {season}
            </span>
            <span className="flex flex-wrap gap-1">
              {picks.map((pick) => {
                const source = teamsById.get(pick.original_roster_id);
                const from =
                  pick.original_roster_id === rosterId
                    ? null
                    : source
                      ? managerLabel(source)
                      : `Roster ${pick.original_roster_id}`;
                return (
                  <span
                    key={`${pick.round}-${pick.original_roster_id}`}
                    title={from ? `from ${from}` : undefined}
                    className={`inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 text-[0.7rem] ${
                      from
                        ? "bg-active/10 text-active"
                        : "bg-foreground/5 text-foreground/70"
                    }`}
                  >
                    <span className="font-medium tabular-nums">
                      {ordinal(pick.round)}
                    </span>
                    {from && (
                      <span className="max-w-[6rem] truncate text-active/70">
                        {from}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

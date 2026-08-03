import { useId } from "react";

// Imported directly rather than through the manager barrel, which would pull
// `pg`-backed code into the client bundle — see `slots.ts` and the panel's own
// note on `rank.ts`.
import { rankOf } from "@/shared/manager/rank";

import { formatPoints } from "../format";
import type { LeagueOutlook, TeamOutlook } from "../types";

/**
 * The card's second head line while it is open: where the selected team stands
 * in the projected field, and the three totals that say what kind of team it is.
 *
 * It sits above both halves because a panel that opens onto two dense tables
 * asks the reader to derive its headline — the summary belongs before the
 * detail, not inside it.
 *
 * **It is a rail on the card's head, not a strip floating in the body.** As an
 * inset block above the two halves it was a third object between the league's
 * name and its detail, restating at a second grain what the head's four stat
 * columns say a line above — one league with two headlines a few pixels apart.
 * Full-bleed under a machined seam (a dark cut with a lit far wall, the groove
 * the heading rail uses) it reads as the head continuing, which is what it is.
 * The stat columns stay on the first line and are not a duplicate of this: they
 * place this league against the other hundred in the list, and that question
 * stays answerable while the panel is open.
 *
 * What it states is deliberately the *selected* team's,
 * where the standings' own columns are for comparing teams against each other;
 * the same numbers answer different questions at the two grains, which is why
 * the overlap with the default `proj` / `bench` columns is worth paying. The
 * columns are pickable in any case, so neither number is reliably on screen.
 *
 * The gap is the one figure here that is a verdict rather than a count, so it
 * takes the amber the app already uses for "needs attention" (a drafting
 * league's status dot, a failed-refresh note) rather than competing with cyan —
 * and it is stated *only* here now: the lineup summary inside the roster half
 * used to carry the same number above the list it belongs to, and two places is
 * one edit away from disagreeing.
 *
 * Rendered only for a league that has an outlook, which is the same gate the
 * standings' value columns sit behind; a team with no outlook of its own inside
 * one still keeps the strip, with em dashes, because the panel must not change
 * height as the selection moves down the table.
 */
export function PanelTelemetry({
  outlook,
  team,
}: {
  outlook: LeagueOutlook;
  /** The selected team's outlook, or undefined when it has none. */
  team: TeamOutlook | undefined;
}) {
  // The same map and the same competition-style rule the collapsed card's rank
  // metrics use, so a chip on the card and the dial in the panel it opens can't
  // disagree about where a roster places. Null where every total is zero — an
  // undrafted league is not a league somebody leads.
  const rank = team
    ? rankOf(
        new Map(outlook.teams.map((t) => [t.roster_id, t.weekly_optimal_points])),
        team.roster_id,
      )
    : null;

  return (
    // The left inset clears the same cyan rail the card's name line clears, so
    // the dial starts under the league's name rather than under its chevron.
    <div className="flex flex-wrap items-center gap-2 border-t border-black/40 py-2 pl-5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] @lg:gap-3 @lg:py-2.5 @lg:pr-4">
      <RankDial rank={rank} />
      <Readout
        label="Projected"
        value={team ? formatPoints(team.weekly_optimal_points) : "—"}
        title="Projected points for the rest of the season, setting the best lineup each week"
      />
      <Readout
        label="On bench"
        value={team ? formatPoints(team.weekly_bench_points) : "—"}
        title="What this roster's non-starters project over the same horizon — depth on a good team, a logjam on a badly balanced one"
      />
      <Readout
        label="Lineup gap"
        // Zero is a real answer here and a good one: the team is already
        // starting its best lineup. It reads as "set" rather than as `+0.00`,
        // which looks like a number that failed to arrive.
        value={
          team ? (team.points_left > 0 ? `+${formatPoints(team.points_left)}` : "set") : "—"
        }
        tone={team && team.points_left > 0 ? "text-amber-300" : undefined}
        title="Points the optimal lineup would add over what this team is starting today"
      />
    </div>
  );
}

/**
 * One milled cell: the number over the word for it.
 *
 * The header's kickoff countdown at panel scale — same well, same digits-over-
 * unit stacking — because a readout appearing twice in the app with two looks
 * is the drift the shared material classes exist to stop.
 */
function Readout({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  /** Overrides the digits' colour where the number is a verdict, not a count. */
  tone?: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className="lab-well flex-none rounded-[5px] px-2 pb-1 pt-[3px] text-center"
    >
      <span
        className={`block font-mono text-[12px] font-bold leading-[1.1] tabular-nums @lg:text-[13px] ${
          tone ?? "text-foreground/90"
        }`}
      >
        {value}
      </span>
      <span className="block text-[7px] font-bold uppercase tracking-[0.1em] text-foreground/30">
        {label}
      </span>
    </span>
  );
}

/**
 * Where the selected team places in the projected field, drawn as a dial.
 *
 * The arc is the rank rather than the points: a full ring is the best roster in
 * the league, an empty one the worst, so the reading is "how far up this field
 * am I" and not "how big is my number" — which the readout beside it already
 * says, and which has no field to be placed against anyway. The rank is what
 * the table under it is ordered by, so the dial and the row positions are one
 * fact stated twice at two resolutions.
 *
 * An em dash where nothing ranks, on {@link rankOf}'s terms: a league where
 * every total is zero has no leader, and "1st of 12" there would dress an
 * undrafted roster up as one. Pure SVG with a `useId` gradient, so two panels
 * open at once can't collide over an id.
 */
function RankDial({ rank }: { rank: { rank: number; of: number } | null }) {
  const gradientId = useId();
  // r=44 in a 100-unit box, matching the header's win-percentage dial.
  const circumference = 2 * Math.PI * 44;
  // Best of N fills the ring, worst of N leaves it empty.
  const filled = rank ? (rank.of - rank.rank + 1) / rank.of : 0;

  return (
    <div
      title={
        rank
          ? `Projected ${rank.rank} of ${rank.of} in this league`
          : "Nothing projected in this league yet"
      }
      className="relative grid h-[46px] w-[46px] flex-none place-items-center @lg:h-[52px] @lg:w-[52px]"
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 -rotate-90">
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
          strokeWidth="8"
          className="stroke-foreground/[0.07]"
        />
        {rank && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            className="drop-shadow-[0_0_6px_rgba(0,255,229,0.45)]"
          />
        )}
      </svg>
      <div className="flex flex-col items-center leading-none">
        <span
          className={`font-mono text-[15px] font-semibold tabular-nums ${
            rank ? "" : "text-foreground/35"
          }`}
        >
          {rank ? rank.rank : "—"}
        </span>
        <span className="mt-0.5 font-mono text-[8px] tabular-nums text-foreground/35">
          {rank ? `of ${rank.of}` : "rank"}
        </span>
      </div>
    </div>
  );
}

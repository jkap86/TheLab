import { useId } from "react";

// Imported directly rather than through the manager barrel, which would pull
// `pg`-backed code into the client bundle — see `slots.ts` and the panel's own
// note on `rank.ts`.
import { rankOf } from "@/shared/manager/rank";

import { formatPoints } from "../../format";
import type { LeagueOutlook, TeamOutlook } from "./types";

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
 * **The lineup gap is not one of them, and the panel now says nothing at all
 * about the lineup a team is currently seating.** That is deliberate and it is
 * the end of a line this half has been walking for a while: the roster's head
 * carried the same number above the list it belongs to (two places for one
 * figure being one edit away from disagreeing), then the `start … · sit …`
 * names under it (the two lists restated in prose a few pixels above
 * themselves), then a cell here. What each removal kept asking is what the
 * *panel* is for, and the answer is the best lineup available rather than a
 * diff against another one — which is already what the two lists below are.
 *
 * Nothing about the contract changes: `points_left` is still computed, still
 * sent, and still read by the lineup checker's own gap column and by the
 * standings' week-projection hover, which are the two places a reader is asking
 * that question rather than this one. It also leaves this strip with no verdict
 * on it, so the amber the app spends on "needs attention" is unspent here and
 * the accent stays available for the one lit standings row.
 *
 * Rendered only for a league that has an outlook, which is the same gate the
 * standings' value columns sit behind; a team with no outlook of its own inside
 * one still keeps the strip, with em dashes, because the panel must not change
 * height as the selection moves down the table.
 *
 * **It does not scroll.** What it states is a fact about the *selected* team,
 * and the row that selects one is in the table below — so a strip carried off
 * the top by the roster it is describing left three numbers on screen with
 * nothing naming whose they are. `shrink-0` is what holds it there: the two
 * halves under it are the panel's scrolling parts, and this is the head they
 * scroll under.
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-black/40 py-2 pl-5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] @lg:gap-3 @lg:py-2.5 @lg:pr-4">
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
    </div>
  );
}

/**
 * One milled cell: the number over the word for it.
 *
 * The header's kickoff countdown at panel scale — same well, same digits-over-
 * unit stacking — because a readout appearing twice in the app with two looks
 * is the drift the shared material classes exist to stop.
 *
 * **The unit is 8.5px, not 7px, and that is a legibility floor rather than a
 * preference.** At 7px with `0.1em` of tracking on a 30%-opacity foreground,
 * uppercase stops resolving into a word on any face and reads as grey texture —
 * so the cell was carrying a caption nobody could use and a number that had to
 * be inferred from its position. The cell does not get taller for it: the extra
 * 1.5px of type comes out of padding that was there to hold a 7px string off
 * the well's own edge.
 *
 * The digits step up with it and lose a weight. `font-bold` at 12px in the body
 * face was doing the work of making a number look deliberate; at 13px in a
 * monospace with a hair of negative tracking, the face is doing it — which is
 * what an instrument's figures should look like and what the `--font-mono`
 * registration in `globals.css` finally makes available.
 */
function Readout({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className="lab-well flex-none rounded-[5px] px-2.5 pb-1 pt-1 text-center"
    >
      <span className="block font-mono text-[13px] font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums text-foreground/90 @lg:text-[13.5px]">
        {value}
      </span>
      <span className="block text-[8.5px] font-semibold uppercase tracking-[0.15em] text-foreground/45">
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

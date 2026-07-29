import { formatPoints } from "../format";
import type { PlayerOutlook, PlayerSplit, PlayerSummary } from "../types";
import type { SectionLayout } from "./roster-layout";
import { PositionBadge } from "./ui";

/**
 * One roster row and its number cells, laid out on the section's shared grid
 * (see `roster-layout`). Split out of `roster-detail`, which keeps the sections
 * and the lineup summary; this file owns everything below a section heading.
 */

/**
 * Short labels for the slots whose Sleeper names don't fit the column.
 *
 * The overlapping flexes have the longest names and are exactly the ones a
 * reader has to tell apart — `WRRB_FLEX` and `REC_FLEX` both truncate to
 * something unreadable, so they get the RB/WR and WR/TE spellings instead.
 */
const SLOT_LABEL: Record<string, string> = {
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  SUPER_FLEX: "SFLX",
  IDP_FLEX: "IDP",
};

export function PlayerRow({
  player,
  playerId,
  slot,
  outlook,
  split,
  layout,
  horizon = 0,
  promoted,
  benched,
}: {
  player: PlayerSummary | undefined;
  playerId: string;
  slot?: string;
  outlook?: PlayerOutlook;
  /**
   * How the projection divides between weeks in and out of the lineup. Undefined
   * for a player with no projection at all, which is a different thing from the
   * IR and taxi rows that ask for no split in the first place — hence `variant`
   * rather than reading this prop's absence as "show one number".
   */
  split?: PlayerSplit;
  /**
   * The section's grid. Its `columns` also decide how many numbers this row
   * carries — two for a lineup candidate, one for a player who can't start, none
   * for a league with no projections at all.
   */
  layout: SectionLayout;
  /** Weeks the projection covers, so a partial one can be marked as such. */
  horizon?: number;
  /** Starting here only in the optimal lineup. */
  promoted?: boolean;
  /** Started today, but sat by the optimal lineup. */
  benched?: boolean;
}) {
  // Sleeper pads an unfilled starting slot with an empty id or a literal "0".
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);

  return (
    <li
      className={`grid ${layout.grid} items-center gap-x-1 gap-y-0.5 py-1.5 @lg:gap-x-2 ${
        promoted ? "bg-active/[0.07]" : benched ? "opacity-50" : ""
      }`}
    >
      {/* Spans both lines so the slot reads as labelling the whole row, and holds
          the gutter open on bench rows that have no slot to show. */}
      <span className="row-span-2 self-center truncate text-center text-[0.65rem] font-semibold uppercase text-foreground/35 @lg:text-[0.7rem]">
        {slot ? (SLOT_LABEL[slot] ?? slot) : ""}
      </span>

      <span
        className={`${layout.nameSpan} min-w-0 truncate text-sm ${
          empty ? "text-foreground/25" : "text-foreground/85"
        }`}
      >
        {name}
      </span>

      {/* Second line: what the name used to be competing with. The badge no longer
          needs hiding at narrow widths — it isn't taking room from anything now. */}
      <span className="col-start-2 flex min-w-0 items-center gap-1.5">
        {!empty && <PositionBadge position={player?.position ?? null} />}
        {player?.team && (
          <span className="truncate text-[0.65rem] tabular-nums text-foreground/35">
            {player.team}
          </span>
        )}
      </span>

      {empty ? (
        // Keep the number columns occupied so an unfilled slot doesn't pull the
        // next row's cells up into its line.
        layout.columns.map((label) => <span key={label} />)
      ) : layout.columns.length > 1 ? (
        <SplitPoints outlook={outlook} split={split} horizon={horizon} />
      ) : (
        <ProjectedPoints outlook={outlook} horizon={horizon} />
      )}
    </li>
  );
}

/**
 * One number cell. Its width comes from the section's grid column rather than the
 * cell, so a heading and the numbers under it can't disagree about it.
 */
function PointsCell({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`text-right text-xs tabular-nums ${
        muted ? "text-foreground/25" : "text-foreground/70"
      }`}
    >
      {children}
    </span>
  );
}

/** `3 weeks`, or `1 week` — used in tooltips, where the count is spelled out. */
const weekCount = (n: number): string => `${n} week${n === 1 ? "" : "s"}`;

/**
 * The marker on a total covering fewer weeks than the horizon, so one that looks
 * low can be read as short rather than bad — but only past a week's shortfall.
 *
 * Every team has exactly one bye, so over a rest-of-season horizon a single
 * missing week is what *everyone* looks like, and an asterisk on every row says
 * nothing. Two or more is a hole: a week Sleeper hasn't published, or a player who
 * has fallen off the slate.
 */
function ShortHorizon({
  outlook,
  horizon,
}: {
  outlook: PlayerOutlook;
  horizon: number;
}) {
  if (horizon - outlook.weeks <= 1) return null;

  return (
    <span
      title={`Projected in only ${outlook.weeks} of ${weekCount(horizon)}`}
      className="text-foreground/30"
    >
      *
    </span>
  );
}

/**
 * A player's projected points over the horizon, as one number.
 *
 * For the rows that can't start — IR and taxi — where the season total is the
 * whole answer, since none of it is going into a lineup either way.
 *
 * An em dash rather than 0.00 when there is no projection at all: a player
 * Sleeper hasn't projected and a player projected to score nothing are different
 * claims, and the roster shouldn't make the stronger one.
 */
function ProjectedPoints({
  outlook,
  horizon,
}: {
  outlook?: PlayerOutlook;
  horizon: number;
}) {
  if (horizon === 0) return null;

  if (!outlook) return <PointsCell title="No projection" muted>—</PointsCell>;

  return (
    <PointsCell
      title={`${formatPoints(outlook.points)} projected over ${outlook.weeks} of ${weekCount(horizon)}`}
    >
      {formatPoints(outlook.points)}
      <ShortHorizon outlook={outlook} horizon={horizon} />
    </PointsCell>
  );
}

/**
 * A lineup candidate's projection, split into the weeks he is in that week's best
 * lineup and the weeks he isn't.
 *
 * Two numbers because the single total answers the wrong question on both sides of
 * the roster. A bench player's total says nothing about whether any of it is
 * reachable — 60 points behind an every-week starter is worth zero, and 60 points
 * that arrive on the three weeks the starter is on bye is worth all 60. A starter's
 * bench half is the mirror of that: it is what his slot is worth to someone else
 * while he is out.
 *
 * Both halves come from the weekly lineups rather than the season aggregate, so
 * they add up to `weekly_optimal_points` and not to the total in the summary above
 * — those are deliberately different numbers (see `TeamOutlook`), which is why the
 * tooltips name what each half covers instead of implying a single total.
 *
 * The em dash convention is the one used everywhere else: no projection at all is
 * a dash in both columns, while a real 0.00 — a player the lineup never starts —
 * is a claim worth making.
 */
function SplitPoints({
  outlook,
  split,
  horizon,
}: {
  outlook?: PlayerOutlook;
  split?: PlayerSplit;
  horizon: number;
}) {
  if (horizon === 0) return null;

  if (!outlook) {
    return (
      <>
        <PointsCell title="No projection" muted>—</PointsCell>
        <PointsCell title="No projection" muted>—</PointsCell>
      </>
    );
  }

  // A projected player with no split was never a candidate for a lineup solve,
  // which today means the horizon holds no week he is projected for. Zero is the
  // honest reading: none of his projection reaches a starting slot.
  const starting = split?.starting_points ?? 0;
  const bench = split?.bench_points ?? 0;
  const startingWeeks = split?.starting_weeks ?? 0;
  const benchWeeks = split?.bench_weeks ?? 0;

  return (
    <>
      <PointsCell
        title={
          startingWeeks === 0
            ? "Never in a week's best lineup"
            : `${formatPoints(starting)} over ${weekCount(startingWeeks)} in the best lineup`
        }
      >
        {formatPoints(starting)}
        <ShortHorizon outlook={outlook} horizon={horizon} />
      </PointsCell>
      <PointsCell
        muted={bench === 0}
        title={
          benchWeeks === 0
            ? "In the best lineup every week he is projected for"
            : `${formatPoints(bench)} over ${weekCount(benchWeeks)} out of the lineup`
        }
      >
        {formatPoints(bench)}
      </PointsCell>
    </>
  );
}

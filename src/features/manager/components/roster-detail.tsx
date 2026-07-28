"use client";

import { useMemo } from "react";

import { formatPoints, formatRecord, formatWeekRange } from "../format";
import type {
  LeagueOutlook,
  LeagueTeamView,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
  TeamOutlook,
} from "../types";
import { PositionBadge, teamLabel, TeamAvatar } from "./ui";

/** Roster slots that aren't part of the active starting lineup. */
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

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

/** A row of the starters list: a slot and who is in it. */
type SlotRow = { slot: string; player_id: string };

/**
 * The grid a section's rows and its column headings share.
 *
 * One template for both, so the headings stay over their numbers — a header laid
 * out separately drifts the moment a width changes.
 *
 * Two lines per row rather than one, because a name is the thing you actually read
 * and it was losing to everything else on the row: squeezed between a slot label,
 * a position badge, a team and two totals, "Christian McCaffrey" truncated inside a
 * panel that renders at half the width of a card. So the name takes the whole first
 * line and the rest — position, team, points — sits under it. The numbers keep
 * their own columns on that second line, which is what still makes them comparable
 * down the list.
 */
type SectionLayout = {
  /** Column template: slot gutter, name/meta, then one column per number. */
  grid: string;
  /** How far the name reaches on its own line — the meta column plus the numbers. */
  nameSpan: string;
  /** Headings for the number columns, left to right. */
  columns: string[];
};

// Written out rather than assembled, so Tailwind sees every class string whole.
const NO_NUMBERS: SectionLayout = {
  grid: "grid-cols-[1.75rem_minmax(0,1fr)] @lg:grid-cols-[2.5rem_minmax(0,1fr)]",
  nameSpan: "col-span-1",
  columns: [],
};

const SPLIT_LAYOUT: SectionLayout = {
  grid: "grid-cols-[1.75rem_minmax(0,1fr)_3rem_3rem] @lg:grid-cols-[2.5rem_minmax(0,1fr)_3.25rem_3.25rem]",
  nameSpan: "col-span-3",
  columns: ["start", "bench"],
};

const TOTAL_LAYOUT: SectionLayout = {
  grid: "grid-cols-[1.75rem_minmax(0,1fr)_3rem] @lg:grid-cols-[2.5rem_minmax(0,1fr)_3.25rem]",
  nameSpan: "col-span-2",
  columns: ["proj"],
};

/**
 * One team's full roster, grouped into starters, bench, IR and taxi, with each
 * player's projected points for the rest of the season.
 *
 * The starters section shows the *best* lineup available to the team, not what
 * it is currently starting (see `outlook`), and the bench follows: a player the
 * optimal lineup starts is listed as a starter and highlighted, one it sits is
 * dimmed on the bench, so the two lists always read as one lineup.
 *
 * Below the `@lg` container width the record drops onto its own line under the
 * team name instead of competing with it for horizontal space.
 */
export function RosterDetail({
  team,
  players,
  rosterPositions,
  outlook,
}: {
  team: LeagueTeamView;
  players: Record<string, PlayerSummary>;
  rosterPositions: string[] | null;
  outlook: LeagueOutlook | null;
}) {
  const teamOutlook = useMemo(
    () => outlook?.teams.find((t) => t.roster_id === team.roster_id) ?? null,
    [outlook, team.roster_id],
  );

  // Starters are positionally aligned with the league's non-bench slots. The
  // outlook has already done that pairing (and dropped any slot it doesn't
  // recognise), so it is only redone here for a league with no projections.
  const starters: SlotRow[] = useMemo(() => {
    const lineup = teamOutlook?.optimal;
    if (lineup) {
      return lineup.map((s) => ({ slot: s.slot, player_id: s.player_id ?? "" }));
    }

    const slots = (rosterPositions ?? []).filter((p) => !BENCH_SLOTS.has(p));
    return team.starters.map((id, i) => ({ slot: slots[i] ?? "FLEX", player_id: id }));
  }, [teamOutlook, rosterPositions, team.starters]);

  const bench = useMemo(() => {
    const onField = new Set([
      ...starters.map((s) => s.player_id),
      ...team.reserve,
      ...team.taxi,
    ]);
    const rest = team.players.filter((id) => id && !onField.has(id));

    // Best available first once there are projections to sort on: the point of
    // the bench in a lineup tool is who you might promote off it.
    if (!outlook) return rest;
    return [...rest].sort(
      (a, b) => (outlook.players[b]?.points ?? 0) - (outlook.players[a]?.points ?? 0),
    );
  }, [starters, team, outlook]);

  const horizon = outlook?.weeks.length ?? 0;

  // No projections means no number columns at all, so the headings go too — a
  // "start / bench" label over a column of em dashes promises a breakdown that
  // isn't there.
  const lineupLayout = horizon > 0 ? SPLIT_LAYOUT : NO_NUMBERS;
  const stashLayout = horizon > 0 ? TOTAL_LAYOUT : NO_NUMBERS;

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2.5 @lg:p-4">
      <div className="border-b border-foreground/10 pb-3 @lg:flex @lg:items-center @lg:gap-3 @lg:pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <TeamAvatar team={team} size="md" />
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-foreground/90 @lg:text-base">
              {teamLabel(team)}
            </h4>
            {team.manager?.team_name && team.manager.display_name && (
              <p className="truncate text-xs text-foreground/45">
                {team.manager.display_name}
              </p>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 text-sm @lg:mt-0 @lg:ml-auto @lg:block @lg:shrink-0 @lg:text-right">
          <span className="tabular-nums font-medium text-foreground/85">
            {formatRecord(team.record)}
          </span>
          <span className="block tabular-nums text-xs text-foreground/45">
            {formatPoints(team.fpts)} PF
          </span>
        </div>
      </div>

      {teamOutlook && outlook && (
        <LineupSummary
          teamOutlook={teamOutlook}
          weeks={outlook.weeks}
          players={players}
        />
      )}

      <RosterSection title="Starters" layout={lineupLayout}>
        {starters.map((row, i) => (
          <PlayerRow
            key={`s-${i}`}
            player={players[row.player_id]}
            playerId={row.player_id}
            slot={row.slot}
            outlook={outlook?.players[row.player_id]}
            split={teamOutlook?.weekly_split[row.player_id]}
            layout={lineupLayout}
            horizon={horizon}
            promoted={teamOutlook?.start.includes(row.player_id)}
          />
        ))}
      </RosterSection>

      {bench.length > 0 && (
        <RosterSection title="Bench" layout={lineupLayout}>
          {bench.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              outlook={outlook?.players[id]}
              split={teamOutlook?.weekly_split[id]}
              layout={lineupLayout}
              horizon={horizon}
              benched={teamOutlook?.sit.includes(id)}
            />
          ))}
        </RosterSection>
      )}

      {/* IR and taxi still show a projection — it is what a stash decision turns
          on — but they are never candidates for the lineup above, since Sleeper
          won't let them start. That is also why they get the season total rather
          than the split: a player who cannot start has no starting half. */}
      {team.reserve.length > 0 && (
        <RosterSection title="IR" layout={stashLayout}>
          {team.reserve.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="IR"
              outlook={outlook?.players[id]}
              layout={stashLayout}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}

      {team.taxi.length > 0 && (
        <RosterSection title="Taxi" layout={stashLayout}>
          {team.taxi.map((id) => (
            <PlayerRow
              key={id}
              player={players[id]}
              playerId={id}
              slot="TX"
              outlook={outlook?.players[id]}
              layout={stashLayout}
              horizon={horizon}
            />
          ))}
        </RosterSection>
      )}
    </div>
  );
}

/**
 * The optimal lineup's projected total, and what it would take to get there.
 *
 * The week range sits beside it because the horizon is whatever has been synced,
 * not a fixed span — a short backfill shortens the number without invalidating
 * it, so it is stated rather than left to be assumed.
 */
function LineupSummary({
  teamOutlook,
  weeks,
  players,
}: {
  teamOutlook: TeamOutlook;
  weeks: number[];
  players: Record<string, PlayerSummary>;
}) {
  const name = (id: string) => players[id]?.name ?? id;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-baseline gap-1.5 rounded-md bg-active/10 px-2 py-1 text-[0.7rem] text-active">
          <span className="font-medium">Optimal</span>
          <span className="tabular-nums">
            {formatPoints(teamOutlook.optimal_points)}
          </span>
        </span>
        <span className="text-[0.65rem] uppercase tracking-wide text-foreground/35">
          proj · {formatWeekRange(weeks)}
        </span>
      </div>

      {teamOutlook.points_left > 0 && (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-foreground/50">
          <span className="font-semibold text-active">
            +{formatPoints(teamOutlook.points_left)}
          </span>{" "}
          on the bench
          {teamOutlook.start.length > 0 && (
            <> · start {teamOutlook.start.map(name).join(", ")}</>
          )}
          {teamOutlook.sit.length > 0 && (
            <> · sit {teamOutlook.sit.map(name).join(", ")}</>
          )}
        </p>
      )}

      {teamOutlook.unknown_slots.length > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-foreground/40">
          {teamOutlook.unknown_slots.join(", ")} left out — this lineup covers only
          part of the roster.
        </p>
      )}
    </div>
  );
}

/**
 * A titled group of rows, with the numeric columns labelled once at the top
 * rather than on every row.
 *
 * Laid out on the same grid as its rows, so the headings sit over the numbers they
 * name. The first cell is the empty slot gutter — the headings start where the
 * names do.
 */
function RosterSection({
  title,
  layout,
  children,
}: {
  title: string;
  layout: SectionLayout;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div
        className={`mb-1.5 grid ${layout.grid} items-baseline gap-x-1 @lg:gap-x-2`}
      >
        <span />
        <h5 className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-foreground/35">
          {title}
        </h5>
        {layout.columns.map((label) => (
          <span
            key={label}
            className="text-right text-[0.6rem] uppercase tracking-wide text-foreground/30"
          >
            {label}
          </span>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-foreground/5">{children}</ul>
    </div>
  );
}

function PlayerRow({
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

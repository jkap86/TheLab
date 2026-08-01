import { formatPoints, formatRecord, formatWeekRange } from "../format";
import {
  rosterValueTotal,
  TEAM_METRICS,
  TEAM_METRICS_BY_KEY,
  type TeamMetric,
} from "../standings-metrics";
import type {
  LeagueOutlook,
  LeagueRosterValues,
  LeagueTeamView,
  TeamOutlook,
} from "../types";
import { ColumnPicker, type ColumnOption } from "./column-picker";
import { managerLabel, TeamAvatar } from "./ui";

/** The team metrics offered in every standings column's picker. */
const TEAM_METRIC_OPTIONS: ColumnOption[] = TEAM_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
}));

/**
 * The league table, rendered in the order given — the panel passes teams in
 * projected-points order, falling back to standings order where projections
 * run out, so the `#` column numbers the projected ranking the collapsed
 * card's chip quotes. Selecting a row drives the roster panel beside it.
 *
 * Two lines per row. The team name gets the first one to itself, because at a
 * 50/50 split it was the thing losing every fight for horizontal space — a name
 * squeezed between an avatar, a record and two totals truncates to nothing, and it
 * is the one field a reader is actually scanning for. The record, points for and
 * both value columns sit on the second line under it.
 *
 * The numbers keep their own columns on that line rather than being folded into a
 * sentence: they are the values worth comparing down the table, and a total buried
 * in a run of text under each name can't be.
 *
 * The two value columns are slots the reader points at a team-level metric —
 * projected points and projected bench to start with, swappable to the season
 * optimal, points for, or the roster's whole KTC / ADP total from the heading's
 * picker. Which metric each shows is held above this table (in the panel) so both
 * columns line up down the list and one picker moves the whole column.
 *
 * Below @lg only the *first* of those two columns is drawn. The panel stays a
 * 50/50 split at every width, which on a phone leaves this half ~150px: the rank
 * and the name have their own line, so what has to fit on the second is the
 * record, the points-for and the value columns — two of them ran into each other
 * (`0-0 · 0.00 PF  2,905.73 1,041.16`), one fits with room. It is the second slot
 * that goes rather than the first because the reader's leading choice is the one
 * they aimed first, and both are still there the moment there is width for them.
 *
 * That still left the second line over-subscribed once a season is under way, so
 * the points-for sheds too — and it sheds *twice*, which is the part worth
 * reading before simplifying it to one breakpoint. Preseason hid the problem:
 * `0-0 · 0.00 PF` is short, where a played `12-5-1 · 1,842.36 PF` wants ~96px and
 * a 375px screen leaves this cell ~80, so it truncated inside its own number
 * (`12-5-1 · 1,84…`). A shortened name is still a name; a shortened total reads
 * as bad data, so what gives is a whole fact rather than half of one — and the
 * points-for is the fact to drop, since `PF` is a metric the value column beside
 * it can be pointed at.
 *
 * Twice, because the space it competes for doesn't grow monotonically: the second
 * value column arrives at @lg and takes back more width than the tier gained, so
 * the same line truncates again just above that breakpoint. Hence
 * `@sm:inline @lg:hidden @2xl:inline` — visible once one column leaves room for
 * it, gone again while two columns don't, back for good once they do. The upper
 * tier is a step past where the line measures as fitting (~39rem of container
 * against @2xl's 42), because what it competes with is a *pickable* column and
 * the widest metric shouldn't be the one that reintroduces the clipping.
 */
export function Standings({
  teams,
  outlook,
  values,
  selectedId,
  onSelect,
  columns,
  openPicker,
  onTogglePicker,
  onSelectColumn,
  elevated,
}: {
  teams: LeagueTeamView[];
  outlook: LeagueOutlook | null;
  /** Per-player KTC and ADP values on this league's board, summed per team here. */
  values: LeagueRosterValues;
  selectedId: number;
  onSelect: (rosterId: number) => void;
  /** The metric key each of the two value columns shows. */
  columns: string[];
  /** Which picker is open across the whole panel, if any. */
  openPicker: string | null;
  /** Toggle a picker by its key (the panel closes any other that was open). */
  onTogglePicker: (key: string) => void;
  /** Point value column `slot` at another metric. */
  onSelectColumn: (slot: number, key: string) => void;
  /** Lift this half's stacking order while one of its pickers overhangs the rows. */
  elevated: boolean;
}) {
  // Per-team outlook, so a metric can read any of its totals. Absent (rather than
  // an empty object) when the league has no projections at all, which is what
  // gates the value columns off entirely.
  const outlookByRoster = outlook
    ? new Map(outlook.teams.map((t) => [t.roster_id, t]))
    : null;

  // Written out rather than assembled, so Tailwind sees both class strings. The
  // narrow template carries one value track to the wide one's two — the second
  // column is `hidden @lg:*` on both the heading and the cell, so a track it can't
  // fill would leave a dead gutter down the table.
  const grid = outlookByRoster
    ? "grid-cols-[1.25rem_minmax(0,1fr)_auto] @lg:grid-cols-[2rem_minmax(0,1fr)_auto_auto]"
    : "grid-cols-[1.25rem_minmax(0,1fr)] @lg:grid-cols-[2rem_minmax(0,1fr)]";
  const nameSpan = outlookByRoster ? "col-span-2 @lg:col-span-3" : "col-span-1";

  return (
    <div
      className={`relative rounded-lg border border-foreground/10 ${
        // Only clip when there are no pickers: a picker's menu overhangs the rows,
        // which `overflow-hidden` would cut off. With columns, the header and
        // footer round the corners the clip otherwise would.
        outlookByRoster ? "" : "overflow-hidden"
      } ${elevated ? "z-30" : ""}`}
    >
      <div
        className={`grid ${grid} items-center gap-x-1 rounded-t-lg border-b border-foreground/10 bg-foreground/[0.03] px-1.5 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 @lg:gap-x-2 @lg:px-3 @lg:text-xs`}
      >
        <span className="text-center">#</span>
        <span className="truncate">Manager</span>
        {outlookByRoster &&
          columns.map((key, slot) => (
            <ColumnPicker
              key={slot}
              // The second column only exists once the half is wide enough for
              // it — see the class strings above. The first passes its display
              // back explicitly, because this prop owns the cell's `display`.
              wrapperClassName={
                slot === 0 ? "inline-flex" : "hidden @lg:inline-flex"
              }
              options={TEAM_METRIC_OPTIONS}
              activeKey={key}
              open={openPicker === `team-${slot}`}
              onToggle={() => onTogglePicker(`team-${slot}`)}
              onSelect={(metricKey) => onSelectColumn(slot, metricKey)}
            />
          ))}
      </div>
      <ul>
        {teams.map((team, i) => (
          <StandingsRow
            key={team.roster_id}
            team={team}
            rank={i + 1}
            grid={grid}
            nameSpan={nameSpan}
            columns={outlookByRoster ? columns : null}
            teamOutlook={outlookByRoster?.get(team.roster_id)}
            values={values}
            active={team.roster_id === selectedId}
            onSelect={() => onSelect(team.roster_id)}
          />
        ))}
      </ul>
      {outlook && (
        // The horizon travels with the number, as it does on the roster panel:
        // "rest of season" is however many weeks are actually stored, and a total
        // over three weeks next to one over eighteen is a different claim.
        <p className="rounded-b-lg border-t border-foreground/10 px-1.5 py-1.5 text-[0.65rem] leading-relaxed text-foreground/35 @lg:px-3">
          Projected over the rest of the season · {formatWeekRange(outlook.weeks)}
        </p>
      )}
    </div>
  );
}

function StandingsRow({
  team,
  rank,
  grid,
  nameSpan,
  columns,
  teamOutlook,
  values,
  active,
  onSelect,
}: {
  team: LeagueTeamView;
  rank: number;
  grid: string;
  /** How far the name reaches on its own line — the meta column plus the value columns. */
  nameSpan: string;
  /**
   * The two value columns' metric keys, or null when the league has no
   * projections at all and the columns aren't there.
   */
  columns: string[] | null;
  /** This team's outlook, or undefined when it has none — the metrics render an em dash. */
  teamOutlook: TeamOutlook | undefined;
  /** Per-player KTC and ADP values, summed to this roster's totals for those metrics. */
  values: LeagueRosterValues;
  active: boolean;
  onSelect: () => void;
}) {
  const record = formatRecord(team.record);
  const points = formatPoints(team.fpts);

  // The KTC and ADP metrics read a whole-roster total; the projection ones ignore
  // these. Computed once here rather than per cell, and only when there are value
  // columns to feed.
  const ktcTotal = columns ? rosterValueTotal(team.players, values.ktc) : null;
  const adpTotal = columns ? rosterValueTotal(team.players, values.adp) : null;

  // The username identifies the person; the team name is a per-league nickname
  // that changes at will. Showing the username means the same opponent reads the
  // same across every league, and the team name isn't lost — it moves to the
  // hover, and the roster panel beside this one still leads with it.
  const manager = managerLabel(team);
  const teamName = team.manager?.team_name;
  const title = teamName && teamName !== manager ? `${manager} · ${teamName}` : manager;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={title}
        aria-current={active ? "true" : undefined}
        className={`grid w-full ${grid} items-center gap-x-1 gap-y-0.5 border-l-2 px-1.5 py-1.5 text-left transition-colors @lg:gap-x-2 @lg:px-3 @lg:py-2 ${
          active
            ? "border-active bg-active/10"
            : "border-transparent hover:bg-foreground/[0.04]"
        }`}
      >
        {/* Spans both lines, so the rank numbers a team rather than a line. */}
        <span className="row-span-2 self-center text-center text-[0.65rem] tabular-nums text-foreground/40 @lg:text-sm">
          {rank}
        </span>

        <span className={`${nameSpan} flex min-w-0 items-center gap-1 @lg:gap-2`}>
          <TeamAvatar team={team} label={manager} />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/90 @lg:text-sm">
            {manager}
          </span>
        </span>

        <span className="col-start-2 truncate text-[0.65rem] tabular-nums text-foreground/40 @lg:text-xs">
          {record}
          {/* The record keeps this line at every width; the points-for sheds
              wherever the value columns beside it don't leave room — see the
              two-tier rule above, which is not the monotonic one it looks like. */}
          <span className="hidden @sm:inline @lg:hidden @2xl:inline">
            {" "}
            · {points} PF
          </span>
        </span>

        {columns?.map((key, slot) => {
          const metric: TeamMetric = TEAM_METRICS_BY_KEY[key] ?? TEAM_METRICS[0];
          const cell = metric.cell({
            team,
            outlook: teamOutlook,
            ktcTotal,
            adpTotal,
            superflex: values.superflex,
            draftCount: values.adp_draft_count,
          });
          return (
            <span
              key={slot}
              title={cell.title}
              className={`text-right text-[0.7rem] tabular-nums @lg:text-sm ${
                // Paired with the heading above and the grid template: the second
                // column appears only once the half is wide enough to hold it.
                slot === 0 ? "" : "hidden @lg:block "
              }${cell.text === null ? "text-foreground/25" : "text-foreground/70"}`}
            >
              {cell.text ?? "—"}
            </span>
          );
        })}
      </button>
    </li>
  );
}

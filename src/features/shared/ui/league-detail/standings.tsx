import { formatPoints, formatRecord, formatWeekRange } from "../../format";
import {
  rosterValueTotal,
  TEAM_METRICS,
  TEAM_METRICS_BY_KEY,
  type TeamMetric,
} from "../../standings-metrics";
import { ColumnPicker, type ColumnOption } from "./column-picker";
import { managerLabel, TeamAvatar } from "./team-label";
import type {
  LeagueOutlook,
  LeagueRosterValues,
  LeagueTeamView,
  TeamOutlook,
} from "./types";

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
 * **The heading and the footer are fixed and the rows scroll between them.** The
 * half is one of two that scroll independently inside the card's cap (see
 * {@link LeagueDetailPanel}), and what stays put is what a scrolled list can't
 * do without: the column headings, which are also the pickers that aim those
 * columns, and the footer's week range, which is what the numbers above it are
 * over. It is a twelve-row table beside a forty-row roster, so it usually has no
 * scrollbar at all — the point of the split is that the roster's does not move
 * it.
 *
 * The two value columns are slots the reader points at a team-level metric —
 * projected points and projected bench to start with, swappable to the season
 * optimal, points for, or the roster's whole KTC / ADP total from the heading's
 * picker. Which metric each shows is held above this table (in the panel) so both
 * columns line up down the list and one picker moves the whole column.
 *
 * **Both of them are drawn at every width, and the rank is what paid for it.**
 * The second used to wait for @xl, because the row had no room: a fixed rank
 * gutter spanning both lines took 24px of a 137px row on a phone, and it took it
 * from the line the numbers are on as much as from the line the name is on. As a
 * tab on the row's corner (see `.lab-tab`) the rank rides in the row's own inset
 * and its radius, and 24px reclaimed is almost exactly one more track plus its
 * gap. The name is unaffected either way, which is the part worth keeping hold
 * of: the name line spans every value column, so it is exactly as wide with two
 * as with one — 103px at a 352px phone, against 97px before this.
 *
 * **Four tiers, and every figure in them is measured rather than rounded**, because
 * the narrow one has no slack to round with: at a 320px panel the row has 131px of
 * content and the template below spends 127. In Arial with tabular figures,
 * `3,270.11` is 39.7px at 0.65rem and 42.7px at 0.7rem, and `12-5-1` — the worst
 * record a 17-game season makes — is 30px. A metric whose numbers run wider than
 * those wants the tier re-measured, not the track nudged.
 *
 * The two narrow tiers step the numbers down a size, which is what lets two sit
 * where one sat, and the row's own inset goes to 4px at the base tier. Trimming
 * an inset is the cheap half: nothing is written on the edge it holds content
 * off, where the 8px column gap is the only thing separating two runs of digits
 * (at 4px the record and the value beside it read as one number). Trim the
 * padding, never the gap.
 *
 * The insets are *not* the same on the two halves, and that is arithmetic rather
 * than a lapse: a row here carries its own `px` (it is a lit key, and text hard
 * against a key's edge reads as clipped) where a roster row carries none, so this
 * half's plate is a step tighter to land both lists on a comparable left edge.
 *
 * **The points-for is monotonic now, and that is a consequence rather than a
 * separate decision.** It used to be `@sm:inline @xl:hidden @2xl:inline` — on,
 * off, on — because the second value column arrived at @xl and took back more
 * width than the tier gained. With the column count fixed there is no reversal
 * left to describe: the line waits for one tier and stays. That tier is @3xl
 * rather than the @2xl it used to be, which is the honest price of two wide
 * tracks — `12-5-1 · 1,842.36 PF` measures ~120px against ~114 of cell at @2xl,
 * so it would clip there. What gives below it is still a whole fact rather than
 * half of one, since a shortened name reads as long where a shortened total
 * reads as bad data.
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

  // Written out rather than assembled, so Tailwind sees every class string whole.
  // No rank track in either: the rank is a tab on the row's corner now, so what
  // is left is the name/meta column and the two value tracks — measured against
  // the widest string each has to hold (see the note above), not rounded.
  const grid = outlookByRoster
    ? "grid-cols-[minmax(0,1fr)_2.625rem_2.625rem] " +
      "@sm:grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] " +
      "@lg:grid-cols-[minmax(0,1fr)_4rem_4rem] " +
      "@xl:grid-cols-[minmax(0,1fr)_5rem_5rem]"
    : "grid-cols-[minmax(0,1fr)]";
  const nameSpan = outlookByRoster ? "col-span-3" : "col-span-1";

  // The rail sits on the rows' own inset, or a heading lands a pixel or two off
  // the number under it and the table reads as misaligned. Its *trailing* side
  // carries the scroll lane on top of that inset — 4px, which is what is left of
  // the list's 8px lane once the list has bled the other 4 back into the
  // trough's own padding (see the `<ul>`). Written as `pl`/`pr` rather than a
  // `px` with a `pr` after it: two utilities of one property are decided by
  // their order in the stylesheet, not in the attribute.
  const inset = "pl-1 pr-2 @sm:pl-1.5 @sm:pr-2.5 @lg:pl-3 @lg:pr-4";

  return (
    // A recessed field: this half is the one being *read*, and the roster plate
    // beside it is the one being acted on — the same raised/recessed pairing the
    // app bar draws between its tools key and its current-page chip. Nothing may
    // clip, because a column picker's menu overhangs the rows under it, which is
    // why the sink is inset shadow (`.lab-trough`) rather than a bordered box
    // that would want `overflow-hidden` to round its corners.
    <div
      className={`lab-trough relative flex min-h-0 flex-col rounded-lg p-1 @lg:p-2 ${
        elevated ? "z-30" : ""
      }`}
    >
      <div
        className={`grid shrink-0 ${grid} ${inset} items-center gap-x-2 pb-2 pt-1 text-[0.6rem] text-foreground/40 @lg:text-xs`}
      >
        {/* `invisible`, not `hidden`: the cell has to keep its grid track below
            @lg or the two headings slide left off the columns they name. What
            it captions is a column of avatars and usernames, which is the same
            reason the roster half leaves its own name track empty — and with
            two headings to seat there is no longer room to say it twice.
            A league with no projections has no headings to seat, so it keeps
            its caption at every width. */}
        <span
          className={`truncate uppercase tracking-wide ${
            outlookByRoster ? "invisible @lg:visible" : ""
          }`}
        >
          Manager
        </span>
        {outlookByRoster &&
          columns.map((key, slot) => (
            <ColumnPicker
              key={slot}
              // Sentence case below @lg, and the reason is `Optimal`: uppercase
              // and tracked it measures 43.8px at this rail's size, against a
              // 42px track — and a heading clipped inside its own word reads as
              // broken where a clipped name only reads as long. Written as
              // base-then-variant so no two utilities of one property ever meet
              // on this element.
              className="normal-case tracking-normal @lg:uppercase @lg:tracking-wide"
              options={TEAM_METRIC_OPTIONS}
              activeKey={key}
              open={openPicker === `team-${slot}`}
              onToggle={() => onTogglePicker(`team-${slot}`)}
              onSelect={(metricKey) => onSelectColumn(slot, metricKey)}
            />
          ))}
      </div>
      {/* The list is what scrolls, and only the list: the heading above it holds
          the column pickers, whose menus overhang the rows — inside a scroll
          box they would be clipped by it and would scroll away from the trigger
          that opened them, which is the same reason this half sinks with an
          inset shadow rather than a bordered box that would want a clip of its
          own. The 2px of bottom padding is the last row's own wall
          (`.lab-row`'s `0 2px 0`), which a scroll box would otherwise cut off.

          The bar rides in a lane of its own rather than over the last value
          column — 8px of trailing padding, half of it paid for by bleeding into
          the trough's own inset, so a row gives up 4px and not 8. See
          `.lab-scroll` for why the lane is padding and not
          `scrollbar-gutter`, and the heading rail above for the 4px it gives up
          to stay over the same column. */}
      <ul className="lab-scroll -mr-1 flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain pb-0.5 pr-2">
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
        <p className="shrink-0 px-1 pb-0.5 pt-2 text-[0.65rem] leading-relaxed text-foreground/35 @lg:px-2">
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
  // same across every league, and the team name isn't lost — it moves to this
  // row's hover, which is now the only place it is written: the roster panel
  // beside this one used to head itself with a plate naming the selected team,
  // and that plate restated this row.
  const manager = managerLabel(team);
  const teamName = team.manager?.team_name;
  const title = teamName && teamName !== manager ? `${manager} · ${teamName}` : manager;

  // The lit face is cyan, so every dimmed cell on the row has to stop asking for
  // a shade of the *foreground* token and start asking for a shade of whatever
  // the row is painted in. Opacity does that in one step and keeps the two
  // states one class list; a second palette of on-cyan text colours would be
  // four more literals to keep in step with the face above them.
  const dim = active ? "opacity-70" : "text-foreground/40";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={title}
        aria-current={active ? "true" : undefined}
        // A raised key rather than a tinted row: pressing it drives the roster
        // half beside it, and the selected one is the part that is currently on
        // — the app bar's grammar, at row scale (see `.lab-row`).
        //
        // `relative` is what the rank tab is positioned against.
        className={`relative grid w-full ${grid} items-center gap-x-2 gap-y-0.5 rounded-md px-1 py-1.5 text-left @sm:px-1.5 @lg:px-3 @lg:py-2 ${
          active ? "lab-row-on" : "lab-row"
        }`}
      >
        {/* Out of flow on the corner rather than in a track of its own, which is
            what freed the second value column — see the note above and
            `.lab-tab`. Square into the corner it sits in and rounded away from
            it, so it reads as part of the row's own edge. */}
        <span
          className={`absolute left-0 top-0 inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-br-md rounded-tl-md px-[5px] font-mono text-[9px] font-bold leading-none tracking-[0.04em] ${
            active ? "lab-tab-on text-foreground/90" : "lab-tab text-foreground/60"
          }`}
        >
          {rank}
        </span>

        {/* Indented past the tab's overhang, which is the only thing the name
            gives up — and it gives it up on this line alone. */}
        <span
          className={`${nameSpan} flex min-w-0 items-center gap-1 pl-[22px] @lg:gap-2`}
        >
          <TeamAvatar team={team} label={manager} />
          <span
            className={`min-w-0 truncate text-xs font-medium @lg:text-sm ${
              active ? "font-semibold" : "text-foreground/90"
            }`}
          >
            {manager}
          </span>
        </span>

        <span
          className={`col-start-1 truncate text-[0.6rem] tabular-nums @sm:text-[0.65rem] @lg:text-xs ${dim}`}
        >
          {record}
          {/* The record keeps this line at every width; the points-for waits for
              the tier where it measures as fitting and then stays — see the note
              above on why that is one threshold now rather than three.
              @3xl rather than the @2xl it used to take, because two 5rem tracks
              leave this line less than one 3.25rem track did: at @2xl the whole
              string is ~120px against ~114 of cell, and it clips. */}
          <span className="hidden @3xl:inline"> · {points} PF</span>
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
              // A size step down at the two narrow tiers, which is what lets two
              // numbers sit where one sat. `tabular-nums` holds the column
              // either way.
              className={`text-right text-[0.65rem] tabular-nums @sm:text-[0.7rem] @lg:text-[0.8125rem] @xl:text-sm ${
                // Same reason as `dim` above: on the lit face a shade of the
                // foreground token is a shade of the wrong colour.
                active
                  ? cell.text === null
                    ? "opacity-40"
                    : "opacity-85"
                  : cell.text === null
                    ? "text-foreground/25"
                    : "text-foreground/70"
              }`}
            >
              {cell.text ?? "—"}
            </span>
          );
        })}
      </button>
    </li>
  );
}

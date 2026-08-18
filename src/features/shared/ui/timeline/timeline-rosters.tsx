"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

import type { PlayerSummary } from "@/shared/players";

import { adpValueRead } from "../../adp-controls";
import { useAdpControls } from "../../adp-controls-context";
import { shortPlayerName } from "../../format";
import { leagueDetailNeeds } from "../../league-detail-needs.ts";
import { pickLabel } from "../../pick-value";
import { groupRosterByPosition } from "../../roster-groups";
import type { RosterPlayer } from "../../roster-groups";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_COLUMN_PRESETS,
  PLAYER_METRICS,
  PLAYER_METRICS_BY_KEY,
} from "../../roster-metrics";
import {
  DEFAULT_TEAM_COLUMNS,
  TEAM_COLUMN_PRESETS,
  TEAM_METRICS,
  TEAM_METRICS_BY_KEY,
} from "../../standings-metrics";
import type { TimelineRoster } from "../../timeline";
import {
  NO_TIMELINE_BOARD,
  timelineColumnNote,
  timelinePlayerCell,
  timelinePlayerContext,
  timelineTeamCell,
  timelineTeamContext,
  type TimelineBoard,
} from "../../timeline-columns";
import { useColumnsEditor } from "../../use-columns-editor";
import { useLeagueValues } from "../../use-league-detail";
import { usePersistedColumns } from "../../use-persisted-columns";
import { useTodayIso } from "../../use-today-iso.ts";
import { Avatar } from "../avatar";
import type { ColumnsEditor as ColumnsEditorComponent } from "../columns-editor";
import { ColumnHeading } from "../league-detail/column-heading";
import { COLUMN_GRID, NAME_SPAN, NO_COLUMN_GRID } from "../league-detail/standings";
import { positionTextTone } from "../position-badge";

/**
 * The dialog both halves aim their columns from — the panel's own, loaded on the
 * first press of a heading.
 *
 * Named by module path and `dynamic()` for the reason the panel does it: it is a
 * `<dialog>` nobody has opened, and the trigger is a heading two components down,
 * so the seam is a module boundary rather than an export name.
 */
const ColumnsEditor = dynamic(
  () => import("../columns-editor").then((m) => m.ColumnsEditor),
  { ssr: false },
) as typeof ColumnsEditorComponent;

/**
 * The league at one past moment, in the detail panel's own two-column shape:
 * the managers on the left, the selected one's roster on the right.
 *
 * **It is the panel's layout with the panel's numbers removed, which is the whole
 * of the design.** A reader who scrubs the rail has not changed what they are
 * looking at — the same league, the same two halves, the same selection driving
 * the right one from the left — only *which* players are on the roster. So the
 * grammar is carried over exactly: a recessed field (`.lab-trough`) for the half
 * being read, a raised plate (`.lab-plate-sm`) for the one being looked at, a lit
 * `.lab-row` key for the selected manager, a rank-style tab on the row's corner,
 * and the name/meta pair of lines the standings row already uses.
 *
 * **The panel's stat columns are carried over too, and which of them can answer
 * is the one thing that differs.** This view used to draw no numbers at all, on
 * the reasoning that ranks, records, points for and projections are facts about
 * the league *today* and would be attributing today's numbers to a team that no
 * longer exists. That reasoning is intact and is now enforced per column rather
 * than by dropping the columns: a reader who has aimed both tables at KTC and
 * scrubs back is asking what that roster was worth, and dropping their selection
 * made them press `Now`, read the number, and press back.
 *
 * So the halves draw the same selection the panel is showing — the same stored
 * keys, so there is nothing here to drift — and {@link timelineTeamCell} decides
 * per metric whether the moment can answer it. A board price can: it prices an
 * *asset*, so summing today's KTC or ADP over the players somebody held then is
 * the number a rewind is usually opened for. Everything else draws an em dash
 * with a hover saying to press `Now`, and {@link timelineColumnNote} says so once
 * under both halves rather than leaving a reader to wonder why their columns are
 * blank.
 *
 * The other number that survives is the roster's **size**, which is knowable at
 * any moment and is what a reader is comparing across the league; it takes the
 * seat the record holds on a standings row.
 */
export function TimelineRosters({
  leagueId,
  rosters,
  players,
  managers,
  selectedId,
  onSelect,
  caveat,
}: {
  /**
   * The league these rosters belong to, for pricing them.
   *
   * It is read off the timeline payload rather than passed by either host, since
   * the trades sheet's rail is anchored on a *trade* and only the payload knows
   * which league that trade was in. The values read behind it is the panel's own
   * — same key, same board — so it is a cache hit for every reader who has the
   * panel open, which is every reader who can reach this view.
   */
  leagueId: string;
  /** The league at this stop, in draw order — see {@link timelineRosters}. */
  rosters: TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  /** User ids → who they are, for naming and picturing a roster's holder. */
  managers: Readonly<Record<string, TimelineManager>>;
  /** Which roster the right half is showing. */
  selectedId: number | null;
  onSelect: (rosterId: number) => void;
  /** The line under the halves saying which moment this is, and how it is known. */
  caveat: string;
}) {
  // The board the panel prices on, read from the same store and the same query
  // key — so a drawer narrowed to startup drafts narrows these rosters too, and
  // a reader who has the panel open pays nothing for this.
  const { controls, scope } = useAdpControls();
  const today = useTodayIso();
  const boardRead = useMemo(
    () => adpValueRead(controls, scope, today),
    [controls, scope, today],
  );

  // The panel's own selections, under the panel's own keys — which is what makes
  // this "the columns the current view shows" by construction rather than by a
  // prop somebody has to remember to thread. Both hosts open a league on a
  // *season*, so these are the season keys; a week panel keys its columns apart
  // and has no rail to scrub in any case.
  const {
    columns: teamColumns,
    setColumn: setTeamColumn,
    setColumns: setTeamColumns,
    reset: resetTeamColumns,
  } = usePersistedColumns("standings", DEFAULT_TEAM_COLUMNS, TEAM_METRICS);
  const {
    columns: playerColumns,
    setColumn: setPlayerColumn,
    setColumns: setPlayerColumns,
    reset: resetPlayerColumns,
  } = usePersistedColumns("roster", DEFAULT_PLAYER_COLUMNS, PLAYER_METRICS);

  const teamEditor = useColumnsEditor();
  const rosterEditor = useColumnsEditor();

  // Read only where a column is showing a price, the rule the panel this shares
  // its key with keeps — and here it is the *whole* rule rather than one third of
  // it, because {@link REWINDABLE_METRICS} is `ktc`/`adp` and nothing else: every
  // other column draws its "not at this moment" em dash whatever was fetched. So
  // a rail scrubbed with the default projection columns on screen prices nothing,
  // and an editor opened over it prices everything, on the same latch and for the
  // same reason as the panel's.
  const needsValues =
    leagueDetailNeeds({ week: null, teamColumns, playerColumns }).values ||
    teamEditor.mounted ||
    rosterEditor.mounted;
  const { data: values } = useLeagueValues(leagueId, boardRead, {
    enabled: needsValues,
  });
  const board: TimelineBoard = useMemo(
    () =>
      values
        ? {
            ktc: values.ktc,
            adp: values.adp,
            adp_position: values.adp_position,
            superflex: values.superflex,
            draftCount: values.adp_draft_count,
          }
        : NO_TIMELINE_BOARD,
    [values],
  );
  // A roster the league doesn't hold falls back to the head of the list, the
  // panel's own reading of a `focusRosterId` naming a team that has since been
  // replaced — and the same fallback covers the first render, before anything has
  // been selected at all.
  const selected =
    rosters.find((r) => r.roster_id === selectedId) ?? rosters[0] ?? null;

  // Which of the reader's own columns this moment cannot answer, named once
  // under both halves. Null — and no line at all — when every one of them does.
  const columnNote = timelineColumnNote(teamColumns, playerColumns);

  // What the roster editor previews against: someone on the roster being shown,
  // so the number in the preview is one a reader can find in the list beside it.
  // The first *held* player rather than the first drawn one — the list is
  // grouped by position and this is not — which is the same approximation the
  // panel's own previews make, and why the editor names its subject in the
  // footer rather than letting one row's figure pass as the column's answer.
  // Sleeper pads an unfilled slot with an empty id or a literal "0", so a
  // roster's first *entry* is not necessarily a player.
  const previewId = selected?.players.find((id) => id && id !== "0") ?? null;

  if (!selected) {
    return (
      <p className="px-3 pb-3 pt-1 text-[0.6875rem] text-foreground/35 @lg:px-5 @lg:pb-5">
        No rosters stored for this league yet.
      </p>
    );
  }

  return (
    // The container is a **bare wrapper**, never the box that carries the padding
    // — an element is never its own query container, so `@container` and `@lg:p-*`
    // on one div is a rule that silently never applies. The panel keeps the same
    // split for the same reason, and it is what makes the tiers below measure this
    // view rather than the viewport.
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col pb-3 pl-3 pr-2 pt-2 @lg:pb-5 @lg:pl-5 @lg:pr-4 @lg:pt-3">
        {/* The panel's own split, down to the row template: two equal halves at
            every width, because reading one against the other is the point and
            neither is worth folding away on a phone. `grid-rows-[minmax(0,1fr)]`
            rather than a bare `1fr`, whose auto minimum is the taller half's full
            height — the row would refuse to be smaller than the list it is
            supposed to be scrolling. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-1.5 @lg:gap-4">
          <TimelineTeams
            rosters={rosters}
            managers={managers}
            selectedId={selected.roster_id}
            onSelect={onSelect}
            columns={teamColumns}
            board={board}
            onOpenColumn={teamEditor.open}
          />
          <TimelineRosterDetail
            roster={selected}
            rosters={rosters}
            players={players}
            managers={managers}
            columns={playerColumns}
            board={board}
            onOpenColumn={rosterEditor.open}
          />
        </div>

        {/* Outside both scroll boxes, where the panel keeps its own caveat: a note
            about how the numbers above it are known has to stay on screen with
            them.

            Two sentences and not one: the first says which moment this is, the
            second why some of the reader's own columns are empty at it. The
            second is drawn only where there is a shortfall to report — a note
            saying every column is fine would be a permanent band on the plate. */}
        <div className="mt-2 shrink-0 space-y-1 text-[0.7rem] leading-relaxed text-foreground/40">
          <p>{caveat}</p>
          {columnNote && <p>{columnNote}</p>}
        </div>
      </div>

      {/* Outside the halves, since a `<dialog>` is in the top layer and nothing
          about either scroll box reaches it. One per table, because a team's
          aggregate and a player's number are two catalogues and two selections —
          and both write the *panel's* stored keys, so aiming a column here aims
          it there. */}
      {teamEditor.mounted && (
        <ColumnsEditor
          metrics={TEAM_METRICS}
          columns={teamColumns}
          presets={TEAM_COLUMN_PRESETS}
          ctx={timelineTeamContext(selected.players, board)}
          previewLabel={managerName(selected, managers)}
          openSlot={teamEditor.openSlot}
          onClose={teamEditor.close}
          onColumnChange={setTeamColumn}
          onColumns={setTeamColumns}
          onReset={resetTeamColumns}
        />
      )}
      {rosterEditor.mounted && (
        <ColumnsEditor
          metrics={PLAYER_METRICS}
          columns={playerColumns}
          presets={PLAYER_COLUMN_PRESETS}
          ctx={previewId ? timelinePlayerContext(previewId, board) : null}
          previewLabel={previewId ? (players[previewId]?.name ?? previewId) : null}
          openSlot={rosterEditor.openSlot}
          onClose={rosterEditor.close}
          onColumnChange={setPlayerColumn}
          onColumns={setPlayerColumns}
          onReset={resetPlayerColumns}
        />
      )}
    </div>
  );
}

/** What this view names a roster's holder by, and the avatar's fallback initial. */
function managerName(
  roster: TimelineRoster,
  managers: Readonly<Record<string, TimelineManager>>,
): string {
  const manager = roster.user_id ? managers[roster.user_id] : undefined;
  return manager?.display_name || `Roster ${roster.roster_id}`;
}

/** As much of a manager as this view names one by. */
export type TimelineManager = {
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * The managers, as the standings' own field: a recessed trough of lit keys, one
 * per roster, driving the half beside it.
 *
 * **The corner tab holds the roster number rather than a rank**, which is the one
 * substitution this half makes. A rank is against a field of records and
 * projections that only exist for today; a roster id is a fact at every moment,
 * it is stable as the rail moves, and it is what the roster's own picks are named
 * from a few pixels to the right ("2027 1st (roster 4)" where a holder has left).
 */
function TimelineTeams({
  rosters,
  managers,
  selectedId,
  onSelect,
  columns,
  board,
  onOpenColumn,
}: {
  rosters: TimelineRoster[];
  managers: Readonly<Record<string, TimelineManager>>;
  selectedId: number;
  onSelect: (rosterId: number) => void;
  /** The standings' own selection — see {@link TimelineRosters}. */
  columns: string[];
  board: TimelineBoard;
  onOpenColumn: (slot: number) => void;
}) {
  // The standings' own templates, so a rewound row sits on the same tracks as the
  // row it replaced and the two readings do not step sideways as the rail moves.
  const grid = COLUMN_GRID[columns.length] ?? NO_COLUMN_GRID;
  const nameSpan = NAME_SPAN[columns.length] ?? "col-span-1";
  const inset = "pl-1 pr-2 @sm:pl-1.5 @sm:pr-2.5 @lg:pl-3 @lg:pr-4";

  return (
    <div className="lab-trough flex min-h-0 flex-col rounded-lg p-1 @lg:p-2">
      <div
        className={`grid shrink-0 ${grid} ${inset} items-center gap-x-2 pb-2 pt-1 text-[0.6rem] text-foreground/50 @lg:text-xs`}
      >
        {/* `invisible` rather than `hidden` below @lg: the cell has to keep its
            grid track or the headings beside it slide left off the columns they
            name. With no headings to seat there is room to say it at every
            width — the standings' own rule. */}
        <span
          className={`truncate uppercase tracking-wide ${
            columns.length > 0 ? "invisible @lg:visible" : ""
          }`}
        >
          Manager
        </span>
        {columns.map((key, slot) => (
          <ColumnHeading
            key={slot}
            className="normal-case tracking-normal @lg:uppercase @lg:tracking-wide"
            label={(TEAM_METRICS_BY_KEY[key] ?? TEAM_METRICS[0]).label}
            onOpen={() => onOpenColumn(slot)}
          />
        ))}
      </div>
      {/* The list is what scrolls. The bar rides in a lane of its own rather than
          over the rows' trailing edge — 8px of padding, half of it paid for by
          bleeding into the trough's own inset, which is the standings' own
          arrangement. */}
      <ul className="lab-scroll -mr-1 flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain pb-0.5 pr-2">
        {rosters.map((roster) => (
          <TimelineTeamRow
            key={roster.roster_id}
            roster={roster}
            manager={roster.user_id ? managers[roster.user_id] : undefined}
            active={roster.roster_id === selectedId}
            onSelect={() => onSelect(roster.roster_id)}
            grid={grid}
            nameSpan={nameSpan}
            columns={columns}
            board={board}
          />
        ))}
      </ul>
    </div>
  );
}

function TimelineTeamRow({
  roster,
  manager,
  active,
  onSelect,
  grid,
  nameSpan,
  columns,
  board,
}: {
  roster: TimelineRoster;
  manager: TimelineManager | undefined;
  active: boolean;
  onSelect: () => void;
  grid: string;
  nameSpan: string;
  columns: string[];
  board: TimelineBoard;
}) {
  const name = manager?.display_name || `Roster ${roster.roster_id}`;
  // On the lit face a shade of the foreground token is a shade of the wrong
  // colour, so the dim cell switches to opacity — the standings row's own rule.
  const dim = active ? "opacity-70" : "text-foreground/40";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={name}
        aria-current={active ? "true" : undefined}
        // A raised key rather than a tinted row: pressing it drives the roster
        // half beside it, and the selected one is the part that is currently on.
        // `relative` is what the corner tab is positioned against.
        className={`relative grid w-full ${grid} items-center gap-x-2 gap-y-0.5 rounded-md px-1 py-1.5 text-left @sm:px-1.5 @lg:px-3 @lg:py-2.5 ${
          active ? "lab-row-on" : "lab-row"
        }`}
      >
        <span
          className={`absolute left-0 top-0 inline-flex h-[1.0625rem] min-w-[1.625rem] items-center justify-center rounded-br-md rounded-tl-md px-[0.3125rem] font-mono text-[0.5625rem] font-bold leading-none tracking-[0.04em] ${
            active ? "lab-tab-on text-foreground/90" : "lab-tab text-foreground/60"
          }`}
        >
          {roster.roster_id}
        </span>

        {/* Indented past the tab's overhang, which it gives up on this line
            alone — the standings row's own construction. It spans every track of
            its own template, so a long name runs under the value columns rather
            than being squeezed into the name track twice over. */}
        <span
          className={`col-start-1 ${nameSpan} flex min-w-0 items-center gap-1 pl-[1.375rem] @lg:gap-2`}
        >
          <Avatar url={manager?.avatar_url ?? null} name={name} size="sm" />
          <span
            className={`min-w-0 truncate text-[0.8125rem] font-medium @lg:text-[0.9375rem] @2xl:text-base ${
              active ? "font-semibold" : "text-foreground/90"
            }`}
          >
            {name}
          </span>
        </span>

        {/* The seat the record holds on a standings row, carrying the one number
            a rewind actually knows. `in this trade` marks the sides rather than a
            tinted row or a badge: at this width a word is what fits, and it is
            the reason the sheet is open. */}
        <span
          className={`col-start-1 truncate text-[0.6rem] tabular-nums @sm:text-[0.7rem] @lg:text-xs ${dim}`}
        >
          {roster.players.length}{" "}
          {roster.players.length === 1 ? "player" : "players"}
          {roster.dealt && <span> · in this trade</span>}
        </span>

        {/* The standings' own cells, on the standings' own tracks. A metric this
            moment cannot answer is an em dash carrying the reason — see
            {@link timelineTeamCell}. */}
        {columns.map((key, slot) => {
          const cell = timelineTeamCell(key, roster.players, board);
          return (
            <span
              key={slot}
              title={cell.title}
              className={`text-right text-[0.65rem] tabular-nums @sm:text-[0.7rem] @lg:text-[0.8125rem] @xl:text-sm ${
                // On the lit face a shade of the foreground token is a shade of
                // the wrong colour, so the dim cell switches to opacity — the
                // standings row's own rule.
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

/**
 * The selected manager's roster as it stood, on the panel's raised plate.
 *
 * **One list with a chip lane, not sections**, which is the panel's own roster row
 * and is what makes this read as the same half. The chip there is a *lineup slot*;
 * here it is the player's **position**, because a lineup is a solve — over
 * eligibility, projections and this league's slots — and none of those is a fact
 * about a past roster: the projections are rest-of-season from today, and Sleeper
 * stores no historical lineup at all. So the lane carries what is knowable, in the
 * same 26px tab washed by the same `positionTextTone`, and the colour scan down the
 * list survives unchanged.
 *
 * A first cut drew a captioned section per position. It is the ordering rosters
 * have been written in for thirty years and it was wrong *here*: a heading plus a
 * gap per position turned a twelve-man roster into five headings and eight rows,
 * so the column was mostly furniture. The chip says the same thing per row, in the
 * lane the panel already has for it.
 *
 * **The order is still by position** — {@link groupRosterByPosition}, flattened —
 * so the chips run in lineup order rather than alphabetically.
 *
 * **It names no team of its own**, the panel's rule at this grain: the half beside
 * it has the selected manager lit a few pixels to the left, and a plate repeating
 * the name would be the restatement that panel's own team plate was removed for.
 */
function TimelineRosterDetail({
  roster,
  rosters,
  players,
  managers,
  columns,
  board,
  onOpenColumn,
}: {
  roster: TimelineRoster;
  /** Every roster, for naming the one an acquired pick came from. */
  rosters: TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  managers: Readonly<Record<string, TimelineManager>>;
  /** The roster panel's own selection — see {@link TimelineRosters}. */
  columns: string[];
  board: TimelineBoard;
  onOpenColumn: (slot: number) => void;
}) {
  const lines = groupRosterByPosition(roster.players, players).flatMap((group) =>
    group.players.map((player) => ({ position: group.position, player })),
  );
  const grid = PLAYER_GRID[columns.length] ?? PLAYER_GRID[0];

  return (
    <div className="lab-plate lab-plate-sm flex min-h-0 flex-col rounded-lg p-1 @sm:p-1.5 @lg:p-4">
      {/* The caption is the rail's own first cell rather than a line above it,
          which is what keeps the headings on the tracks they name without
          spending a second line on a half this narrow. It is outside the scroll
          box for the panel's reason: a heading is the only name a column of bare
          numbers has, *and* the way to change one, so a rail that scrolled away
          would be one a reader has to go back for. */}
      <div
        className={`grid shrink-0 ${grid} items-baseline gap-x-2 px-1 pb-1.5 text-[0.6rem] uppercase tracking-wide text-foreground/50 @lg:px-0 @lg:text-xs`}
      >
        <span className="truncate @3xl:col-span-2">Roster</span>
        {columns.map((key, slot) => (
          <ColumnHeading
            key={slot}
            className="text-[0.6rem] normal-case tracking-normal @lg:uppercase @lg:tracking-wide"
            label={(PLAYER_METRICS_BY_KEY[key] ?? PLAYER_METRICS[0]).label}
            onOpen={() => onOpenColumn(slot)}
          />
        ))}
      </div>

      <div className="lab-scroll -mr-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
        {lines.length === 0 && roster.picks.length === 0 ? (
          // Stored *and* empty is a real answer — a pre-draft expansion team
          // genuinely held nobody — where an absent roster is not, which is why
          // a league with nothing stored draws no halves at all rather than a
          // column of these.
          <p className="px-1 py-2 text-[0.7rem] text-foreground/30">Held nothing</p>
        ) : (
          <ul className="flex flex-col">
            {lines.map(({ position, player }) => (
              <PlayerLine
                key={player.player_id}
                position={position}
                player={player}
                grid={grid}
                columns={columns}
                board={board}
              />
            ))}
          </ul>
        )}

        {roster.picks.length > 0 && (
          <div className="mt-3">
            {/* `h3`, not `h4`: the league's name is the `h2` above it in both
                hosts — the sheet's own header and the card's nameplate. The
                picks are the tail of this list rather than a section of it, which
                is where the panel puts its own. */}
            <h3 className="mb-1 truncate px-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-foreground/45 @lg:text-xs">
              Picks
            </h3>
            <ul className="flex flex-col">
              {roster.picks.map((pick) => {
                // The origin is named exactly when the pick did *not* come from
                // this roster, `pick-display`'s own rule: naming the holder
                // beside their own pick is noise on most of a portfolio. No
                // draft order here, so it is the round spelling — "2027 1st" —
                // which is the honest one for a pick seasons out anyway.
                const label = pickLabel(pick, null);
                const origin = rosters.find((r) => r.roster_id === pick.roster_id);
                const from = origin?.user_id ? managers[origin.user_id] : undefined;
                return (
                  <li
                    key={`${pick.season}-${pick.round}-${pick.roster_id}`}
                    className={`${ROW_BAND} px-1 py-1`}
                  >
                    <span className="min-w-0 truncate text-[0.8125rem] text-foreground/70">
                      {label}
                      {pick.roster_id !== roster.roster_id && (
                        <span className="text-foreground/35">
                          {" "}
                          from {from?.display_name || `roster ${pick.roster_id}`}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The band that parts two rows.
 *
 * The panel's own, and for its reason: a list this short-lined wants a tone rather
 * than forty hairlines of drawn furniture. `@max-3xl:` rather than an `odd:` turned
 * off later, since two variants of one property tie on specificity *and* source
 * order — the failure would be a banded one-line list, which looks deliberate and
 * is not. It bleeds 4px past the row's box to reach the plate's inset, and the
 * `px-1` at each call site puts the content back where it was.
 */
const ROW_BAND = "-mx-1 @max-3xl:odd:bg-foreground/[0.022]";

/**
 * One player: his position on a chip, then who he is and who he plays for.
 *
 * The panel's roster row, with the position in the lane its slot chip rides in.
 * Below `@3xl` the chip is out of flow on the row's leading corner — so it costs
 * the row nothing but the name's indent — and from `@3xl` it is the first cell of
 * the grid, which is the same switch the panel makes and at the same tier.
 *
 * The name is the only thing that truncates: a shortened name still reads as a
 * name, where `LAR` clipped to `LA` reads as a different team.
 */
function PlayerLine({
  position,
  player,
  grid,
  columns,
  board,
}: {
  position: string;
  player: RosterPlayer;
  grid: string;
  columns: string[];
  board: TimelineBoard;
}) {
  const tone = positionTextTone(position);
  const short = shortPlayerName(player.name, position);

  return (
    <li
      className={`${ROW_BAND} relative grid ${grid} items-center gap-x-2 px-1 py-1 @3xl:py-2`}
    >
      {/* `left-0` rather than a negative offset: the list is inside a scroll box,
          and `overflow-y: auto` computes `overflow-x` to `auto` too — so anything
          reaching past the box's leading edge is clipped rather than overhanging.
          The panel learned that one the hard way. */}
      <span
        className={`lab-tab lab-tab-pos absolute left-0 top-[2px] inline-flex h-[1.0625rem] min-w-[1.625rem] items-center justify-center rounded-[5px] px-1 font-mono text-[0.5625rem] font-bold uppercase leading-none tracking-[0.04em] @3xl:static @3xl:top-auto @3xl:w-full ${tone}`}
      >
        {position}
      </span>

      <span
        title={player.name}
        className="flex min-w-0 items-baseline gap-1.5 pl-[2.125rem] text-[0.8125rem] text-foreground/85 @3xl:pl-0 @4xl:text-sm"
      >
        {/* Contracted below `@lg` and whole above it, the panel's own treatment
            and its arithmetic: at this width the name track is roughly where real
            player names *start*, so `Bijan Robinson` truncates to `Bijan Robi…`
            where `B. Robinson` fits whole. A length threshold cannot express that
            — the two are 14 and 17 characters and the shorter one is the wider —
            so every name contracts and the column stays uniform, which is how a
            box score has been written for a century. Both spans are rendered
            rather than branched on, since most names differ between them; where
            they agree (a team defence, a name with no space) one is drawn. */}
        {short === player.name ? (
          <span className="min-w-0 truncate">{player.name}</span>
        ) : (
          <span className="min-w-0 truncate">
            <span className="@lg:hidden">{short}</span>
            <span className="hidden @lg:inline">{player.name}</span>
          </span>
        )}
        {player.team && (
          <span className="shrink-0 text-[0.7rem] text-foreground/35">
            {player.team}
          </span>
        )}
      </span>

      {/* The roster panel's own cells. A metric this moment cannot answer is an
          em dash carrying the reason — see {@link timelinePlayerCell}. */}
      {columns.map((key, slot) => {
        const cell = timelinePlayerCell(key, player.player_id, board);
        return (
          <span
            key={slot}
            title={cell.title}
            className={`text-right text-[0.65rem] tabular-nums @sm:text-[0.7rem] @lg:text-[0.8125rem] @xl:text-sm ${
              cell.text === null ? "text-foreground/25" : "text-foreground/70"
            }`}
          >
            {cell.text ?? "—"}
          </span>
        );
      })}
    </li>
  );
}

/**
 * The row template for each value-column count, written out rather than
 * assembled so Tailwind sees every class string whole.
 *
 * The value tracks are the standings' own measurements, because the two halves
 * are the same width — what differs is only the leading cell: the position chip
 * is out of flow below `@3xl` (so it costs the row nothing but the name's
 * indent) and the grid's first track from `@3xl` up, which is the switch the
 * panel's own roster row makes at the same tier.
 */
const PLAYER_GRID: Record<number, string> = {
  0: "grid-cols-[minmax(0,1fr)] @3xl:grid-cols-[2.25rem_minmax(0,1fr)]",
  1:
    "grid-cols-[minmax(0,1fr)_2.625rem] " +
    "@sm:grid-cols-[minmax(0,1fr)_2.75rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_4rem] " +
    "@xl:grid-cols-[minmax(0,1fr)_5rem] " +
    "@3xl:grid-cols-[2.25rem_minmax(0,1fr)_5rem]",
  2:
    "grid-cols-[minmax(0,1fr)_2.625rem_2.625rem] " +
    "@sm:grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_4rem_4rem] " +
    "@xl:grid-cols-[minmax(0,1fr)_5rem_5rem] " +
    "@3xl:grid-cols-[2.25rem_minmax(0,1fr)_5rem_5rem]",
};

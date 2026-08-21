"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useState, type ReactNode } from "react";

// Both imported directly rather than through their barrels, which would pull
// `pg`-backed code into the client bundle — see `slots.ts` and `rank.ts`.
import { orderByProjectedPoints } from "@/shared/manager/rank";
import { DEFENSIVE_SLOTS } from "@/shared/projections/slots";

// The module paths rather than `features/shared`'s own barrel, which this file is
// inside of: a barrel importing a subtree that imports the barrel is a cycle, and
// this panel is deliberately absent from it in any case (see `./index.ts`).
import { adpValueRead } from "../../adp-controls";
import { useAdpControls } from "../../adp-controls-context";
import { leagueDetailNeeds } from "../../league-detail-needs.ts";
import { useTodayIso } from "../../use-today-iso.ts";
import {
  DEFAULT_PLAYER_COLUMNS,
  DEFAULT_WEEK_PLAYER_COLUMNS,
  PLAYER_COLUMN_PRESETS,
  PLAYER_METRICS,
  type PlayerMetricContext,
} from "../../roster-metrics";
import {
  DEFAULT_TEAM_COLUMNS,
  DEFAULT_WEEK_TEAM_COLUMNS,
  rosterValueTotal,
  TEAM_COLUMN_PRESETS,
  TEAM_METRICS,
  type TeamMetricContext,
} from "../../standings-metrics";
import { degradedNotice } from "../../degraded";
import { useColumnsEditor } from "../../use-columns-editor";
import { useLeagueDetail } from "../../use-league-detail";
import { usePersistedColumns } from "../../use-persisted-columns";
import type { ColumnsEditor as ColumnsEditorComponent } from "../columns-editor";
import { DegradedNotice, PanelLoading, PanelMessage } from "../panel-message";
import { headToHead } from "./head-to-head";
import { PanelSettings } from "./panel-settings";
import {
  PanelHead,
  PanelTabs,
  panelBodyId,
  panelTabId,
  type PanelTab,
} from "./panel-tabs";
import { RosterDetail } from "./roster-detail";
import { RosterHeading } from "./roster-heading";
import { Standings } from "./standings";
import { LeagueSyncKey } from "./sync-key";
import { managerLabel } from "./team-label";
import type { LeagueDetailResult, LeagueTeamView, TeamOutlook } from "./types";
import { WeekMedianBar } from "./week-median";

/**
 * The dialog both of this panel's tables aim their columns from, loaded the
 * first time a heading is pressed.
 *
 * The same component the lists' heading rail opens, so the two tools' boards are
 * edited the same way — and the same `dynamic()` for the same reason: it is a
 * `<dialog>` nobody has opened, and its slot previews, captioned bays and preset
 * row are not small. The trigger is three modules away (the headings live in
 * `Standings` and `RosterDetail`), so the seam is a module boundary and the split
 * is real rather than nominal.
 *
 * `dynamic` erases the generic, so the loaded component is cast back to what it
 * is — safe because the cast names the very module being imported.
 */
const ColumnsEditor = dynamic(
  () => import("../columns-editor").then((m) => m.ColumnsEditor),
  { ssr: false },
) as typeof ColumnsEditorComponent;

/**
 * A league's standings on the left and the selected team's roster on the right.
 * Loads its own data the first time it mounts, which is when whatever holds it
 * is opened.
 *
 * **It renders on the structural read and lets the rest fill in.** The rosters,
 * the standings, the managers and the player names are one request; the KTC and
 * ADP prices, the rest-of-season lineups and (on a week panel) that week's
 * projections are three more, each landing on its own. So the loading state ends
 * as soon as there is a league to draw, and the value columns sit at an em dash
 * for the moment it takes their own read to answer rather than holding the whole
 * panel behind the slowest of four. Nothing below this needed changing for that:
 * every one of those components already drew an em dash for "no answer", which
 * is exactly what a request still in flight looks like. See
 * {@link useLeagueDetail}.
 *
 * **It is in `features/shared` because a second tool draws it**, which is the
 * mover's rule and not a filing preference: the leagues list expands a card into
 * this panel, and the trades board opens a trade card into the same thing, since
 * "what does that league look like" is the question a trade raises. What went
 * with it is what it reads — the two metric catalogues its columns pick from, the
 * query key and TTL behind `useLeagueDetail`, the four formatters it is written
 * in, and the two panel states. What did *not* go is anything about a manager:
 * this panel has never asked whose leagues these are, which is why it ports to a
 * page that has no account at all.
 *
 * It is deliberately absent from `features/shared/index.ts` — see `./index.ts`.
 *
 * **The panel is a fixed head over two independently scrolling halves.** The
 * card caps itself at the viewport, and the whole panel used to scroll inside
 * that cap as one box — which carried away the things a reader needs in order to
 * read what is left. The head is the tab strip, which is the only way back to
 * whichever reading is not on screen; and each half's column headings are what
 * say which metric its value columns are pointed at, so a list scrolled past its
 * own heading is a column of unlabelled numbers. Those headings are controls too
 * — pressing one opens the columns editor armed on that slot — and a control
 * that scrolls away is one you have to go back for.
 *
 * **Aiming a column is the lists' own dialog, not a menu of this panel's.** Each
 * table used to hang a flat catalogue under whichever heading was pressed, which
 * is exactly the shape {@link ColumnsEditor} was written to replace one tool
 * over: no preview of what a column would say, no named pair, and nothing about
 * which other slot already holds the metric being picked. Both tables open that
 * dialog now — one each, since a team's aggregate and a player's number are two
 * catalogues and two selections — so the board is edited the same way here as on
 * the leagues list that expands into this panel. What that retired along with the
 * menus is a whole apparatus this file used to own: one-picker-at-a-time, an
 * outside-click listener, an Escape listener, and each half lifting its stacking
 * order over the other so an overhanging menu wasn't painted under it. A
 * `<dialog>` is in the top layer and reports every way out through its own
 * `close` event, so all four are the platform's.
 *
 * The two halves scroll separately rather than together for the reason they are
 * side by side at all: reading one against the other is the point, and a roster
 * forty rows deep beside a twelve-team table means one list runs out long before
 * the other. Scrolled as one box, finding a player meant taking the standings
 * with him.
 *
 * That takes a height chain rather than a `overflow` class, and every link in it
 * is `0 1 auto` on purpose — nothing here is `flex-1`, so a short panel is still
 * exactly as tall as its contents and only one that would run past the card's
 * ceiling shrinks into it. `min-h-0` at each link is what allows that shrink,
 * since a flex item's floor is its own content otherwise, and the grid holding
 * the two halves needs `grid-rows-[minmax(0,1fr)]` for the same reason one step
 * over: a bare `1fr` row is `minmax(auto,1fr)`, whose auto minimum is the taller
 * half's full height — the row would refuse to be smaller than the list it is
 * supposed to be scrolling.
 *
 * **What bounds that chain belongs to whatever is holding the panel, and both
 * holders have to supply one.** The leagues list caps its open card at the
 * viewport; the trades board's sheet is a `<dialog>` of a fixed height whose body
 * does not scroll. A holder that let the panel run — a plain `overflow-y-auto`
 * box around it — would leave every `min-h-0` here with nothing to resolve
 * against, and the fixed head and the two scrolling halves would silently become
 * one long scroll again. That failure typechecks and renders.
 */
export function LeagueDetailPanel({
  leagueId,
  focusRosterId,
  opponentRosterId,
  week = null,
}: {
  leagueId: string;
  /**
   * Which roster the roster half opens on, where the caller has a reason to
   * prefer one — a trade card knows the rosters that dealt, and landing on a
   * stranger's bench would answer a question nobody asked. Omitted by the leagues
   * list, which arrives at a league rather than at a team and opens on the
   * projected leader; a roster this league doesn't hold falls back to the same.
   */
  focusRosterId?: number;
  /**
   * The roster on the other side of this week's game, which turns the panel into
   * a head-to-head: {@link focusRosterId}'s roster on the left, this one on the
   * right, and no standings between them.
   *
   * Only the lineup checker passes it, and only where it has a game to name — a
   * bye, an unsynced week or a roster that has left the league since the matchup
   * was read all fall back to the standings, which is the more useful thing to
   * show when there is nobody to play. {@link headToHead} is that rule.
   */
  opponentRosterId?: number;
  /**
   * Read this league **as one week** rather than as the rest of a season.
   *
   * The lineup checker passes its selected week; the leagues list and the trades
   * board pass nothing, which is what they want — a reader who arrived at a
   * league is asking about its shape, and a reader who arrived at a lineup is
   * asking about one Sunday. What it changes is what each table opens on — a
   * single column carrying this week's projection, against the rest-of-season
   * split's pair — and, because that number comes off the same payload, what is
   * requested and how the answer is keyed.
   *
   * The two selections are stored apart — see {@link DEFAULT_WEEK_TEAM_COLUMNS}
   * — so aiming a column here is not aiming it on the leagues list.
   */
  week?: number | null;
}) {
  // The same board the collapsed card above is priced on, read from the same
  // store — this panel has no controls of its own, so a selection made in the
  // drawer is the only thing that can move its two value columns, and being
  // driven by a *different* selection from the card that opened it is what this
  // replaced.
  const { controls, scope } = useAdpControls();
  // Watched rather than read once, so a relative window follows the calendar in
  // a panel left open overnight — see {@link useTodayIso}.
  const today = useTodayIso();
  const board = useMemo(
    () => adpValueRead(controls, scope, today),
    [controls, scope, today],
  );

  // Each table's two value columns are slots the reader points at a metric — the
  // standings at a team-level one, the roster at a player-level one. Stored on
  // the device rather than held here, so the choice outlives this panel: it
  // mounts on expand and unmounts on collapse, which used to reset both tables
  // every time a different league was opened. One key per grain, not per league —
  // what a column means is a fact about the catalogue, not about this league.
  //
  // A panel opened on a *week* keys its two selections apart from one opened on
  // a season, and that is the grain rule rather than an exception to it: "this
  // team over the rest of the year" and "this team on Sunday" are two questions,
  // so a column aimed at one is not a column aimed at the other. Same catalogue
  // either way — everything is pickable from either panel — and what differs is
  // what each opens on and how many slots it has (one on a week, two on a
  // season: `resolveColumns` takes the row's length from the defaults).
  //
  // **They are read here rather than in the loaded panel below, and that is what
  // keeps the enrichments off a waterfall.** What they cost in requests is
  // derived from them (see `needs`), and `Panel` renders only once the core has
  // landed — so deriving it down there would have made every enrichment wait for
  // the read it is supposed to run beside. Nothing about them needs fetching:
  // `localStorage` answers on the first render after hydration.
  const teamColumnState = usePersistedColumns(
    week === null ? "standings" : "standings-week",
    week === null ? DEFAULT_TEAM_COLUMNS : DEFAULT_WEEK_TEAM_COLUMNS,
    TEAM_METRICS,
  );
  const rosterColumnState = usePersistedColumns(
    week === null ? "roster" : "roster-week",
    week === null ? DEFAULT_PLAYER_COLUMNS : DEFAULT_WEEK_PLAYER_COLUMNS,
    PLAYER_METRICS,
  );

  // One editor per table, because they are two catalogues and two selections —
  // a team's aggregate and a player's number are not choices from one list. Each
  // holds which heading opened it, so a press lands on the column the reader
  // meant rather than on a dialog they then have to aim. Hoisted with the
  // selections they edit, and for a second reason of their own: `mounted`
  // latches on the first press, which is the signal below that a reader is
  // *looking at the catalogue* and wants its previews filled in.
  const teamEditor = useColumnsEditor();
  const rosterEditor = useColumnsEditor();

  /**
   * Which of the three enrichment reads anything on screen actually needs.
   *
   * Two of them used to fire on every open regardless of where the columns were
   * pointed — see {@link leagueDetailNeeds}, which is the rule — so a lineup
   * checker opened on one Sunday ran a season-long lineup solve per team and
   * priced a KTC/ADP board, neither of which it drew, both competing with the
   * week read it opened *for*.
   *
   * **An open columns editor widens it to both, and that is demand rather than
   * an exception to it.** The dialog previews every metric in its catalogue
   * against the panel's own subject, so a reader who has opened it is looking at
   * what KTC and the rest-of-season split would say — a bay of em dashes is the
   * one thing that would make the picker useless. It follows the editor's
   * `mounted` latch rather than whether it is open, for the reason that latch
   * exists: a preview that filled in and then emptied on close would be worse
   * than one that never filled, and the reads are cached by then either way.
   *
   * The week is deliberately *not* widened. There is no week for a season panel
   * to preview against, which is what the `week_proj` cell says in words.
   */
  const previewing = teamEditor.mounted || rosterEditor.mounted;
  const needs = useMemo(() => {
    const columns = leagueDetailNeeds({
      week,
      teamColumns: teamColumnState.columns,
      playerColumns: rosterColumnState.columns,
    });
    return previewing ? { ...columns, values: true, outlook: true } : columns;
  }, [week, teamColumnState.columns, rosterColumnState.columns, previewing]);

  const { data, loading, error, degraded } = useLeagueDetail(
    leagueId,
    board,
    week,
    needs,
  );
  // The price lenses fail apart from each other and apart from the rosters, so a
  // lens that could not answer is a line above a panel that still draws — never
  // the panel's own error, which replaces it.
  const degradedLine = degradedNotice(degraded);

  // The query container is here rather than around the loaded panel alone, so
  // every state this can be in is measured against one width — including the
  // three below, which carry the inset themselves now that the card wraps this
  // in nothing (the padding belongs to what is drawn on the card's face, not to
  // the act of expanding). It holds no box of its own, per the rule an
  // `@container` has to keep: an element is never its own query container.
  //
  // The flex column is the first link of the height chain the two halves scroll
  // through, and it is not a box in that sense: none of these classes is a
  // `@`-prefixed variant, so nothing here is measured against the container it
  // declares.
  return (
    <div className="@container flex min-h-0 flex-col">
      {loading && !data ? (
        <PanelState>
          <PanelLoading>Loading rosters…</PanelLoading>
        </PanelState>
      ) : error ? (
        <PanelState>
          <PanelMessage tone="error">{error}</PanelMessage>
        </PanelState>
      ) : !data || data.teams.length === 0 ? (
        <PanelState>
          <PanelMessage>No roster data yet.</PanelMessage>
        </PanelState>
      ) : (
        <>
          {degradedLine && <DegradedNotice>{degradedLine}</DegradedNotice>}
          <Panel
            data={data}
            focusRosterId={focusRosterId}
            opponentRosterId={opponentRosterId}
            week={week}
            teamColumnState={teamColumnState}
            rosterColumnState={rosterColumnState}
            teamEditor={teamEditor}
            rosterEditor={rosterEditor}
          />
        </>
      )}
    </div>
  );
}

/** One table's stored column selection, as {@link usePersistedColumns} hands it over. */
type ColumnState = ReturnType<typeof usePersistedColumns>;
/** One table's columns editor, as {@link useColumnsEditor} hands it over. */
type EditorState = ReturnType<typeof useColumnsEditor>;

/** The panel's inset around a state that isn't the panel. */
function PanelState({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-3 pt-1 @lg:px-5 @lg:pb-5">{children}</div>;
}

function Panel({
  data,
  focusRosterId,
  opponentRosterId,
  week,
  teamColumnState,
  rosterColumnState,
  teamEditor,
  rosterEditor,
}: {
  data: LeagueDetailResult;
  focusRosterId?: number;
  opponentRosterId?: number;
  week: number | null;
  /**
   * The two selections and the two editors, owned one level up.
   *
   * They belong to the panel rather than to its loaded body because what they
   * cost in requests is derived from them, and this component renders only once
   * the core read has landed — see {@link LeagueDetailPanel}. Threading them
   * through is the price of not putting the enrichments behind the core.
   */
  teamColumnState: ColumnState;
  rosterColumnState: ColumnState;
  teamEditor: EditorState;
  rosterEditor: EditorState;
}) {
  // Projected-points order, not standings order — the table's own Proj column
  // is what the rows are ranked on, so the numbers descend down the page and
  // the row's position agrees with the rank chip on the collapsed card. Ties
  // and teams with no projection (or a league with none at all) fall back to
  // the standings order the server sent.
  const teams = useMemo(
    () =>
      orderByProjectedPoints(
        data.teams,
        data.outlook
          ? new Map(
              data.outlook.teams.map((t) => [t.roster_id, t.weekly_optimal_points]),
            )
          : null,
      ),
    [data],
  );

  // Seeded rather than followed: `focusRosterId` says where to *open*, and a
  // reader who then presses a standings row must not have that press undone the
  // next time this re-renders. A caller opening the panel at a different team
  // remounts it (the sheet keys on the pair), which is free — the detail is a
  // cached query by then.
  //
  // **Null until something is actually chosen**, which the outlook arriving
  // separately is what makes necessary. The head of `teams` is the projected
  // leader once the outlook lands and the standings leader before it, so a
  // selection *initialised* to `teams[0]` would pin whichever row happened to
  // lead during the first render — the standings leader, always, since the
  // projections are now a request behind. Read as a fallback instead, the panel
  // opens on the standings leader and follows the ranking the moment it arrives,
  // and any press pins the choice for good.
  const [pickedId, setPickedId] = useState<number | null>(focusRosterId ?? null);
  // A roster the league doesn't hold — a trade whose participants have since been
  // replaced — falls back to the head of the list rather than to nothing.
  const selected = teams.find((t) => t.roster_id === pickedId) ?? teams[0];

  const {
    columns: teamColumns,
    setColumn: setTeamColumn,
    setColumns: setTeamColumns,
    reset: resetTeamColumns,
  } = teamColumnState;
  const {
    columns: rosterColumns,
    setColumn: setRosterColumn,
    setColumns: setRosterColumns,
    reset: resetRosterColumns,
  } = rosterColumnState;

  // Which reading is on screen: the league's standings and rosters, or its own
  // configuration. Local and not persisted, because the panel mounts when a card
  // is expanded or a sheet is opened — a reader presses a league to see how it is
  // going, so that is what opening one shows, whatever the last league they
  // looked up its scoring for.
  const [tab, setTab] = useState<PanelTab>("standings");
  // One root for the strip's ids and the body's, so a tab and the box it names
  // cannot disagree — and unique per panel, since a leagues list can hold this
  // open beside a trade sheet's copy.
  const baseId = useId();

  // What each editor previews a metric against: the team the panel is currently
  // about, and the first player of its roster as the list below draws it. Both
  // are assumptions — every team and every player has its own numbers — so the
  // editor names its subject in the footer rather than letting one row's `41,320`
  // pass as the column's own answer.
  const preview = useMemo(
    () => previewSubjects(data, selected, week),
    [data, selected, week],
  );

  // Undefined (no `?week=` sent) and null (the week's read failed) both mean the
  // week columns have nothing to say, and the metrics tell the two apart by
  // whether a source came with them — so they collapse to one value here.
  const weekView = data.week_view ?? null;

  // The two rosters a week panel is about, or null for every other panel and for
  // a week with no game in it. Resolved against `teams` rather than trusted,
  // because the matchup and this payload are two reads — see {@link headToHead}.
  const game = headToHead(teams, focusRosterId, opponentRosterId);

  // The panel is one milled instrument rather than two adjacent boxes: a plate
  // holding a recessed field (the standings, which is read) beside a raised one
  // (the roster, which is acted on) — the app bar's grammar at panel scale, so
  // the selected team can be a lit key rather than a tinted row.
  //
  // **That plate is the card, not a box inside it.** This used to wear
  // `.lab-plate` itself, which put a machined instrument inside the list's glass
  // row — two materials nested, and two insets spent on the same horizontal
  // pixel. The card takes the material on expand (see `LeagueCard`), so what is
  // left here is the inset, which lives on a child of the query container rather
  // than on the container itself.
  //
  // Even 50/50 split at every width: the two halves answer different questions —
  // where the teams stand, and what the selected one is starting — and reading
  // one against the other is the point of the panel, so neither is folded away
  // on a phone. What gives instead is the *content* of each half: the children
  // use @lg container queries to shed non-essential columns once each half gets
  // tight (see the standings' second value column).
  //
  // The inset and the split's gutter are both a step tighter below @lg, and that
  // is the cheapest width in the whole panel: the boxes nest horizontally here
  // (this inset, each half's own face, then a standings row's own padding), so a
  // pixel of chrome is spent twice over on the way down and comes out of the one
  // track that has nowhere else to go — the name. Nothing on screen is *made of*
  // this padding, which is what separates trimming it from trimming a column.
  //
  // It is asymmetric on the left because the card's head is: the name line clears
  // the cyan rail with `pl-5`, and a panel that started a step further in would
  // read as a second column of content rather than as the same card continuing.
  // The top is tight for the same reason — the head's own `py-3` is already the
  // gap between the league's name and its detail.
  //
  // **The container is a bare wrapper, not the plate itself.** An element is
  // never its own query container, so `@container` and `@lg:p-4` on one div made
  // that padding resolve against an ancestor container that doesn't exist: it
  // silently never applied, and the panel wore its narrow inset at every width.
  // Splitting them is also what makes the query *stable* — a container whose own
  // padding is set by a query on itself changes the content box that query is
  // measured against, so the threshold moves as it is crossed. The container is
  // one level up, around every state this panel can be in.

  // A head-to-head draws no strip, and that is the tabs' own rule rather than an
  // exception to it: `Standings` names a table that panel deliberately does not
  // have (two rosters, no league table between them), and a tab naming an absent
  // table is worse than no tab. So the strip follows the standings rather than
  // the caller — the leagues list and the trades board always, and a week panel
  // on a bye, which falls through to the same arrangement and is a league worth
  // reading the settings of like any other.
  //
  // The body is a tab panel exactly where there are tabs above to name it: a
  // `tabpanel` role on the head-to-head would point `aria-labelledby` at a tab
  // that is not in the document.
  const tabbed = !game;
  /**
   * Whether this panel offers to re-read its league from Sleeper.
   *
   * Derived from the week rather than passed down as a flag, and the derivation
   * is the argument: a `week` is what the lineup checker sends and what the
   * leagues list and the trades board do not, so a panel that has one is by
   * construction the one somebody is *setting a lineup* in — which is the only
   * reading of a league that a reader can go and change in Sleeper and want back
   * within the minute. Everywhere else this panel is opened, a fifteen-minute
   * crawl is exactly current enough, and on the trades board — every crawled
   * league, most of them strangers' — a key per card would be a public control
   * for spending Sleeper budget on leagues nobody here plays in.
   *
   * It is deliberately *not* gated on there being a game: a bye week and a week
   * the crawler has not reached both draw the standings, and both are weeks a
   * reader may have just changed something in.
   */
  const syncable = week !== null;
  const tabPanel = tabbed
    ? {
        id: panelBodyId(baseId),
        role: "tabpanel",
        "aria-labelledby": panelTabId(baseId, tab),
      }
    : {};

  return (
    <div className="flex min-h-0 flex-col">
      {/* Outside the inset on purpose: the band is the card's head continuing,
          so it runs the full width under its own seam rather than sitting in the
          body as a third object between the name and the detail. It is also the
          line that must not move, which is what `shrink-0` inside it says now
          that the halves below are what scroll.

          Two independent occupants, either of which can be the only one: a
          head-to-head has no strip to switch and a season panel has nothing to
          sync, so the band is drawn for whichever is there and skipped when
          neither is. */}
      {(tabbed || syncable) && (
        <PanelHead>
          {/* One leading group rather than two loose children: the band is
              `justify-between` with the trailing seat holding the far end, and
              three loose items would distribute the free space between all
              three — putting the median somewhere in the middle of the band
              rather than beside whatever leads it. A median only exists on a
              week panel, so it can share the leading end with the strip (a bye
              in a median league, which draws both) or hold it alone (a
              head-to-head, which has no strip). */}
          <div className="flex min-w-0 items-center gap-2">
            {tabbed && <PanelTabs tab={tab} onTab={setTab} baseId={baseId} />}
            <WeekMedianBar weekView={weekView} />
          </div>
          {syncable && <LeagueSyncKey leagueId={data.league_id} />}
        </PanelHead>
      )}
      <div
        {...tabPanel}
        className="flex min-h-0 flex-col pb-3 pl-3 pr-2 pt-2 @lg:pb-5 @lg:pl-5 @lg:pr-4 @lg:pt-3"
      >
        {tabbed && tab === "settings" ? (
          <PanelSettings
            scoring={data.scoring_settings}
            settings={data.settings}
            // Not `total_rosters`: this payload carries the rosters themselves,
            // so counting them costs nothing and cannot disagree with the table
            // in the tab beside it.
            teams={teams.length}
            bestBall={data.best_ball}
          />
        ) : (
          <>
            {/* The same 50/50 split either way, and the halves keep the roles the
                materials give them: the left one is acted on and the right one is
                read. On a season panel that is the roster against the standings; on
                a week panel it is the reader's own lineup against the one they are
                playing, which is the same distinction — you can move your own
                players and not theirs. */}
            <div className="grid min-h-0 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-1.5 @lg:gap-4">
              {game ? (
                <RosterDetail
                  team={game.mine}
                  teams={teams}
                  players={data.players}
                  rosterPositions={data.roster_positions}
                  outlook={data.outlook}
                  values={data.values}
                  weekView={weekView}
                  columns={rosterColumns}
                  onOpenColumn={rosterEditor.open}
                  bestBall={data.best_ball}
                  heading={
                    <RosterHeading
                      team={game.mine}
                      weekView={weekView}
                      opponent={false}
                    />
                  }
                />
              ) : (
                <Standings
                  teams={teams}
                  outlook={data.outlook}
                  values={data.values}
                  weekView={weekView}
                  selectedId={selected.roster_id}
                  onSelect={setPickedId}
                  columns={teamColumns}
                  onOpenColumn={teamEditor.open}
                />
              )}
              {/* One selection across both halves, so the columns line up across
                  the panel and one pick moves them together — the same rule that
                  holds a column steady down a list, read sideways. The editor is
                  one editor for the same reason: two rosters are one catalogue. */}
              <RosterDetail
                team={game ? game.theirs : selected}
                teams={teams}
                players={data.players}
                rosterPositions={data.roster_positions}
                outlook={data.outlook}
                values={data.values}
                weekView={weekView}
                columns={rosterColumns}
                onOpenColumn={rosterEditor.open}
                bestBall={data.best_ball}
                surface={game ? "recessed" : "raised"}
                heading={
                  game ? (
                    <RosterHeading
                      team={game.theirs}
                      weekView={weekView}
                      opponent
                    />
                  ) : undefined
                }
              />
            </div>
            {/* Under the standings and not under the settings: it is a caveat
                about the projections those two lists are drawn from, and a
                league's scoring pays what it pays whether or not Sleeper
                projects every category of it. */}
            <OutlookCaveat data={data} />
          </>
        )}
      </div>

      {/* Two dialogs, one per table, each mounted from the first press onward —
          see {@link useColumnsEditor}. They sit outside the halves rather than
          inside the one that opened them: a `<dialog>` is in the top layer, so
          nothing about either half's scroll box or stacking order reaches it. */}
      {teamEditor.mounted && (
        <ColumnsEditor
          metrics={TEAM_METRICS}
          columns={teamColumns}
          presets={TEAM_COLUMN_PRESETS}
          ctx={preview.team}
          previewLabel={preview.teamLabel}
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
          columns={rosterColumns}
          presets={PLAYER_COLUMN_PRESETS}
          ctx={preview.player}
          previewLabel={preview.playerLabel}
          openSlot={rosterEditor.openSlot}
          onClose={rosterEditor.close}
          onColumnChange={setRosterColumn}
          onColumns={setRosterColumns}
          onReset={resetRosterColumns}
        />
      )}
    </div>
  );
}

/**
 * The subjects the two columns editors preview their metrics against: the
 * selected team, and the first player of its roster as the panel draws it.
 *
 * The leagues list previews against the first row on screen, and this is the
 * same rule read at this panel's two grains — except that the row worth reading
 * here is the *selected* one rather than the first, since it is the team the
 * telemetry names and the roster half is listing. The player follows the roster
 * list's own order: the optimal lineup's first filled slot, falling back to
 * what Sleeper has seated and then to anything on the roster, so the number in
 * the preview is one the reader can find a few pixels away.
 *
 * A team always exists (the panel returns early on an empty league); a player
 * may not — an undrafted league has empty rosters — and the editor takes a null
 * context as "no previews", which is the honest answer rather than a column of
 * em dashes attributed to nobody.
 */
function previewSubjects(
  data: LeagueDetailResult,
  selected: LeagueTeamView,
  week: number | null,
): {
  team: TeamMetricContext;
  teamLabel: string;
  player: PlayerMetricContext | null;
  playerLabel: string | null;
} {
  const teamOutlook: TeamOutlook | undefined = data.outlook?.teams.find(
    (t) => t.roster_id === selected.roster_id,
  );
  const weekView = data.week_view ?? null;

  const team: TeamMetricContext = {
    team: selected,
    outlook: teamOutlook ?? null,
    ktcTotal: rosterValueTotal(selected.players, data.values.ktc),
    adpTotal: rosterValueTotal(selected.players, data.values.adp),
    superflex: data.values.superflex,
    draftCount: data.values.adp_draft_count,
    week,
    weekProjection: weekView?.team_projection[selected.roster_id] ?? null,
  };

  // Sleeper pads an unfilled slot with an empty id or a literal "0", so a
  // roster's first *entry* is not necessarily a player.
  const playerId =
    teamOutlook?.optimal.find((s) => s.player_id)?.player_id ??
    selected.starters.find(real) ??
    selected.players.find(real) ??
    null;

  if (!playerId) {
    return { team, teamLabel: managerLabel(selected), player: null, playerLabel: null };
  }

  return {
    team,
    teamLabel: managerLabel(selected),
    player: {
      outlook: data.outlook?.players[playerId],
      split: teamOutlook?.weekly_split[playerId],
      horizon: data.outlook?.weeks.length ?? 0,
      ktc: data.values.ktc[playerId] ?? null,
      adp: data.values.adp[playerId] ?? null,
      adpPosition: data.values.adp_position[playerId] ?? null,
      superflex: data.values.superflex,
      draftCount: data.values.adp_draft_count,
      week,
      weekProjection: weekView?.projection[playerId] ?? null,
    },
    playerLabel: data.players[playerId]?.name ?? playerId,
  };
}

/** Whether a roster entry names a player rather than padding an empty slot. */
const real = (id: string) => Boolean(id) && id !== "0";

/**
 * Says so when this league's projections are known to be incomplete.
 *
 * One caveat, and it is gated: the missing-category list is near enough always
 * non-empty — every league carries weights for defence and special-teams events
 * Sleeper doesn't project — so it is only worth a warning where those categories
 * actually score, which is a league that starts a DEF or an IDP.
 *
 * A league-level fact, so it is stated once under the panel rather than on each
 * team — and outside the halves' scroll boxes, so a caveat about the numbers
 * stays on screen with the numbers it is about.
 *
 * **It is a season-panel caveat now, and by construction rather than by choice.**
 * `unprojected_scoring` rides on the outlook payload, which a week panel showing
 * only week columns no longer asks for (see {@link leagueDetailNeeds}) — so this
 * reads the absent-outlook path there, exactly as it does when that read fails.
 * The caveat is as true of a week's projections as of a season's, so restoring it
 * on the lineup checker means carrying the field on `LeagueWeekViewPayload` too,
 * not re-enabling a lineup solve per team per remaining week to read one array
 * off it.
 */
function OutlookCaveat({ data }: { data: LeagueDetailResult }) {
  const missing = data.outlook?.unprojected_scoring.length ?? 0;
  const startsDefence = (data.roster_positions ?? []).some((slot) =>
    DEFENSIVE_SLOTS.has(slot),
  );
  if (missing === 0 || !startsDefence) return null;

  return (
    <div className="mt-2 shrink-0 space-y-1 text-[0.7rem] leading-relaxed text-foreground/40">
      <p>
        This league starts defensive players and scores {missing} categories
        Sleeper doesn&apos;t project, so their projected points read low and the
        optimal lineup will under-start them.
      </p>
    </div>
  );
}

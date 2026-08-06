"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Both imported directly rather than through their barrels, which would pull
// `pg`-backed code into the client bundle — see `slots.ts` and `rank.ts`.
import { orderByProjectedPoints } from "@/shared/manager/rank";
import { DEFENSIVE_SLOTS } from "@/shared/projections/slots";

// The module paths rather than `features/shared`'s own barrel, which this file is
// inside of: a barrel importing a subtree that imports the barrel is a cycle, and
// this panel is deliberately absent from it in any case (see `./index.ts`).
import { adpValueQueryString, todayIso } from "../../adp-controls";
import { useAdpControls } from "../../adp-controls-context";
import { DEFAULT_PLAYER_COLUMNS, PLAYER_METRICS } from "../../roster-metrics";
import { DEFAULT_TEAM_COLUMNS, TEAM_METRICS } from "../../standings-metrics";
import { useLeagueDetail } from "../../use-league-detail";
import { usePersistedColumns } from "../../use-persisted-columns";
import { PanelLoading, PanelMessage } from "../panel-message";
import { PanelTelemetry } from "./panel-telemetry";
import { RosterDetail } from "./roster-detail";
import { Standings } from "./standings";
import type { LeagueDetailResult } from "./types";

/**
 * A league's standings on the left and the selected team's roster on the right.
 * Loads its own data the first time it mounts, which is when whatever holds it
 * is opened.
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
 */
export function LeagueDetailPanel({
  leagueId,
  focusRosterId,
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
}) {
  // The same board the collapsed card above is priced on, read from the same
  // store — this panel has no controls of its own, so a selection made in the
  // drawer is the only thing that can move its two value columns, and being
  // driven by a *different* selection from the card that opened it is what this
  // replaced.
  const { controls } = useAdpControls();
  const board = useMemo(() => adpValueQueryString(controls, todayIso()), [controls]);
  const { data, loading, error } = useLeagueDetail(leagueId, board);

  // The query container is here rather than around the loaded panel alone, so
  // every state this can be in is measured against one width — including the
  // three below, which carry the inset themselves now that the card wraps this
  // in nothing (the padding belongs to what is drawn on the card's face, not to
  // the act of expanding). It holds no box of its own, per the rule an
  // `@container` has to keep: an element is never its own query container.
  return (
    <div className="@container">
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
        <Panel data={data} focusRosterId={focusRosterId} />
      )}
    </div>
  );
}

/** The panel's inset around a state that isn't the panel. */
function PanelState({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-3 pt-1 @lg:px-5 @lg:pb-5">{children}</div>;
}

function Panel({
  data,
  focusRosterId,
}: {
  data: LeagueDetailResult;
  focusRosterId?: number;
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
  const [selectedId, setSelectedId] = useState<number>(
    focusRosterId ?? teams[0].roster_id,
  );
  // A roster the league doesn't hold — a trade whose participants have since been
  // replaced — falls back to the head of the list rather than to nothing.
  const selected = teams.find((t) => t.roster_id === selectedId) ?? teams[0];

  // Each table's two value columns are slots the reader points at a metric — the
  // standings at a team-level one, the roster at a player-level one. Stored on
  // the device rather than held here, so the choice outlives this panel: it
  // mounts on expand and unmounts on collapse, which used to reset both tables
  // every time a different league was opened. One key per grain, not per league —
  // what a column means is a fact about the catalogue, not about this league.
  const { columns: teamColumns, setColumn: setTeamColumn } = usePersistedColumns(
    "standings",
    DEFAULT_TEAM_COLUMNS,
    TEAM_METRICS,
  );
  const { columns: rosterColumns, setColumn: setRosterColumn } =
    usePersistedColumns("roster", DEFAULT_PLAYER_COLUMNS, PLAYER_METRICS);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openPicker === null) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpenPicker(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPicker(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPicker]);

  const togglePicker = (key: string) =>
    setOpenPicker((current) => (current === key ? null : key));
  const pickTeamColumn = (slot: number, key: string) => {
    setTeamColumn(slot, key);
    setOpenPicker(null);
  };
  const pickRosterColumn = (slot: number, key: string) => {
    setRosterColumn(slot, key);
    setOpenPicker(null);
  };

  // The open menu overhangs the rows below it, so the half it opens from lifts its
  // stacking order over the other while a picker is open.
  const teamPickerOpen = openPicker?.startsWith("team-") ?? false;

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
  // one level up, around every state this panel can be in; this div holds only
  // the ref the pickers' outside-click test reads.
  return (
    <div ref={panelRef}>
      {/* Outside the inset on purpose: the readout is the card's head
          continuing, so it runs the full width under its own seam rather than
          sitting in the body as a third object between the name and the
          detail. */}
      {data.outlook && (
        <PanelTelemetry
          outlook={data.outlook}
          team={data.outlook.teams.find(
            (t) => t.roster_id === selected.roster_id,
          )}
        />
      )}
      <div className="pb-3 pl-3 pr-2 pt-2 @lg:pb-5 @lg:pl-5 @lg:pr-4 @lg:pt-3">
        <div className="grid grid-cols-2 gap-1.5 @lg:gap-4">
          <Standings
            teams={teams}
            outlook={data.outlook}
            values={data.values}
            selectedId={selected.roster_id}
            onSelect={setSelectedId}
            columns={teamColumns}
            openPicker={openPicker}
            onTogglePicker={togglePicker}
            onSelectColumn={pickTeamColumn}
            elevated={teamPickerOpen}
          />
          <RosterDetail
            team={selected}
            teams={teams}
            players={data.players}
            rosterPositions={data.roster_positions}
            outlook={data.outlook}
            values={data.values}
            columns={rosterColumns}
            openPicker={openPicker}
            onTogglePicker={togglePicker}
            onSelectColumn={pickRosterColumn}
            elevated={openPicker !== null && !teamPickerOpen}
          />
        </div>
        <OutlookCaveat data={data} />
      </div>
    </div>
  );
}

/**
 * Says so when this league's projections are known to be incomplete.
 *
 * Two caveats, gated differently, which is why they aren't one line. Missing
 * categories are near enough always non-empty — every league carries weights for
 * defence and special-teams events Sleeper doesn't project — so they are only
 * worth a warning where those categories actually score: a league that starts a
 * DEF or an IDP. Derived categories are the opposite: first downs and reception
 * splits are scored on skill players, so they apply to every team in a league
 * that pays for them, and there is nothing to gate on.
 *
 * League-level facts, so they are stated once under the panel rather than on each
 * team.
 */
function OutlookCaveat({ data }: { data: LeagueDetailResult }) {
  const missing = data.outlook?.unprojected_scoring.length ?? 0;
  const derived = data.outlook?.derived_scoring ?? [];
  const startsDefence = (data.roster_positions ?? []).some((slot) =>
    DEFENSIVE_SLOTS.has(slot),
  );
  if (derived.length === 0 && (missing === 0 || !startsDefence)) return null;

  return (
    <div className="mt-2 space-y-1 text-[0.7rem] leading-relaxed text-foreground/40">
      {derived.length > 0 && (
        <p>
          This league scores {derived.join(", ")}, which Sleeper publishes as a
          formula rather than a projection — a &ldquo;first down&rdquo; is just
          the yardage over ten. Those categories are left out of the totals here.
        </p>
      )}
      {missing > 0 && startsDefence && (
        <p>
          This league starts defensive players and scores {missing} categories
          Sleeper doesn&apos;t project, so their projected points read low and the
          optimal lineup will under-start them.
        </p>
      )}
    </div>
  );
}

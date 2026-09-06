"use client";

import { useMemo, useState } from "react";

import type {
  ManagerLeague,
  ManagerLeaguemateRostersPayload,
  ManagerPlayersPayload,
} from "@/shared/contract";

import {
  pickedSubject,
  SharesDrawer,
  subjectSlot,
  type LeagueSubjects,
  type SharesDrawerRow,
  type Subject,
  type SubjectMode,
} from "@/features/shared";

import { playerModeCounts } from "../helpers/leaguemate-rosters";
import {
  activeFilterCount,
  keepsPlayer,
  NO_PLAYER_FILTERS,
  playerFilterBounds,
  UNKNOWN_VALUE,
  type PlayerFilterState,
} from "../helpers/player-filters";
import { rowRecord } from "../helpers/season-summary";
import { playerShares } from "../helpers/shares";
import { PlayerFilters } from "./player-filters";
import { PlayerModeTrack } from "./player-mode-track";

/**
 * Player shares: every player the manager rosters, and in how many of their
 * leagues.
 *
 * **The list is folded over the league-filtered but subject-unnarrowed
 * population**, which is the one population rule that matters here. Folded over
 * the selection instead, every row would collapse to the row you just picked and
 * could not be widened without clearing first — the rule `facetsQuery` already
 * enforces for the trades board's own menus.
 *
 * The three player-only columns — Value, Age, Class — ride the payload rather
 * than being derived here, and all three are **null where absent, never zero**.
 * Which market the value is on is the payload's own answer (`ktc`), because a
 * row spans leagues and so cannot resolve one per league the way a card does.
 *
 * **A picked row grows a third question.** The list answers "where do I have
 * him"; the track under a selected row answers the other two a stored roster
 * set can distinguish — where a leaguemate has him, and where nobody does. The
 * mode lives on the *subject* rather than beside it (see `SubjectMode`), which
 * is what lets two picks sit on two modes and what lets the token above the
 * grid name a narrowing rather than a player. A drawer-local copy would be a
 * second spelling of one fact, and the drawer is not what the grid reads.
 *
 * **The panel narrows four ways, not one.** Position was the only facet, which
 * left the two things a dynasty reader opens this list for — how old a player
 * is and which class he came out of — visible as columns and unreachable as
 * questions. Age and Class were already on the payload; NFL team was already on
 * the row as its note. The filter state and its predicate live in
 * `helpers/player-filters.ts` so they can be tested; the drawer holds the state
 * because the drawer is what owns the rows.
 */
export function PlayerSharesDrawer({
  open,
  onClose,
  leagues,
  leagueTotal,
  filterSummary,
  read,
  rosters,
  selfId,
  subjects,
  onToggle,
  onMode,
}: {
  open: boolean;
  onClose: () => void;
  /** League-filtered, subject-unnarrowed — see the note above. */
  leagues: readonly ManagerLeague[];
  /** Every league on the page, for the panel's population readout. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  read: {
    data: ManagerPlayersPayload | null;
    loading: boolean;
    error: string | null;
  };
  /**
   * Every roster in those leagues — what the three mode counts are folded over.
   *
   * Its absence costs the two figures a stored roster set answers and nothing
   * else: the list, the four facets and the resting `owned` narrowing all read
   * the payload above, so a slow or failed read here is a pair of em dashes on
   * two keys rather than a panel that cannot open.
   */
  rosters: { data: ManagerLeaguemateRostersPayload | null };
  /**
   * The page's manager, so a roster of theirs is told from a leaguemate's.
   * Null before the leagues stream answers, which reads as "nothing is owned"
   * — the honest arm, where treating it as "everything is taken" would be a
   * narrowing built out of a payload that has not landed.
   */
  selfId: string | null;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
  onMode: (playerId: string, mode: SubjectMode) => void;
}) {
  // A way of reading this list rather than a device preference, so both are
  // `useState` — the same call `LeagueTeams` makes about its metric select.
  // Neither is cleared on close: the narrowing is the answer the reader built,
  // and the key's own badge is what says so when the tray is shut.
  const [filters, setFilters] = useState<PlayerFilterState>(NO_PLAYER_FILTERS);
  const [trayOpen, setTrayOpen] = useState(false);

  const shares = useMemo(
    () =>
      read.data
        ? playerShares(leagues, read.data.rosters, read.data.players)
        : null,
    [leagues, read.data],
  );

  // Memoised rather than defaulted inline, so a render while the read is in
  // flight does not hand every memo below a new empty array to recompute from.
  const players = useMemo(() => shares?.players ?? [], [shares]);

  // Bounds off the population, so a board with no rookies offers no rookie
  // handle and next year's class arrives without an edit here.
  const ageBounds = useMemo(() => playerFilterBounds(players, (p) => p.age), [players]);
  const classBounds = useMemo(
    () => playerFilterBounds(players, (p) => p.draft_class),
    [players],
  );

  const rows = useMemo<SharesDrawerRow[]>(
    () =>
      players
        .filter((p) => keepsPlayer(p, filters, ageBounds, classBounds))
        .map((player) => ({
          key: player.player_id,
          id: player.player_id,
          name: player.name,
          note: player.team,
          held: player.leagues.length,
          // Folded here rather than in the drawer — see `SharesDrawerRow.record`.
          record: rowRecord(player.leagues),
          value: player.ktc_value,
          age: player.age,
          draftClass: player.draft_class,
          badge: { label: player.position ?? UNKNOWN_VALUE },
        })),
    [players, filters, ageBounds, classBounds],
  );

  // **Keyed by slot, never by key** — see `subjectSlot`. A row is picked
  // whatever mode it is on, and a set of full keys would drop the row out of
  // the list's own selected state the moment a reader pressed `Taken`, taking
  // the mode track with it: the control would delete itself on first use.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  const active = activeFilterCount(filters, ageBounds, classBounds);

  // **Folded per picked row, not per row.** The counts are three walks of every
  // stored roster, and a memo over the whole list would run them for four
  // hundred players to answer for the two that are on screen with a track under
  // them. Keyed on the selection so a mode press does not re-fold.
  const rosterMap = rosters.data?.rosters ?? null;
  const modeCounts = useMemo(() => {
    if (!rosterMap) return null;
    const out = new Map<string, ReturnType<typeof playerModeCounts>>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "player") continue;
      out.set(
        subject.id,
        playerModeCounts(leagues, subject.id, rosterMap, selfId),
      );
    }
    return out;
  }, [subjects, leagues, rosterMap, selfId]);

  return (
    <SharesDrawer
      open={open}
      onClose={onClose}
      side="left"
      kind="player"
      title="Player shares"
      noun="players"
      rows={rows}
      leagueCount={shares?.league_count ?? 0}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      loading={read.loading}
      error={read.error}
      emptyMessage="No players rostered in these leagues yet."
      filtersActive={active > 0}
      onClearFilters={() => setFilters(NO_PLAYER_FILTERS)}
      filters={
        <PlayerFilters
          players={players}
          filters={filters}
          onChange={setFilters}
          ageBounds={ageBounds}
          classBounds={classBounds}
          open={trayOpen}
          onToggleOpen={() => setTrayOpen((v) => !v)}
        />
      }
      selected={(subject) => chosen.has(subjectSlot(subject))}
      onToggle={onToggle}
      selectedStrip={(row) => (
        <PlayerModeTrack
          // The mode is read back off the subject the press created, which is
          // the whole point of it living there: two picks, two modes, and a
          // token that can name what each one narrowed.
          mode={pickedSubject(subjects, "player", row.id)?.mode ?? "owned"}
          counts={modeCounts?.get(row.id) ?? null}
          onPick={(mode) => onMode(row.id, mode)}
          playerName={row.name}
        />
      )}
    />
  );
}

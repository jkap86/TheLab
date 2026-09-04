"use client";

import { useMemo, useState } from "react";

import type { ManagerLeague, ManagerPlayersPayload } from "@/shared/contract";

import type { LeagueSubjects, Subject } from "../helpers/league-subjects";
import { subjectKey } from "../helpers/league-subjects";
import {
  activeFilterCount,
  keepsPlayer,
  NO_PLAYER_FILTERS,
  playerFilterBounds,
  UNKNOWN_VALUE,
  type PlayerFilterState,
} from "../helpers/player-filters";
import { playerShares } from "../helpers/shares";
import { PlayerFilters } from "./player-filters";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";

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
  subjects,
  onToggle,
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
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
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
          leagues: player.leagues,
          value: player.ktc_value,
          age: player.age,
          draftClass: player.draft_class,
          badge: { label: player.position ?? UNKNOWN_VALUE },
        })),
    [players, filters, ageBounds, classBounds],
  );

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects],
  );

  const active = activeFilterCount(filters, ageBounds, classBounds);

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
      selected={(subject) => chosen.has(subjectKey(subject))}
      onToggle={onToggle}
    />
  );
}

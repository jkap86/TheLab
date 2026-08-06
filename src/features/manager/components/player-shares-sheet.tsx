"use client";

import { useMemo } from "react";

import { adpQueryString, todayIso, useAdp } from "@/features/shared";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { useAdpControls } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerPlayers } from "../hooks/use-manager-players";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
} from "../share-metrics";
import { playerShares } from "../shares";
import type { AdpPlayerPayload } from "../types";
import { PlayerShares } from "./player-shares";
import { SharesSheet } from "./shares-sheet";

/**
 * The player-shares browse: every player the manager rosters, over the page his
 * leagues are listed on, each row a way to narrow that page to the leagues
 * holding him.
 *
 * The chrome is {@link SharesSheet} and the list is {@link PlayerShares} — the
 * same list the Players tab draws, so a column aimed on either lands on both.
 * What is left here is the two reads the columns need and the words a player list
 * uses for the states neither of those can be in yet.
 */
export function PlayerSharesSheet({
  view,
  open,
  onClose,
}: {
  view: FilteredLeagues;
  open: boolean;
  onClose: () => void;
}) {
  const leagues = view.data?.leagues ?? null;
  // Off until the sheet is opened, and the same query key the rail's panel and
  // the Players tab already name — so a reader who has been to either pays
  // nothing, and a reader who never opens this costs no request.
  const rosters = useManagerPlayers(view.searched, leagues, open);

  // The board the ADP columns read, behind the same gate. It is not keyed to the
  // manager, so the drawer and the Players tab share this entry with the sheet.
  const { controls } = useAdpControls();
  const adpQuery = useMemo(
    () => adpQueryString(controls, todayIso()),
    [controls],
  );
  const adp = useAdp(adpQuery, { enabled: open });
  const adpByPlayer = useMemo(() => {
    const map = new Map<string, AdpPlayerPayload>();
    for (const player of adp.data?.players ?? [])
      map.set(player.player_id, player);
    return map;
  }, [adp.data]);

  const shares = useMemo(
    () =>
      rosters.data
        ? playerShares(
            view.leagueFiltered,
            rosters.data.rosters,
            rosters.data.players,
          )
        : null,
    [view.leagueFiltered, rosters.data],
  );

  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "share",
    DEFAULT_PLAYER_COLUMNS,
    PLAYER_SHARE_METRICS,
  );

  return (
    <SharesSheet
      view={view}
      open={open}
      onClose={onClose}
      kind="player"
      title="Player shares"
      subject="Player"
      loadingLabel="Reading rosters…"
      emptyLabel="No players rostered in these leagues yet."
      noMatchLabel="Nobody by that name on these rosters."
      rows={shares?.players ?? null}
      leagueCount={shares?.league_count ?? 0}
      error={rosters.error}
      subjectId={(share) => share.player_id}
      metrics={PLAYER_SHARE_METRICS}
      presets={PLAYER_SHARE_COLUMN_PRESETS}
      columns={columns}
      adp={adpByPlayer}
      onColumnChange={setColumn}
      onColumns={setColumns}
      onReset={reset}
    >
      {(rows, selection) => (
        <PlayerShares
          shares={rows}
          leagueCount={shares?.league_count ?? 0}
          adp={adpByPlayer}
          columns={columns}
          isSelected={selection.isSelected}
          onSelect={selection.onSelect}
        />
      )}
    </SharesSheet>
  );
}

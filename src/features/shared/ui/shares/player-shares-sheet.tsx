"use client";

import { useMemo } from "react";

import type { AdpPlayerPayload } from "@/shared/contract";

import { useAdpControls } from "../../adp-controls-context";
import { adpBoardRead } from "../../adp-controls";
import { useTodayIso } from "../../use-today-iso.ts";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
} from "../../share-metrics.ts";
import { playerShares } from "../../shares.ts";
import type { SubjectView } from "../../subject-view.ts";
import { useAdp } from "../../use-adp";
import { useManagerPlayers } from "../../use-manager-players";
import { usePersistedColumns } from "../../use-persisted-columns";
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
  view: SubjectView;
  open: boolean;
  onClose: () => void;
}) {
  const leagues = view.leagues;
  // Off until the sheet is opened, and the same query key the rail's panel and
  // the Players tab already name — so a reader who has been to either pays
  // nothing, and a reader who never opens this costs no request.
  const rosters = useManagerPlayers(view.searched, view.userId, leagues, open);

  // The board the ADP columns read, behind the same gate. It is not keyed to the
  // manager, so the drawer and the Players tab share this entry with the sheet.
  const { controls, scope } = useAdpControls();
  // Watched rather than read once, so a relative window follows the calendar in
  // a sheet left open overnight — see {@link useTodayIso}.
  const today = useTodayIso();
  const adpRead = useMemo(
    () => adpBoardRead(controls, scope, today),
    [controls, scope, today],
  );
  const adp = useAdp(adpRead, { enabled: open });
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

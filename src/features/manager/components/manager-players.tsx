"use client";

import { useMemo } from "react";

import { adpQueryString, todayIso, useAdp } from "@/features/shared";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { useAdpControls } from "../filters-context";
import { useFilteredLeagues } from "../hooks/use-filtered-leagues";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
  type ShareMetricContext,
} from "../share-metrics";
import { useManagerPlayers } from "../hooks/use-manager-players";
import { playerShares } from "../shares";
import type { AdpPlayerPayload } from "../types";
import { ColumnsBar } from "./columns-bar";
import { LeaguesViewLayout } from "./leagues-view-layout";
import { ErrorCard } from "./manager-leagues-status";
import { PlayerShares } from "./player-shares";
import { PanelLoading, PanelMessage } from "./ui";

/**
 * Player shares: who this manager owns, in how many of their leagues, and each
 * player's ADP.
 *
 * The same page as the leagues and leaguemates views — leagues stream, filters,
 * and the shared chrome of {@link LeaguesViewLayout} — reading its own resource
 * off the same stream. The rosters the leagues stream syncs are what a share is
 * counted over, so asking for them here means the page is never looking at a
 * manager the sync hasn't run for. The header filters narrow the population a
 * share is measured against rather than the players: dynasty-only and
 * redraft-only exposure are different portfolios.
 *
 * The ADP column reads the shared ADP drawer — opened from the scaffold's
 * header, backed by the per-manager store — for which crawled drafts the average
 * is taken over, and `useAdp` fetches that board off the global `/api/adp`. The
 * drawer's own trigger and caption name the board it came from; the value-curve
 * control in the drawer does nothing here (a per-player ADP is a raw number) and
 * drives the Leagues tab instead.
 */
export function ManagerPlayers({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);
  const rosters = useManagerPlayers(
    searched,
    view.userId,
    view.data?.leagues ?? null,
  );

  const shares = useMemo(
    () =>
      rosters.data
        ? playerShares(view.filtered, rosters.data.rosters, rosters.data.players)
        : null,
    [view.filtered, rosters.data],
  );

  // The board this tab's ADP column reads. Unlike the roster resources beside
  // it, it doesn't wait on the leagues stream: the board is a fact about the
  // crawled drafts, so it can be asked for the moment the page mounts.
  const { controls } = useAdpControls();
  const adpQuery = useMemo(
    () => adpQueryString(controls, todayIso()),
    [controls],
  );
  const adp = useAdp(adpQuery);

  const adpByPlayer = useMemo(() => {
    const map = new Map<string, AdpPlayerPayload>();
    for (const player of adp.data?.players ?? []) map.set(player.player_id, player);
    return map;
  }, [adp.data]);

  // The share grain's columns, remembered on the device like the leagues tab's.
  // One key for both share views, because they are one catalogue: a selection
  // naming the ADP columns simply falls back per slot on the leaguemates list,
  // which has no board price to read — `resolveColumns` doing exactly what it
  // was written for.
  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "share",
    DEFAULT_PLAYER_COLUMNS,
    PLAYER_SHARE_METRICS,
  );

  // What the editor previews against — the most-owned player, named in its
  // footer so a share count can't pass as the column's own answer.
  const first = shares?.players[0] ?? null;
  const previewCtx: ShareMetricContext | null =
    first && shares
      ? {
          leagues: first.leagues,
          leagueCount: shares.league_count,
          adp: adpByPlayer.get(first.player_id) ?? null,
        }
      : null;

  return (
    <LeaguesViewLayout
      view={view}
      stat={{
        label: "Players",
        value: shares ? shares.players.length : "—",
        sub: shares
          ? `across ${shares.league_count} league${shares.league_count === 1 ? "" : "s"}`
          : undefined,
      }}
      columns={
        shares ? (
          <ColumnsBar
            view={view}
            headings={shares.players.length > 0}
            metrics={PLAYER_SHARE_METRICS}
            columns={columns}
            subject="Player"
            presets={PLAYER_SHARE_COLUMN_PRESETS}
            ctx={previewCtx}
            previewLabel={first?.name ?? null}
            onColumnChange={setColumn}
            onColumns={setColumns}
            onReset={reset}
          />
        ) : undefined
      }
    >
      {/* A failed refetch must not blank rows the hook deliberately kept —
          the error replaces the list only when there is nothing to keep. */}
      {rosters.error && !shares ? (
        <ErrorCard message={rosters.error} />
      ) : !shares ? (
        <PanelLoading>Loading rosters…</PanelLoading>
      ) : (
        <>
          {rosters.error && (
            <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-300">
              Refresh failed — showing cached data
            </div>
          )}
          {shares.players.length === 0 ? (
            // Every filtered league is one whose rosters aren't cached, or one
            // that hasn't drafted — a real answer, not the same as an error.
            <PanelMessage>No players rostered in these leagues yet.</PanelMessage>
          ) : (
            <PlayerShares
              shares={shares.players}
              leagueCount={shares.league_count}
              adp={adpByPlayer}
              columns={columns}
            />
          )}
        </>
      )}
    </LeaguesViewLayout>
  );
}

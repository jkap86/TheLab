"use client";

import { useCallback, useState } from "react";

import type { ShareMetric, ShareMetricContext } from "../share-metrics";
import type { AdpPlayerPayload, ManagerLeague } from "../types";
import { ShareCard } from "./share-card";

/** What this list needs of a row: something to name it, and what it expands to. */
export type ShareRow = {
  name: string;
  leagues: ManagerLeague[];
};

/**
 * A list of shares: one card a row, most-shared first, each expanding to the
 * leagues behind it.
 *
 * The shape both share views are. `player-shares` counts players and
 * `leaguemate-shares` counts people, and they are the same card with a different
 * thing in the first column — so the card, the stat columns and the expansion
 * live here rather than in each. They were copied between the two before this,
 * which is one width change away from the two lists disagreeing about how a share
 * reads, in whichever file didn't get edited.
 *
 * The metric each of the four stat columns shows is held **here**, not per card,
 * for the reason the leagues list holds it above {@link LeagueCard}: per-card
 * columns would make a list several hundred rows long unreadable vertically,
 * which is the axis it is scanned on. Which metrics are on offer is the caller's,
 * since a player has a board price and a person does not.
 */
export function ShareList<T extends ShareRow>({
  rows,
  leagueCount,
  rowKey,
  icon,
  note,
  metrics,
  defaultColumns,
  adpFor,
}: {
  rows: T[];
  /** Leagues the shares are out of — see each view's own `league_count`. */
  leagueCount: number;
  rowKey: (row: T) => string;
  /** Leads the name: a position pill, an avatar — whatever identifies the row. */
  icon: (row: T) => React.ReactNode;
  /** A dim trailing detail on the name, where the row has one. */
  note?: (row: T) => string | null;
  /** The catalogue this list's columns pick from. */
  metrics: ShareMetric[];
  /** The four metrics the cards open with. */
  defaultColumns: string[];
  /**
   * This row's entry on the selected ADP board, for the player metrics. Omitted
   * by the leaguemates view, whose menu holds nothing that reads it.
   */
  adpFor?: (row: T) => AdpPlayerPayload | null;
}) {
  const [columns, setColumns] = useState<string[]>(defaultColumns);
  const setColumn = useCallback((slot: number, key: string) => {
    setColumns((current) =>
      current.map((existing, i) => (i === slot ? key : existing)),
    );
  }, []);

  return (
    <ul className="flex w-full flex-col gap-4">
      {rows.map((row) => {
        const ctx: ShareMetricContext = {
          leagues: row.leagues,
          leagueCount,
          adp: adpFor?.(row) ?? null,
        };
        return (
          <ShareCard
            key={rowKey(row)}
            name={row.name}
            icon={icon(row)}
            note={note?.(row) ?? null}
            leagues={row.leagues}
            metrics={metrics}
            ctx={ctx}
            columns={columns}
            onColumnChange={setColumn}
          />
        );
      })}
    </ul>
  );
}

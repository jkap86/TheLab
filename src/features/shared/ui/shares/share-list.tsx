"use client";

import type { AdpPlayerPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import type { ShareMetric, ShareMetricContext } from "../../share-metrics.ts";
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
 * The metric each of the four stat columns shows is **the view's**, not this
 * list's and never a card's: per-card columns would make a list several hundred
 * rows long unreadable vertically, which is the axis it is scanned on. It moved
 * one level up because the heading rail naming those columns is pinned in the
 * manager header, which is above this list — one selection cannot be owned by
 * two places, so it is owned by the only place that can see both. Which metrics
 * are on offer is the caller's too, since a player has a board price and a
 * person does not.
 */
export function ShareList<T extends ShareRow>({
  rows,
  leagueCount,
  rowKey,
  icon,
  note,
  metrics,
  columns,
  adpFor,
  isSelected,
  onSelect,
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
  /** The metric key each of the four stat columns shows. */
  columns: string[];
  /**
   * This row's entry on the selected ADP board, for the player metrics. Omitted
   * by the leaguemates view, whose menu holds nothing that reads it.
   */
  adpFor?: (row: T) => AdpPlayerPayload | null;
  /**
   * Whether a row is one of the subjects narrowing the league list, and how to
   * toggle it — passed only by the shares sheet, where the list is a picker over
   * the leagues behind it. Both or neither: a row that draws as selectable and
   * doesn't toggle is the promise this app's raised/recessed grammar keeps.
   */
  isSelected?: (row: T) => boolean;
  onSelect?: (row: T) => void;
}) {
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
            selected={isSelected?.(row) ?? false}
            onSelect={onSelect && (() => onSelect(row))}
          />
        );
      })}
    </ul>
  );
}

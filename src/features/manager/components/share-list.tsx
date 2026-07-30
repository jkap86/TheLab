"use client";

import { useState } from "react";

import type { ManagerLeague } from "../types";
import { Chevron, SharedLeagueRow } from "./ui";

/**
 * The grid a share row and the heading above it share — one template for both, so
 * the headings stay over their numbers.
 *
 * Two variants, both written out whole so Tailwind sees each class string: the
 * base four columns, and a five-column form with an extra number between the name
 * and the counts for the optional `value` column (the players view's ADP). A
 * caller with no `value` gets the base grid untouched, which is what keeps the
 * leaguemates list exactly as it was.
 */
const COLUMNS =
  "grid-cols-[1rem_minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[1rem_minmax(0,1fr)_4.5rem_4rem]";
const COLUMNS_WITH_VALUE =
  "grid-cols-[1rem_minmax(0,1fr)_3rem_3.5rem_3.5rem] sm:grid-cols-[1rem_minmax(0,1fr)_4rem_4.5rem_4rem]";

/** What this list needs of a row: something to name it, and what it expands to. */
export type ShareRow = {
  name: string;
  leagues: ManagerLeague[];
};

/**
 * A list of shares: one line a row, most-shared first, each expanding to the
 * leagues behind it.
 *
 * The shape both share views are. `player-shares` counts players and
 * `leaguemate-shares` counts people, and they are the same table with a different
 * thing in the first column — so the grid, the two number columns and the
 * expansion live here rather than in each. They were copied between the two
 * before this, which is one width change away from the headings sitting over the
 * wrong numbers in whichever file didn't get edited.
 *
 * One line a row, unlike the league panel's two: this list has the full page
 * shell to work with, so the name is in no danger of losing its space, and
 * splitting it would only add height to a list several hundred rows long.
 *
 * Both numbers are kept because neither is the whole answer. The count is what is
 * actually held and compares between rows; the share is what it means for a
 * portfolio and moves when the filters do — eight leagues is heavy exposure
 * across ten and barely a position across a hundred.
 */
export function ShareList<T extends ShareRow>({
  heading,
  rows,
  leagueCount,
  rowKey,
  icon,
  note,
  valueHeading,
  value,
}: {
  /** The first column's heading — what a row *is*. See the labelling rule below. */
  heading: string;
  rows: T[];
  /** Leagues the shares are out of — see each view's own `league_count`. */
  leagueCount: number;
  rowKey: (row: T) => string;
  /** Leads the name: a position pill, an avatar — whatever identifies the row. */
  icon: (row: T) => React.ReactNode;
  /** A dim trailing detail on the name, where the row has one. */
  note?: (row: T) => string | null;
  /**
   * An optional extra metric column between the name and the counts. Supply both
   * a heading and a cell renderer or neither — the players view uses it for ADP,
   * the leaguemates view leaves it off and keeps the four-column grid.
   */
  valueHeading?: string;
  value?: (row: T) => React.ReactNode;
}) {
  const columns = value ? COLUMNS_WITH_VALUE : COLUMNS;
  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10">
      <div
        className={`grid ${columns} items-center gap-x-2 border-b border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[0.65rem] uppercase tracking-wide text-foreground/40 sm:text-xs`}
      >
        <span />
        <span className="truncate">{heading}</span>
        {value && <span className="text-right">{valueHeading}</span>}
        <span className="text-right">Leagues</span>
        <span className="text-right">Share</span>
      </div>
      <ul className="divide-y divide-foreground/5">
        {rows.map((row) => (
          <ShareListRow
            key={rowKey(row)}
            row={row}
            leagueCount={leagueCount}
            columns={columns}
            icon={icon(row)}
            note={note?.(row) ?? null}
            hasValue={Boolean(value)}
            valueCell={value ? value(row) : null}
          />
        ))}
      </ul>
    </div>
  );
}

function ShareListRow({
  row,
  leagueCount,
  columns,
  icon,
  note,
  hasValue,
  valueCell,
}: {
  row: ShareRow;
  leagueCount: number;
  columns: string;
  icon: React.ReactNode;
  note: string | null;
  /**
   * Whether the value column exists at all — the cell is rendered on that, not
   * on this row's content, so an empty cell still fills its grid track and the
   * counts beside it can't shift left into it.
   */
  hasValue: boolean;
  valueCell: React.ReactNode | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const held = row.leagues.length;
  const pct = leagueCount > 0 ? Math.round((held / leagueCount) * 100) : 0;

  return (
    <li className={expanded ? "bg-foreground/[0.02]" : undefined}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`grid w-full ${columns} items-center gap-x-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04]`}
      >
        <Chevron open={expanded} />

        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="min-w-0 truncate text-sm text-foreground/90">
            {row.name}
          </span>
          {note && (
            <span className="shrink-0 text-[0.65rem] tabular-nums text-foreground/35">
              {note}
            </span>
          )}
        </span>

        {hasValue && (
          <span className="text-right text-sm tabular-nums text-foreground/70">
            {valueCell}
          </span>
        )}

        <span className="text-right text-sm tabular-nums text-foreground/80">
          {held}
          <span className="text-foreground/30"> / {leagueCount}</span>
        </span>
        {/* Dimmer than the count: it is that number restated against the
            filtered league set, not a second thing to compare. */}
        <span className="text-right text-sm tabular-nums text-foreground/40">
          {pct}%
        </span>
      </button>

      {expanded && (
        <ul className="border-t border-foreground/5 px-3 pb-2 pt-1">
          {row.leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}

"use client";

import { useMemo } from "react";

import type { PlayerSummary } from "@/shared/contract";

import {
  timelinePickAssets,
  timelineRosterGroups,
  timelineRosterSize,
  type TimelineRoster,
} from "../../timeline";
import { DraftPicks } from "../draft-picks";

/**
 * The league at one past moment, in the card's own two-pane shape: every team
 * on the left, the selected one's roster on the right, its picks under both.
 *
 * **It is the teams browser with the browser's numbers removed, which is the
 * whole of the design.** A reader who scrubs the rail has not changed what they
 * are looking at — the same league, the same two panes, the same selection
 * driving the right one from the left — only *which* players are on the roster.
 * So the geometry is carried over exactly: the 44% list, the 8px-tall keyed
 * rows, the lit readout the roster is drawn in, and `DraftPicks` underneath.
 *
 * **The card's nine metrics are deliberately absent, and that is the one
 * substantive difference.** Every one of them — the ranks, the projected points,
 * the KTC and ADP totals — is a fact about the league *today*: a rest-of-season
 * projection is for the season that is left, and a market price is this
 * morning's. Attributing any of them to a roster that stopped existing in
 * October is not a stale number, it is a wrong one. What replaces the column is
 * the roster's **size**, which is knowable at any moment and is the thing a
 * reader is actually comparing across the league at a stop.
 *
 * **The list is in roster-id order at every stop** — see `timelineRosters` for
 * why the moment must not decide the order.
 */
export function TimelineRosters({
  rosters,
  players,
  selectedId,
  onSelect,
  caveat,
}: {
  /** The league at this stop, in draw order — see `timelineRosters`. */
  rosters: readonly TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  /** Which roster the right pane is showing. */
  selectedId: number | null;
  onSelect: (rosterId: number) => void;
  /** The line under the panes saying which moment this is, and how it is known. */
  caveat: string;
}) {
  // Resolved, not synced — the card's own rule for its teams pane: a selection
  // naming a roster this league does not hold falls back to the head of the
  // list rather than emptying the pane.
  const selected =
    rosters.find((r) => r.roster_id === selectedId) ?? rosters[0] ?? null;

  const groups = useMemo(
    () => (selected ? timelineRosterGroups(selected.players, players) : []),
    [selected, players],
  );
  const picks = useMemo(
    () => (selected ? timelinePickAssets(selected, rosters) : []),
    [selected, rosters],
  );

  if (!selected) {
    return (
      <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout-label">
        No rosters stored for this league yet
      </p>
    );
  }

  return (
    <div>
      <div className="flex gap-4">
        <div className="w-[44%] min-w-0 shrink-0">
          <p className="m-0 mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
            Teams
          </p>
          <ul className="m-0 list-none p-0">
            {rosters.map((roster) => (
              <li key={roster.roster_id}>
                <button
                  type="button"
                  onClick={() => onSelect(roster.roster_id)}
                  aria-pressed={roster.roster_id === selected.roster_id}
                  className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors ${
                    roster.roster_id === selected.roster_id
                      ? "bg-active/9"
                      : "hover:bg-foreground/[0.04]"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/80">
                    {roster.name}
                  </span>
                  {/* The one number a past moment can answer for a whole team,
                      counted through the same predicate the pane beside it
                      draws by — so a team reading 12 here cannot show eleven
                      rows there. */}
                  <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-foreground/60">
                    {timelineRosterSize(roster.players)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 flex-1">
          <p className="m-0 mb-1.5 truncate font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
            {selected.name}
          </p>
          {groups.length > 0 ? (
            // The same lit glass the lineup breakdown is drawn on, so the two
            // halves of the card read as one instrument rather than as a table
            // and a panel.
            <div className="relative overflow-hidden rounded-xl border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1 shadow-[var(--readout-shadow)]">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
              />
              <ul className="relative m-0 list-none p-0">
                {groups.map((group) =>
                  group.players.map((player, i) => (
                    <li
                      key={player.player_id}
                      className="flex h-8 items-center gap-2.5 border-b border-active/8 last:border-b-0"
                    >
                      {/* The position takes the slot column's seat and is
                          printed once per run, so a roster reads as blocks
                          rather than as the same three letters repeated down
                          the page — the grouping is the heading. */}
                      <span className="w-9 shrink-0 font-mono text-[0.6875rem] tracking-[0.12em] text-readout/60">
                        {i === 0 ? group.position : ""}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
                        {player.name}
                      </span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          ) : (
            <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
              No players held at this point
            </p>
          )}
        </div>
      </div>

      <DraftPicks picks={picks} />

      {/* Outside both panes, where the card keeps everything that says how the
          numbers above it are known. It has to stay on screen with them, which
          is why it is not on the rail a scroll away. */}
      <p className="m-0 mt-4 text-[0.7rem] leading-relaxed text-foreground/45">
        {caveat}
      </p>
    </div>
  );
}

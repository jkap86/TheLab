"use client";

import { useState } from "react";

import type { LeagueLineupEntry, LineupMetricId } from "@/shared/contract";
import { LINEUP_METRIC_IDS } from "@/features/shared";

import { LINEUP_METRIC_LABELS } from "../helpers/lineup-metrics";
import { DraftPicks } from "./draft-picks";
import { LineupBreakdown } from "./lineup-breakdown";

/**
 * The expanded card's team browser: every team on the left, ordered by the
 * metric its one number column shows, and whichever team is selected — the
 * manager's by default — solved out on the right, lineup then picks, the way
 * Sleeper orders a team page.
 *
 * The column's metric is a per-card `<select>`, deliberately unpersisted like
 * the breakdown's lens: it is a way of reading *this* league's table, not a
 * page preference. Sorting by it is the point of showing it — the list is the
 * standings behind the card's "2nd of 12", so the order and the number must
 * agree. When every team totals zero on the metric the column shows dashes,
 * the same "nothing to say" rule the server ranks null by.
 */

/** Points read to a decimal; capital is a whole-number scale. Same spellings as the breakdown. */
function formatTotal(metric: LineupMetricId, value: number): string {
  if (metric === "ros_starters" || metric === "ros_bench") {
    return value.toFixed(1);
  }
  return value.toLocaleString("en-US");
}

export function LeagueTeams({ entry }: { entry: LeagueLineupEntry }) {
  const [metric, setMetric] = useState<LineupMetricId>("ros_starters");
  const [chosen, setChosen] = useState<number | null>(null);

  // Selection is resolved, not synced: a stale choice (payload refreshed under
  // an open card) falls back to the manager's team rather than an empty pane.
  const fallback = entry.teams.find((t) => t.is_manager) ?? entry.teams[0];
  const selected = entry.teams.find((t) => t.roster_id === chosen) ?? fallback;
  if (!selected) return null;

  const teams = [...entry.teams].sort(
    (a, b) => b.totals[metric] - a.totals[metric],
  );
  const anyNonZero = entry.teams.some((t) => t.totals[metric] !== 0);

  return (
    // Always two columns, whatever the card's width — truncation carries the
    // narrow case, because a stacked layout put the roster below twelve teams.
    <div className="mt-3 flex gap-4">
      <div className="w-[44%] min-w-0 shrink-0 border-t border-foreground/10 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-semibold tracking-wide text-foreground/60">
            Teams
          </span>
          {/* min-w-0 lets the select give way on a phone-width card, where
              the pane is what shrinks — the panes never stack. */}
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as LineupMetricId)}
            aria-label="Order teams by"
            className="min-w-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-foreground/70"
          >
            {LINEUP_METRIC_IDS.map((id) => (
              <option key={id} value={id}>
                {LINEUP_METRIC_LABELS[id].column}
              </option>
            ))}
          </select>
        </div>
        <ul className="mt-1.5">
          {teams.map((team) => (
            <li key={team.roster_id}>
              <button
                type="button"
                onClick={() => setChosen(team.roster_id)}
                aria-pressed={team.roster_id === selected.roster_id}
                className={`flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                  team.roster_id === selected.roster_id
                    ? "bg-foreground/[0.08]"
                    : "hover:bg-foreground/[0.04]"
                }`}
              >
                {/* Full opacity on the accent, as everywhere it is text. */}
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    team.is_manager
                      ? "font-semibold text-active"
                      : "text-foreground/80"
                  }`}
                >
                  {team.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-foreground/60">
                  {anyNonZero ? formatTotal(metric, team.totals[metric]) : "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 flex-1">
        {selected.lineup.starters.length > 0 ? (
          <LineupBreakdown lineup={selected.lineup} title={selected.name} />
        ) : (
          // No seatable lineup (an empty or wholly unknown roster) still names
          // the pane, so the picks below aren't attributed to nobody.
          <div className="border-t border-foreground/10 pt-3">
            <span className="text-xs font-semibold tracking-wide text-foreground/60">
              {selected.name}
            </span>
          </div>
        )}
        <DraftPicks picks={selected.picks} />
      </div>
    </div>
  );
}

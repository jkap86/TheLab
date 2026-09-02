"use client";

import { useState } from "react";

import type { LeagueLineupEntry, LineupMetricId } from "@/shared/contract";
import { LINEUP_METRIC_IDS } from "@/features/shared";

import { LINEUP_METRIC_LABELS } from "../helpers/lineup-metrics";
import { DraftPicks } from "./draft-picks";
import {
  type Lens,
  LineupBreakdown,
  LineupLensKeys,
  lineupTotal,
} from "./lineup-breakdown";

/**
 * The expanded card's team browser: every team on the left, ordered by the
 * metric its one number column shows, and whichever team is selected — the
 * manager's by default — solved out on the right, lineup then picks, the way
 * Sleeper orders a team page.
 *
 * The column's metric is a per-card control, deliberately unpersisted like the
 * lens beside it: it is a way of reading *this* league's table, not a page
 * preference. Sorting by it is the point of showing it — the list is the
 * standings behind the card's "2nd of 12", so the order and the number must
 * agree. When every team totals zero on the metric the column shows dashes,
 * the same "nothing to say" rule the server ranks null by.
 *
 * **The panes never stack**, at any card width. A stacked layout put the
 * roster below twelve teams, which is exactly the comparison the pane exists
 * to make; truncation carries the narrow case instead.
 *
 * Both controls sit on one row above both panes rather than inside them, and
 * that is why the **lens lives here** rather than in `LineupBreakdown`:
 * neither pane is wide enough to carry a header, so the state has to be
 * visible to the keys and to the list at once.
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
  const [lens, setLens] = useState<Lens>("points");

  // Selection is resolved, not synced: a stale choice (payload refreshed under
  // an open card) falls back to the manager's team rather than an empty pane.
  const fallback = entry.teams.find((t) => t.is_manager) ?? entry.teams[0];
  const selected = entry.teams.find((t) => t.roster_id === chosen) ?? fallback;
  if (!selected) return null;

  const teams = [...entry.teams].sort(
    (a, b) => b.totals[metric] - a.totals[metric],
  );
  const anyNonZero = entry.teams.some((t) => t.totals[metric] !== 0);
  const total = lineupTotal(selected.lineup, lens);

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center rounded-full border border-foreground/10 bg-[image:var(--key-bg)] shadow-[var(--key-shadow)]">
          <span className="sr-only">Order teams by</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as LineupMetricId)}
            className="min-w-0 cursor-pointer appearance-none rounded-full bg-transparent px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          >
            {LINEUP_METRIC_IDS.map((id) => (
              <option key={id} value={id}>
                {LINEUP_METRIC_LABELS[id].column}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2.5">
          <LineupLensKeys lens={lens} onChange={setLens} />
          {total && (
            <span className="font-mono text-[0.875rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
              {total}
              <span className="ml-1 text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
                {lens === "points" ? "pts" : "cap"}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-[44%] min-w-0 shrink-0">
          <p className="m-0 mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
            Teams
          </p>
          <ul className="m-0 list-none p-0">
            {teams.map((team) => (
              <li key={team.roster_id}>
                <button
                  type="button"
                  onClick={() => setChosen(team.roster_id)}
                  aria-pressed={team.roster_id === selected.roster_id}
                  className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors ${
                    team.roster_id === selected.roster_id
                      ? "bg-active/9"
                      : "hover:bg-foreground/[0.04]"
                  }`}
                >
                  {/* Full opacity on the readout colour, as everywhere it is
                      text. The manager's own team is the only one lit. */}
                  <span
                    className={`min-w-0 flex-1 truncate text-[0.8125rem] ${
                      team.is_manager
                        ? "font-semibold text-readout"
                        : "text-foreground/80"
                    }`}
                  >
                    {team.name}
                  </span>
                  <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-foreground/60">
                    {anyNonZero ? formatTotal(metric, team.totals[metric]) : "—"}
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
          {selected.lineup.starters.length > 0 ? (
            <LineupBreakdown lineup={selected.lineup} lens={lens} />
          ) : (
            // No seatable lineup (an empty or wholly unknown roster) still has
            // its name above, so the picks below aren't attributed to nobody.
            <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
              No seatable lineup
            </p>
          )}
        </div>
      </div>

      <DraftPicks picks={selected.picks} />
    </div>
  );
}

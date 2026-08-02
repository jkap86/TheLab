import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "./defaults.ts";
import { matchesFilters } from "./predicates.ts";
import type { LeagueBreakdownRow, LeagueFilters } from "./types.ts";

/**
 * What the leagues left over actually *are*, along the axes that say what game
 * is being played.
 *
 * Each row is a filter rather than a hand-written predicate, so a row and the
 * quick-add that selects it can't disagree — "Superflex 17" is by construction
 * the number the `qb+sf ≥ 2` rule would leave. That also inherits the null rule
 * for free: a league whose lineup was never synced is not evidence of a
 * superflex league, so it fails the row the same way it fails the rule.
 *
 * The rows are counted over whatever list is handed in, which is the *matched*
 * list — the rail's question is "what did I just narrow to", not "what does this
 * account hold".
 */
const BREAKDOWN_ROWS: {
  key: string;
  label: string;
  filters: Partial<LeagueFilters>;
}[] = [
  { key: "dynasty", label: "Dynasty", filters: { type: "2" } },
  {
    key: "superflex",
    label: "Superflex",
    filters: { slots: [{ key: "QB+SF", op: "gte", value: 2 }] },
  },
  {
    key: "idp",
    label: "IDP",
    filters: { slots: [{ key: "IDP", op: "gt", value: 0 }] },
  },
  { key: "best_ball", label: "Best ball", filters: { bestBall: "yes" } },
];

/**
 * The four rows, counted in **one pass** over the leagues.
 *
 * It used to be a pass per row, which was four walks over the same list building
 * four intermediate arrays that were immediately reduced to a length. That was
 * unremarkable against one account's hundred-odd leagues and is not against a
 * whole season's, which is what the trades page's copy of this dialog counts
 * over — and it re-runs on every keystroke in the rules editor, since the rows
 * describe the *matched* list and the matched list moves as you type.
 *
 * The predicates are resolved once, outside the loop, for the same reason: each
 * `{...DEFAULT_LEAGUE_FILTERS, ...filters}` spread was being rebuilt per league
 * per row.
 */
export function leagueBreakdown(
  leagues: readonly ManagerLeague[],
): LeagueBreakdownRow[] {
  const rows = BREAKDOWN_ROWS.map(({ key, label, filters }) => ({
    key,
    label,
    filters: { ...DEFAULT_LEAGUE_FILTERS, ...filters },
    count: 0,
  }));

  for (const league of leagues) {
    for (const row of rows) {
      if (matchesFilters(league, row.filters)) row.count += 1;
    }
  }

  return rows.map(({ key, label, count }) => ({ key, label, count }));
}

"use client";

import type { LineupColumn } from "@/shared/contract";
// Relative with an explicit extension, the way `lineup-columns.ts` beside it
// reaches the same module: the rule below is read by Node's own test runner,
// which resolves neither the `@/*` aliases nor an extensionless specifier.
import {
  lineupColumnKey,
  serializePositionSets,
  serializeSlotSets,
  serializeTeamTotalKeys,
} from "../../shared/ktc/columns.ts";

/**
 * What a **per-league** read has to be asked so the standings pane's column can
 * be answered.
 *
 * The two boards it is priced on, the two narrowings it is totalled under, and
 * the key those totals are filed by — five parameters off one column, spelled
 * once because two call sites send them (`useLeagueLineup`, and the timeline
 * route's own two-board half) and a column priced on one board and read under
 * another's key is a table of em dashes with nothing on screen saying why.
 *
 * **The batched read does not use this**, and the difference is instructive:
 * `/manager` asks one question for a hundred leagues, so what it sends is the
 * distinct *axes* its four bays and this column carry between them
 * (`ktcVariantsOf` and friends) plus the keys to carry totals out for. Here
 * there is one league and one column, so the axes and the column are the same
 * thing and the route resolves its single board straight from them.
 *
 * Empty values are omitted rather than sent blank: an absent `?positions=` is
 * the absence of a narrowing, which is what every parser here reads an empty
 * string as anyway, and a shorter query is one fewer thing in a cache key.
 */
export function teamsColumnQuery(column: LineupColumn): Record<string, string> {
  const query: Record<string, string> = {
    ktc_board: column.format,
    qb_board: column.lineup,
    // Always sent, even where it folds to a bare metric id the ten totals
    // already answer: the route matches it against the keys it composes, so a
    // key it can answer without doing anything costs nothing, and a client that
    // sent it only sometimes would be a second rule to get wrong.
    team_totals: serializeTeamTotalKeys([lineupColumnKey(column)]),
  };
  const positions = serializePositionSets([column.positions]);
  if (positions) query.positions = positions;
  const slots = serializeSlotSets([column.slots]);
  if (slots) query.slots = slots;
  return query;
}

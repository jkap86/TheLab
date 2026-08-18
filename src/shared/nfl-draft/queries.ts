import { pool } from "@/shared/db";

import type { NflDraftPick } from "./types";

/**
 * Reads over `nfl_draft_picks`, the table this module owns.
 *
 * Nothing else writes SQL against it — the comps pool asks here, the way it
 * asks `players` for a profile and `ktc` for a price, which is the rule that
 * keeps one concern's schema from leaking into another's queries.
 */

type Row = {
  player_id: string;
  draft_season: string;
  draft_round: number | null;
  draft_slot: number | null;
  draft_overall: number | null;
};

const toPick = (row: Row): NflDraftPick => ({
  playerId: row.player_id,
  season: row.draft_season,
  round: row.draft_round,
  slot: row.draft_slot,
  overall: row.draft_overall,
});

/**
 * Draft picks for the given Sleeper ids, keyed by id.
 *
 * **An id with no row is simply absent from the map**, which is the whole
 * contract: absent means this app does not know where (or whether) the player
 * was drafted, where a present row with a null `overall` means he went
 * undrafted. Every caller inherits that distinction by asking `.get()` rather
 * than reading a column — see {@link draftCapital}, which is the one place it
 * is turned into a number.
 */
export async function getNflDraftPicks(
  playerIds: readonly string[],
): Promise<Map<string, NflDraftPick>> {
  const ids = [...new Set(playerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { rows } = await pool.query<Row>(
    `SELECT player_id, draft_season, draft_round, draft_slot, draft_overall
       FROM nfl_draft_picks
      WHERE player_id = ANY($1::varchar[])`,
    [ids],
  );

  return new Map(rows.map((row) => [row.player_id, toPick(row)]));
}

/**
 * Sleeper ids drafted in a given class — what the deferred `rookie_season`
 * question has been waiting for a real source to answer.
 *
 * `rookie-class.ts` describes the seam: `getRookieClassIds` answers an empty
 * set for its `{ kind: "season" }` arm because `years_exp` counts completed
 * seasons *as of now* and can only ever name the current class. A stored draft
 * class is the stored fact that arm wanted. Wiring it up is deliberately not
 * part of this change — that module's callers are the ADP board's rookie
 * ladder, and repricing picks is a change worth making on its own — but the
 * read exists so the next step is a call rather than a schema decision.
 *
 * Undrafted players are included: they entered the league that year too, which
 * is what a rookie class means.
 */
export async function getNflDraftClassIds(
  season: string,
): Promise<Set<string>> {
  const { rows } = await pool.query<{ player_id: string }>(
    `SELECT player_id FROM nfl_draft_picks WHERE draft_season = $1`,
    [season],
  );
  return new Set(rows.map((row) => row.player_id));
}

/** How many picks are stored — the shrink guard's `previous`. */
export async function countNflDraftPicks(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM nfl_draft_picks`,
  );
  return Number(rows[0]?.count ?? 0);
}

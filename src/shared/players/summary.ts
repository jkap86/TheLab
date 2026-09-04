import type { PlayerShareSummary, PlayerSummary } from "@/shared/contract";

/**
 * The one place a `players` row becomes the shape everything that draws a
 * player holds.
 *
 * Pure apart from the type-only contract import, so the name fallback is
 * testable — which is the point of it being here rather than inline in
 * `./queries`. A fallback written twice is two fallbacks: an id showing up as a
 * name on one surface and a blank on another is exactly the kind of drift
 * nothing would fail on.
 *
 * {@link PlayerSummary} itself is declared in `shared/contract` rather than
 * here, because the trade card is a client module that names one and this
 * folder reaches Postgres.
 */

/** The `players` columns a summary is built from. */
export type PlayerNameRow = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
};

/**
 * One row → one summary.
 *
 * The name is Sleeper's own `full_name` where it has one, the two halves joined
 * where it doesn't, and **the id where neither says anything** — a visible,
 * searchable token rather than an empty cell, which is what a reader can act on
 * when the stored map is behind Sleeper's.
 */
export function toPlayerSummary(row: PlayerNameRow): PlayerSummary {
  const name =
    row.full_name ??
    ([row.first_name, row.last_name].filter(Boolean).join(" ") || row.player_id);
  return {
    player_id: row.player_id,
    name,
    position: row.position,
    team: row.team,
  };
}

/**
 * The extra `players` columns a shares row is drawn from, lifted out of
 * Sleeper's raw blob by the query.
 *
 * Both are already `number | null` by the time they reach here: the regex
 * guards in `./queries` are the house rule for reading a number off that blob,
 * so junk arrives as null rather than failing the statement.
 */
export type PlayerShareRow = PlayerNameRow & {
  age: number | null;
  draft_class: number | null;
};

/**
 * One row plus one price → the shape the shares drawer renders.
 *
 * `ktc_value` is a parameter rather than a column because it is not a fact
 * about the player: it is what one of KTC's markets said about him, and which
 * market is the reader's own answer. The route resolves that once for the whole
 * payload and hands the number in — see `ManagerPlayersPayload.ktc`.
 */
export function toPlayerShareSummary(
  row: PlayerShareRow,
  ktcValue: number | null,
): PlayerShareSummary {
  return {
    ...toPlayerSummary(row),
    age: row.age,
    draft_class: row.draft_class,
    ktc_value: ktcValue,
  };
}

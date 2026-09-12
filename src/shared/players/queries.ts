import type { PlayerSummary } from "@/shared/contract";
import { pool } from "@/shared/db";

import { toPlayerSummary } from "./summary";
import type { PlayerNameRow, PlayerShareRow } from "./summary";

/**
 * Reads over the stored players map.
 *
 * Four — the trades board resolving a page's ids to names, the same read plus
 * the two dated columns the shares drawer draws its Age and Class from, the
 * injury designations the lineup checker judges IR against, and the matchable
 * set the KTC name matcher walks. TheLabX's other three (the rookie class, the
 * search, and its two comps reads) arrive with the surfaces that ask them.
 *
 * **The keyed reads are separate statements rather than one wider one**, and
 * deliberately: the trades board resolves several hundred ids per page and
 * renders none of the dated columns, so widening its read would be two casts
 * per row and two fields on the wire for a page that has nothing to do with
 * them — and the same again for a designation the lineup checker alone asks.
 */

/**
 * Resolve player ids to names/position/team, keyed by id.
 *
 * **A missing id is simply absent**, never a placeholder row: the caller
 * already has the id in hand and knows what to draw without one, and inventing
 * an entry would make "the sync hasn't run" indistinguishable from "Sleeper has
 * no such player".
 */
export async function getPlayersByIds(
  ids: string[],
): Promise<Record<string, PlayerSummary>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<PlayerNameRow>(
    `SELECT player_id, full_name, first_name, last_name, position, team
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerSummary> = {};
  for (const r of rows) out[r.player_id] = toPlayerSummary(r);
  return out;
}

/**
 * The same resolution plus the two columns the shares drawer dates a player by.
 *
 * Both are lifted out of Sleeper's raw blob and **both are regex-guarded before
 * the cast**, the house rule `getMatchablePlayers` below already follows: junk
 * in an untyped blob must read as "unknown", never fail the statement for every
 * other player in the batch.
 *
 * `draft_class` is `metadata.rookie_year` and **nothing else** — see
 * `PlayerShareSummary.draft_class` for why the obvious `activeSeason -
 * years_exp` fallback is not taken here. An absent id is absent, on
 * {@link getPlayersByIds}' rule.
 */
export async function getPlayerShareRows(
  ids: string[],
): Promise<Record<string, PlayerShareRow>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<PlayerShareRow>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            CASE WHEN data->>'age' ~ '^[0-9]{1,3}$'
                 THEN (data->>'age')::int END AS age,
            CASE WHEN data->'metadata'->>'rookie_year' ~ '^[0-9]{4}$'
                 THEN (data->'metadata'->>'rookie_year')::int END AS draft_class
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerShareRow> = {};
  for (const r of rows) out[r.player_id] = r;
  return out;
}

/** A player's injury designation off the stored map, for the IR check. */
export type PlayerInjuryRow = {
  player_id: string;
  /** `full_name`; null for a team defence, which has none. */
  name: string | null;
  /**
   * Sleeper's `injury_status` — `Questionable`, `Out`, `IR`, `PUP`, … — or
   * null where he is healthy. `""` is folded into null: Sleeper has been seen
   * to write both for a fit player, and they are one fact.
   */
  injury_status: string | null;
};

/**
 * Injury designations keyed by id, for the lineup checker's IR reading.
 *
 * **This is `data->>'injury_status'`, not the columned `status`.** The column
 * is the NFL roster status (`Active`, `Inactive`, `Injured Reserve`, …), which
 * is a fact about the team's list; Sleeper decides IR eligibility on the
 * designation, which is the fact about the player. No cast is made, so no
 * regex guard is needed here — the house rule at {@link getPlayerShareRows} is
 * about junk failing a `::int`, and a string read as a string cannot. An
 * absent id is absent, on {@link getPlayersByIds}' rule: the caller reads it as
 * "the sync has not seen him", never as healthy.
 *
 * A fourth narrow statement rather than a widening of the first, on the
 * header's own argument. It is refreshed on the players sync's daily cadence,
 * which is the one thing about it worth knowing: a designation Sleeper changed
 * this morning can read as yesterday's until the next tick.
 */
export async function getPlayerInjuryStatuses(
  ids: string[],
): Promise<Record<string, PlayerInjuryRow>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<PlayerInjuryRow>(
    `SELECT player_id, full_name AS name,
            NULLIF(data->>'injury_status', '') AS injury_status
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerInjuryRow> = {};
  for (const r of rows) out[r.player_id] = r;
  return out;
}

/**
 * A cached player projected down to the fields cross-source name matching needs
 * — see `@/shared/ktc`'s `resolveSleeperIds`. `active` and `birth_year` are
 * lifted out of the raw Sleeper payload so callers never have to know how that
 * blob is shaped.
 */
export type MatchablePlayer = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  active: boolean | null;
  /** Year of birth, or null when Sleeper has no birth date on file. */
  birth_year: number | null;
};

/**
 * Every cached player that could be matched by name, i.e. has a position.
 *
 * Returns the whole table (~12k rows) because the caller builds lookup indexes
 * over all of it; there is nothing to filter by up front. Both lifted fields
 * are regex-guarded before their cast, the house rule for reading a number or
 * a boolean off a Sleeper blob: junk must read as "unknown", never fail the
 * query.
 */
export async function getMatchablePlayers(): Promise<MatchablePlayer[]> {
  const { rows } = await pool.query<MatchablePlayer>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            CASE WHEN data->>'active' IN ('true', 'false')
                 THEN (data->>'active')::boolean END AS active,
            CASE WHEN data->>'birth_date' ~ '^[0-9]{4}'
                 THEN left(data->>'birth_date', 4)::int END AS birth_year
       FROM players
      WHERE position IS NOT NULL`,
  );
  return rows;
}

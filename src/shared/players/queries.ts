import { pool } from "@/shared/db";

/** A player resolved to a display name for rosters/picks UI. */
export type PlayerSummary = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
};

type Row = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
};

/**
 * Resolve player ids to names/position/team from the cache, keyed by id.
 * Missing ids are simply absent from the result.
 */
export async function getPlayersByIds(
  ids: string[],
): Promise<Record<string, PlayerSummary>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<Row>(
    `SELECT player_id, full_name, first_name, last_name, position, team
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerSummary> = {};
  for (const r of rows) {
    const name =
      r.full_name ??
      ([r.first_name, r.last_name].filter(Boolean).join(" ") || r.player_id);
    out[r.player_id] = {
      player_id: r.player_id,
      name,
      position: r.position,
      team: r.team,
    };
  }
  return out;
}

/**
 * What solving one week's lineups needs to know about a player: what he is
 * eligible to start at, and who he plays for.
 *
 * Two halves of one row, which is the whole reason this type exists. They were
 * two reads — {@link getFantasyPositions} for the slots and a `team` lookup for
 * the kickoff join — both narrowed by the same id list against the same primary
 * key, so a week's lineups read `players` twice for facts that arrive together.
 */
export type PlayerLineupMeta = {
  /** Player id → the positions he is eligible at; see {@link getFantasyPositions}. */
  positions: Record<string, string[]>;
  /**
   * Player id → the NFL team he is on, for joining him to his game. Null is
   * Sleeper's own "no team" (a free agent, a retired player), and an id the
   * cache doesn't know is absent — both read as "game unknown" downstream,
   * never as a guess.
   */
  teams: Record<string, string | null>;
};

/**
 * Eligibility and NFL team for these player ids, in one read.
 *
 * The two maps come off the *same* rows rather than two queries, so they cannot
 * disagree about which players the cache knows — the case that used to be
 * reachable, since two reads a moment apart straddle a players sync. Each half
 * keeps the absence rule its own reader depends on: a player the cache doesn't
 * know is eligible for nothing (so he never starts, rather than being seated by
 * a guessed position), and his team is simply unknown (so he keeps his seat in
 * the kickoff ordering rather than being dated by one).
 *
 * Deliberately not `getPlayersByIds` with more columns: a lineup solve wants no
 * name resolved, and the union of every roster in a request is a few hundred
 * ids wide.
 */
export async function getPlayerLineupMeta(
  ids: string[],
): Promise<PlayerLineupMeta> {
  if (ids.length === 0) return { positions: {}, teams: {} };

  const { rows } = await pool.query<{
    player_id: string;
    positions: string[];
    position: string | null;
    team: string | null;
  }>(
    // The `fantasy_positions` unnesting is {@link getFantasyPositions}' own —
    // see its note for why it is done in SQL rather than over the JSONB.
    `SELECT player_id, position, team,
            ARRAY(SELECT jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(fantasy_positions) = 'array'
                         THEN fantasy_positions ELSE '[]'::jsonb END)) AS positions
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const positions: Record<string, string[]> = {};
  const teams: Record<string, string | null> = {};
  for (const r of rows) {
    positions[r.player_id] = eligiblePositions(r);
    teams[r.player_id] = r.team;
  }
  return { positions, teams };
}

/**
 * Sleeper's `fantasy_positions`, falling back to the single `position` when it
 * lists none — the one rule both readers of eligibility share, so the two
 * queries below cannot answer differently for one player.
 */
function eligiblePositions(row: {
  positions: string[];
  position: string | null;
}): string[] {
  return row.positions.length > 0
    ? row.positions
    : row.position
      ? [row.position]
      : [];
}

/**
 * Which of `ids` are in their first NFL season — Sleeper's `years_exp` of 0.
 *
 * It exists for one caller and one question: `/api/adp` marks the rookies on a
 * board so the trades page can rank them into a **rookie-pick ladder**, where
 * the k-th rookie off the *rookie-draft* board is rookie pick k. That is what
 * puts a traded pick and a traded player on one scale, which no board of player
 * prices can do on its own.
 *
 * **Absent is "not known to be a rookie", never "veteran".** `years_exp` is null
 * for a team defence and for anyone Sleeper hasn't filled it in for, and the
 * ladder is an *ordering* — one wrongly-included name shifts every pick below it
 * by one. So the test is an equality against 0 rather than anything looser, and
 * a null simply doesn't match.
 *
 * **It names the class that is a rookie *now*, and that is a known limitation
 * rather than a design.** The players map is replaced daily and carries no
 * history, so a board for a past season finds none of today's rookies in it and
 * hands back an empty ladder — which reads as picks being unpriced on that
 * board (`no-ladder` in `features/trades/pick-value`, whose wording says the
 * board has no rookies to rank against), the honest answer rather than a ladder
 * built from prices those players never had.
 *
 * **The obvious fix is not one, which is why this is deferred rather than
 * done.** The only experience Sleeper gives is `years_exp`, which counts
 * completed seasons *as of now*, so naming the 2024 class means computing
 * `activeSeason − years_exp` — an inference, not a stored fact, and one that is
 * wrong for anyone whose count didn't advance (a missed season, a
 * practice-squad year, a return from out of the league). A wrong *inclusion*
 * shifts every rung below it, which is the one error here that propagates, so a
 * derivation that is right for most players is worse than an empty ladder that
 * says so. Doing this properly wants a persisted `rookie_season` written at sync
 * time — a column and a migration — and it wants a source better than
 * `years_exp` to backfill it from. Until then, historical rookie-pick values are
 * unavailable rather than approximate.
 *
 * Narrowed by id rather than returning every rookie, so this is an index lookup
 * on the primary key and the caller can't accidentally rank a player its board
 * never averaged.
 */
export async function getRookiePlayerIds(
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const { rows } = await pool.query<{ player_id: string }>(
    `SELECT player_id
       FROM players
      WHERE player_id = ANY($1)
        AND years_exp = 0`,
    [ids],
  );
  return new Set(rows.map((r) => r.player_id));
}

/**
 * Ids of every cached player at one of `positions` (Sleeper's spelling — "WR",
 * "DEF", "OLB").
 *
 * Exists so other modules can filter their own tables by position without
 * querying `players` themselves: `/api/projections` narrows a week this way,
 * since `projections` stores no position of its own. Returns an empty list for an
 * unknown position, which callers should read as "nothing matched".
 */
export async function getPlayerIdsByPosition(
  positions: string[],
): Promise<string[]> {
  if (positions.length === 0) return [];

  const { rows } = await pool.query<{ player_id: string }>(
    `SELECT player_id FROM players WHERE position = ANY($1)`,
    [positions],
  );
  return rows.map((r) => r.player_id);
}

/**
 * Player ids → the positions each is eligible at, Sleeper's `fantasy_positions`.
 *
 * Distinct from `position`, and the distinction is the whole reason this exists:
 * a lineup slot takes anyone eligible, so a back listed `["RB","WR"]` can fill a
 * `REC_FLEX` that his primary position would bar him from. Falls back to the
 * single position when Sleeper lists none, and omits an id the cache doesn't know
 * — a caller filling slots should treat that as "eligible for nothing" rather
 * than guess.
 */
export async function getFantasyPositions(
  ids: string[],
): Promise<Record<string, string[]>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<{
    player_id: string;
    positions: string[];
    position: string | null;
  }>(
    // Unnested in SQL so the driver hands back a text[]; `fantasy_positions` is
    // JSONB and Sleeper has been seen to store a non-array there, which
    // `jsonb_array_elements_text` errors on rather than skips.
    `SELECT player_id, position,
            ARRAY(SELECT jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(fantasy_positions) = 'array'
                         THEN fantasy_positions ELSE '[]'::jsonb END)) AS positions
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.player_id] = eligiblePositions(r);
  return out;
}

/**
 * A player as the comps tool profiles one: identity plus the birth date the
 * age-at-season read is made from.
 */
export type PlayerProfile = {
  player_id: string;
  name: string;
  position: string | null;
  /** The player's *current* team — the table stores no historical one. */
  team: string | null;
  /** `YYYY-MM-DD`, or null when Sleeper has no full birth date on file. */
  birth_date: string | null;
};

/**
 * Profiles for the player ids given, keyed by id; missing ids are absent.
 *
 * `birth_date` is lifted out of the blob the way `getMatchablePlayers` lifts
 * `birth_year`, guarded by the same habit — Sleeper promises no types, so the
 * full-date shape is checked before the value is trusted — and kept the whole
 * date rather than the year, because an age *at* a date wants the day.
 */
export async function getPlayerProfiles(
  ids: string[],
): Promise<Record<string, PlayerProfile>> {
  if (ids.length === 0) return {};

  const { rows } = await pool.query<Row & { birth_date: string | null }>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            CASE WHEN data->>'birth_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 THEN data->>'birth_date' END AS birth_date
       FROM players
      WHERE player_id = ANY($1)`,
    [ids],
  );

  const out: Record<string, PlayerProfile> = {};
  for (const r of rows) {
    const name =
      r.full_name ??
      ([r.first_name, r.last_name].filter(Boolean).join(" ") || r.player_id);
    out[r.player_id] = {
      player_id: r.player_id,
      name,
      position: r.position,
      team: r.team,
      birth_date: r.birth_date,
    };
  }
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
 * over all of it; there is nothing to filter by up front.
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

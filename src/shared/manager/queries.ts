import { pool } from "@/shared/db";
import type { LeagueRecord, ManagerLeague } from "@/shared/contract";
import { QB_ELIGIBLE_STARTING_SLOTS } from "@/shared/ktc";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import type { LeagueRosterRow, RankLeague } from "./league-ranks";
import type { ManagerSyncState } from "./sync-freshness";

/*
 * The reads behind the leagues route.
 *
 * A slice of TheLabX's `queries.ts`, which answers a dozen more questions about
 * a manager — matchups, leaguemates, shares, ranks — every one of them for a
 * route that is not ported. What is here is what the leagues list and the sync
 * ask, and the SQL fragments they are built from are carried whole rather than
 * re-derived, because which leagues count as a manager's is the fact three
 * different reads have to agree on.
 */

/**
 * Both of this manager+season's sync timestamps, or null if it has never been
 * tried at all.
 *
 * One column would be the whole of the bug {@link managerSyncGate} exists to
 * fix: a caller could ask "when did we last try" or "when was this last
 * complete" but get one answer to both. See {@link ManagerSyncState} for what
 * each means.
 *
 * A row with `attempt_at` and a null `synced_at` is a real state and not a
 * half-written one: a manager whose every sync so far has left leagues behind.
 */
export async function getManagerSyncState(
  userId: string,
  season: string,
): Promise<ManagerSyncState | null> {
  const { rows } = await pool.query<{
    synced_at: Date | null;
    attempt_at: Date | null;
  }>(
    `SELECT synced_at, attempt_at FROM manager_syncs
      WHERE user_id = $1 AND season = $2`,
    [userId, season],
  );
  const row = rows[0];
  if (!row) return null;
  return { syncedAt: row.synced_at ?? null, attemptAt: row.attempt_at ?? null };
}

/**
 * Sleeper's settings blobs are loosely typed and its defaults are omitted
 * entirely, so every numeric read is regex-guarded before the cast: a league
 * with `"type": "abc"` must not fail the whole query. A missing type falls back
 * to redraft, which is how Sleeper's own absence reads.
 *
 * Written against a league table aliased `l`, and parenthesised because callers
 * append their own comparison.
 */
const LEAGUE_TYPE_SQL = `
  (CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
        THEN (l.settings->>'type')::int ELSE 0 END)`;

/**
 * Sleeper's `settings.type` for a **chopped** league — its native guillotine
 * format, where the week's low scorer is eliminated and their players go back
 * into the pool. It sits alongside 0 redraft, 1 keeper and 2 dynasty.
 */
const CHOPPED_LEAGUE_TYPE = 3;

/** Whether the league is a chopped one, read off its settings blob. */
const CHOPPED_LEAGUE_SQL = `(${LEAGUE_TYPE_SQL} = ${CHOPPED_LEAGUE_TYPE})`;

/**
 * True where Sleeper still serves the league.
 *
 * `gone_at` is the tombstone for a league Sleeper answers 200-with-null for —
 * one somebody deleted. The row and its children stay on purpose, so the
 * marker has to be applied at every read that answers *this manager's leagues*:
 * `league_users` and `rosters` are only ever replaced by a sync of the league
 * itself, and a tombstoned league is never synced again, so those rows are
 * frozen rather than cleared. Without this the league would stay in the list
 * indefinitely.
 *
 * Interpolated, so a call site must alias `leagues` as `l`.
 */
const LIVE_LEAGUE_SQL = `l.gone_at IS NULL`;

/**
 * The roster half of {@link FIELDED_A_TEAM_SQL}, on its own because the lineup
 * reads need exactly this much: a league where the manager holds a roster right
 * now. One spelling, so the two questions cannot drift apart. Same
 * interpolation contract — `leagues` aliased `l`, manager id bound as `$1`.
 */
const HOLDS_A_ROSTER_SQL = `EXISTS (
    SELECT 1 FROM rosters r
     WHERE r.league_id = l.league_id AND r.owner_id = $1
  )`;

/**
 * True where the manager fielded a team in the league — holds a roster now, or
 * was chopped out of a league whose whole point is chopping people out.
 *
 * Membership alone is not that: Sleeper keeps a manager in `league_users` after
 * they stop holding a team, so a league someone joined and left arrives looking
 * exactly like one they play in, minus a roster.
 *
 * Losing the roster means two opposite things depending on the format, which is
 * why the draft half is **gated on {@link CHOPPED_LEAGUE_SQL}** rather than
 * standing alone. In a chopped league being knocked out is the game's ending,
 * not an exit, so the league belongs in the list afterwards — it was played to
 * completion. Everywhere else a vanished roster means the manager walked away,
 * and an ungated draft half would keep those leagues in the list forever on the
 * strength of a draft they attended once.
 *
 * Within a chopped league both draft signals are read, because neither covers
 * the other: `draft_order` is null until an order is set (and a league can be
 * mid-startup with rosters and no draft yet), while `picked_by` is an empty
 * string on an autopick, so a manager who autopicked their whole draft appears
 * in the order and nowhere in the picks.
 *
 * Interpolated, so a call site must alias `leagues` as `l` and bind the
 * manager's user id as `$1`. `jsonb_exists` rather than the `?` operator so the
 * key test can't be misread as a placeholder by anything between here and
 * Postgres.
 */
const FIELDED_A_TEAM_SQL = `(
  ${HOLDS_A_ROSTER_SQL}
  OR (
    ${CHOPPED_LEAGUE_SQL}
    AND EXISTS (
      SELECT 1 FROM drafts d
       WHERE d.league_id = l.league_id
         AND (
           jsonb_exists(d.draft_order, $1)
           OR EXISTS (
             SELECT 1 FROM draft_picks p
              WHERE p.draft_id = d.draft_id AND p.picked_by = $1
           )
         )
    )
  )
)`;

/**
 * The two facts every manager-scoped league read needs: Sleeper still serves
 * the league, and the manager fielded a team in it.
 *
 * One fragment rather than two spelled out per call site, so two reads cannot
 * apply one half and not the other and then disagree about which leagues are a
 * manager's.
 *
 * Interpolated, so a call site must alias `leagues` as `l` and bind the
 * manager's user id as `$1`.
 */
const MANAGER_LEAGUE_SQL = `${LIVE_LEAGUE_SQL} AND ${FIELDED_A_TEAM_SQL}`;

/** One row of the leagues read, before the record is folded together. */
type LeagueRow = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  team_name: string | null;
  wins: string | null;
  losses: string | null;
  ties: string | null;
};

/**
 * Read a manager's leagues for a season from the DB, with the manager's own team
 * name and record. Assumes {@link syncManagerLeagues} has run. The
 * `league_users` join also scopes results to the manager's leagues, and
 * {@link FIELDED_A_TEAM_SQL} narrows that to the ones they actually played.
 *
 * **Ordered as Sleeper listed them**, from `manager_league_order` — the order a
 * manager already reads their leagues in on Sleeper itself, and the only one
 * that carries any of their own arrangement. Alphabetical is the fallback
 * rather than the rule: a league with no stored position sorts to the end by
 * name, which keeps a page rendered before the first sync in a stable order
 * instead of Postgres' own.
 */
export async function getManagerLeagues(
  userId: string,
  season: string,
): Promise<ManagerLeague[]> {
  const { rows } = await pool.query<LeagueRow>(
    `SELECT l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
        lu.team_name,
        mr.settings->>'wins'   AS wins,
        mr.settings->>'losses' AS losses,
        mr.settings->>'ties'   AS ties
     FROM leagues l
     JOIN league_users lu
       ON lu.league_id = l.league_id AND lu.user_id = $1
     LEFT JOIN rosters mr
       ON mr.league_id = l.league_id AND mr.owner_id = $1
     LEFT JOIN manager_league_order mo
       ON mo.league_id = l.league_id AND mo.user_id = $1 AND mo.season = $2
     WHERE l.season = $2
       AND ${MANAGER_LEAGUE_SQL}
     ORDER BY mo.position ASC NULLS LAST, l.name`,
    [userId, season],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    // Resolved here rather than on the client, so a `"use client"` module never
    // imports `shared/sleeper` to render a face.
    avatar_url: sleeperAvatarUrl(r.avatar, "thumb"),
    team_name: r.team_name,
    record: toRecord(r),
  }));
}

/**
 * The manager's record, or null where the league has no roster of theirs stored.
 *
 * All three null is the absent join, which is a different answer from `0-0-0`:
 * one says nothing has been fetched, the other that a season has not started.
 * A single stored count is enough to make the row real, and the other two read
 * as the zeroes Sleeper omits.
 */
function toRecord(r: LeagueRow): LeagueRecord | null {
  if (r.wins == null && r.losses == null && r.ties == null) return null;
  return {
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    ties: Number(r.ties ?? 0),
  };
}

/**
 * What the lineups route solves and ranks each league from: the slots, the
 * scoring, and **every stored roster** — ranking the manager means solving the
 * other eleven teams too. Gated on {@link HOLDS_A_ROSTER_SQL} on purpose: a
 * league where the manager holds no roster (left, or chopped out) has no
 * lineup to rank, where {@link getManagerLeagues} still lists it.
 *
 * One round trip, with the rosters aggregated per league row — the league set
 * is decided once, in this WHERE, rather than re-derived by a second query
 * that could disagree with it.
 */
export async function getManagerLeagueRosters(
  userId: string,
  season: string,
): Promise<RankLeague[]> {
  const { rows } = await pool.query<{
    league_id: string;
    total_rosters: number;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
    rosters: LeagueRosterRow[];
  }>(
    `SELECT l.league_id, l.total_rosters, l.roster_positions, l.scoring_settings,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'roster_id', r.roster_id,
                      'owner_id',  r.owner_id,
                      'players',   COALESCE(r.players, '[]'::jsonb))
                    ORDER BY r.roster_id), '[]'::jsonb)
               FROM rosters r
              WHERE r.league_id = l.league_id) AS rosters
       FROM leagues l
      WHERE l.season = $2
        AND ${LIVE_LEAGUE_SQL}
        AND ${HOLDS_A_ROSTER_SQL}`,
    [userId, season],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    total_rosters: r.total_rosters,
    roster_positions: r.roster_positions,
    scoring_settings: r.scoring_settings,
    rosters: r.rosters,
  }));
}

/**
 * Average draft position over the drafts already synced for this manager's
 * leagues, split into the two board populations the superflex predicate
 * defines — pooling ADP across the two games would price a quarterback off the
 * wrong market at every position (see `adp-value.ts`).
 *
 * This is deliberately the fallback's ADP, not TheLabX's crawled boards: the
 * population is whatever drafts ride along with the manager's own league graph,
 * which for a dynasty league is its rookie draft. Coverage follows the data —
 * a player those drafts never took has no number here, and the lineup solve
 * treats that as "nothing to say" rather than zero. The real board machinery
 * arrives with `/api/adp`.
 *
 * The superflex test is {@link QB_ELIGIBLE_STARTING_SLOTS} counted in SQL —
 * the same derived list `isSuperflexLineup` reads, bound rather than spelled,
 * so the two cannot drift.
 */
export async function getManagerDraftAdp(
  userId: string,
  season: string,
): Promise<{ superflex: Map<string, number>; standard: Map<string, number> }> {
  const { rows } = await pool.query<{
    player_id: string;
    adp: number;
    superflex: boolean;
  }>(
    `SELECT p.player_id,
            AVG(p.pick_no)::float8 AS adp,
            sf.superflex
       FROM draft_picks p
       JOIN drafts d ON d.draft_id = p.draft_id
       JOIN leagues l ON l.league_id = d.league_id
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      CROSS JOIN LATERAL (
        SELECT (SELECT count(*)
                  FROM jsonb_array_elements_text(l.roster_positions) slot
                 WHERE slot = ANY($3::text[])) > 1 AS superflex
      ) sf
      WHERE l.season = $2
        AND p.player_id IS NOT NULL
        AND ${LIVE_LEAGUE_SQL}
      GROUP BY p.player_id, sf.superflex`,
    [userId, season, [...QB_ELIGIBLE_STARTING_SLOTS]],
  );

  const superflex = new Map<string, number>();
  const standard = new Map<string, number>();
  for (const r of rows) (r.superflex ? superflex : standard).set(r.player_id, r.adp);
  return { superflex, standard };
}

/**
 * Leagues still on this manager's list that Sleeper's enumeration did not
 * mention — the candidates for a tombstone, oldest attempt first.
 *
 * **The enumeration is the fast signal that a league is gone.**
 * `syncManagerLeagues` asks Sleeper which leagues this manager is in and then
 * only ever writes the ones it got back, so a league that dropped out of that
 * answer is left exactly as it was: it keeps its stored rosters and members,
 * keeps passing {@link MANAGER_LEAGUE_SQL}, and stays on the page indefinitely.
 *
 * **Absent from the list is not deleted, though, which is why this returns
 * candidates rather than an answer.** Sleeper drops a manager from their own
 * enumeration when they *leave* a league too, and that league is alive and full
 * of other people — tombstoning it would hide it from every one of them. Only
 * `getLeague` can tell the two apart, so the caller probes each of these and
 * tombstones the nulls; the departures resolve themselves, since the next sync
 * of one replaces its rosters without the manager's and
 * {@link FIELDED_A_TEAM_SQL} stops matching.
 *
 * That is also what the bound is for. A departure stays a candidate until its
 * league is next synced, so an unbounded probe would re-ask Sleeper about every
 * league a manager ever left, on every sync, forever. Capped and ordered on
 * `sync_attempt_at` so the caller's stamp rotates a probed league to the back
 * of its own queue and a backlog is walked rather than re-walked.
 */
export async function getUnlistedManagerLeagueIds(
  userId: string,
  season: string,
  listedIds: readonly string[],
  limit: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ league_id: string }>(
    `SELECT l.league_id
       FROM leagues l
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      WHERE l.season = $2
        AND NOT (l.league_id = ANY($3::varchar[]))
        AND ${MANAGER_LEAGUE_SQL}
      ORDER BY l.sync_attempt_at ASC NULLS FIRST, l.league_id
      LIMIT $4`,
    [userId, season, [...listedIds], limit],
  );
  return rows.map((r) => r.league_id);
}

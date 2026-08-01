import { pool } from "@/shared/db";

import { LEAGUE_TYPE_SQL } from "./adp";
import { LEAGUE_TYPE_CODES } from "./adp-filters";
import type { LeagueType } from "./adp-filters";
import { ownedDraftPicks } from "./draft-picks";
import type { TradedPick } from "./draft-picks";
import type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
} from "./types";

export type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
};

type Row = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  wins: string | null;
  losses: string | null;
  ties: string | null;
  settings: Record<string, unknown> | null;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
};

/**
 * When this manager+season was last synced, or null if never. Used to decide
 * whether cached leagues can be served immediately and refreshed in the
 * background.
 */
export async function getManagerSyncedAt(
  userId: string,
  season: string,
): Promise<Date | null> {
  const { rows } = await pool.query<{ synced_at: Date }>(
    `SELECT synced_at FROM manager_syncs WHERE user_id = $1 AND season = $2`,
    [userId, season],
  );
  return rows[0]?.synced_at ?? null;
}

/**
 * Sleeper's `settings.type` for a **chopped** league — its native guillotine
 * format, where the week's low scorer is eliminated and their players go back
 * into the pool. It sits alongside 0 redraft, 1 keeper and 2 dynasty; the
 * client's own type filter spells the same code (`features/shared/league-filters`).
 */
const CHOPPED_LEAGUE_TYPE = 3;

/**
 * Whether the league is a chopped one, read off its settings blob.
 *
 * Regex-guarded before the cast for the house reason: Sleeper omits its defaults
 * and doesn't promise types, so one league holding junk in `type` must not fail
 * the whole query. The fallback is redraft, which is not chopped either way —
 * the same shape and the same fallback as `LEAGUE_TYPE_SQL` in `./adp`.
 *
 * Parenthesised as a whole because it ends in a comparison and is interpolated
 * into a larger boolean.
 */
const CHOPPED_LEAGUE_SQL = `(
  (CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
        THEN (l.settings->>'type')::int ELSE 0 END) = ${CHOPPED_LEAGUE_TYPE}
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
 * and an ungated draft half kept those leagues in the list forever on the
 * strength of a draft they attended once. Sleeper models the format natively
 * now, so this is an exact test where it used to be an approximation that
 * couldn't tell the two apart.
 *
 * Within a chopped league both draft signals are read, because neither covers
 * the other: `draft_order` is null until an order is set (and a league can be
 * mid-startup with rosters and no draft yet), while `picked_by` is an empty
 * string on an autopick, so a manager who autopicked their whole draft appears
 * in the order and nowhere in the picks.
 *
 * Every read that answers "this manager's leagues" applies it, so the leagues
 * route and the batch reads behind the cards can't disagree about which leagues
 * those are — a league missing from the list but still ranked and priced is work
 * done for rows nobody renders. The one exception needs none: `getManagerRosters`
 * joins on `owner_id` already, which is the first half of this predicate.
 *
 * Interpolated, so a call site must alias `leagues` as `l` and bind the
 * manager's user id as `$1`. `jsonb_exists` rather than the `?` operator so the
 * key test can't be misread as a placeholder by anything between here and
 * Postgres.
 */
const FIELDED_A_TEAM_SQL = `(
  EXISTS (
    SELECT 1 FROM rosters r
     WHERE r.league_id = l.league_id AND r.owner_id = $1
  )
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
 * Read a manager's leagues for a season from the DB, with the manager's own team
 * record and each league's settings/scoring. Assumes {@link syncManagerLeagues}
 * has run. The `league_users` join also scopes results to the manager's leagues,
 * and {@link FIELDED_A_TEAM_SQL} narrows that to the ones they actually played.
 *
 * **Ordered as Sleeper listed them**, from `manager_league_order` — the order a
 * manager already reads their leagues in on Sleeper itself, and the only one
 * that carries any of their own arrangement. Alphabetical is the fallback rather
 * than the rule: a league discovered by the crawler and never yet enumerated for
 * *this* manager has no position, and sorting those to the end by name keeps a
 * page rendered before the first manager-driven sync in a stable order instead
 * of Postgres' own.
 */
export async function getManagerLeagues(
  userId: string,
  season: string,
): Promise<ManagerLeague[]> {
  const { rows } = await pool.query<Row>(
    `SELECT
        l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
        l.settings, l.roster_positions, l.scoring_settings,
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
       AND ${FIELDED_A_TEAM_SQL}
     ORDER BY mo.position ASC NULLS LAST, l.name`,
    [userId, season],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    avatar: r.avatar,
    record:
      r.wins == null && r.losses == null && r.ties == null
        ? null
        : {
            wins: Number(r.wins ?? 0),
            losses: Number(r.losses ?? 0),
            ties: Number(r.ties ?? 0),
          },
    settings: r.settings,
    roster_positions: r.roster_positions,
    scoring_settings: r.scoring_settings,
  }));
}

/**
 * The same league shape by id, for a caller holding league ids and no manager —
 * the trades page, which reads the whole crawled market and still has to narrow
 * it with the league filters (what a league starts, what it pays for).
 *
 * `record` is null on every row and that is not a gap to fill: a record is a
 * *manager's* in a league, and there is no manager in this question. Nothing
 * reading these leagues shows one; the league filters narrow on settings and
 * slots, which is what a league is rather than how someone is doing in it.
 */
export async function getLeaguesByIds(
  leagueIds: readonly string[],
): Promise<ManagerLeague[]> {
  if (leagueIds.length === 0) return [];

  const { rows } = await pool.query<Row>(
    `SELECT
        l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
        l.settings, l.roster_positions, l.scoring_settings
     FROM leagues l
     WHERE l.league_id = ANY($1::varchar[])
     ORDER BY l.name`,
    [[...leagueIds]],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    avatar: r.avatar,
    record: null,
    settings: r.settings,
    roster_positions: r.roster_positions,
    scoring_settings: r.scoring_settings,
  }));
}

/**
 * The manager's own roster in each of their leagues for a season, keyed by
 * league id — every player they hold there, IR and taxi included.
 *
 * Keyed by league rather than returned as rows because the caller is counting a
 * player across leagues and already holds the league list from
 * {@link getManagerLeagues}: everything else about a league would be repeated
 * once per rostered player.
 *
 * A league with no entry is one whose rosters aren't cached, or where the
 * manager holds none; an entry with an empty array is a league they hold a
 * roster in and nobody on it yet (pre-draft). The two are different and the
 * distinction survives into the share denominator.
 */
export async function getManagerRosters(
  userId: string,
  season: string,
): Promise<Record<string, string[]>> {
  const { rows } = await pool.query<{
    league_id: string;
    players: string[] | null;
  }>(
    `SELECT r.league_id, r.players
       FROM rosters r
       JOIN leagues l ON l.league_id = r.league_id
      WHERE r.owner_id = $1 AND l.season = $2`,
    [userId, season],
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    // Concatenated rather than assigned: a manager should hold one roster per
    // league, and if Sleeper ever hands back two, silently dropping one would
    // lose players from the count rather than fail visibly.
    out[r.league_id] = [...(out[r.league_id] ?? []), ...(r.players ?? [])];
  }
  return out;
}

/**
 * Every member of each of the manager's leagues for a season, keyed by league —
 * what a count of leaguemates is built from.
 *
 * The manager's own row is kept in `members` rather than filtered here: every
 * synced league has at least that row, so its presence is what separates "shared
 * with nobody" from "not cached", and the caller knows its own id.
 *
 * The two halves of "whose leaguemates" pull opposite ways here, and both are
 * deliberate. *Which leagues* count is {@link FIELDED_A_TEAM_SQL}, the same
 * population the leagues route lists — narrowing it anywhere else would leave
 * this reporting people from a league the page doesn't show. *Who counts inside
 * one* is membership and nothing more, because Sleeper keeps a knocked-out or
 * departed manager in `league_users` and someone you were in a guillotine league
 * with is still someone you know.
 *
 * `users` resolves each id once; where the same user was synced under different
 * names across leagues, the newest row wins.
 */
export async function getManagerLeaguemates(
  userId: string,
  season: string,
): Promise<ManagerLeaguemates> {
  const { rows } = await pool.query<{
    league_id: string;
    user_id: string;
    display_name: string | null;
    avatar: string | null;
  }>(
    `SELECT lu.league_id, lu.user_id, lu.display_name, lu.avatar
       FROM league_users lu
       JOIN league_users me
         ON me.league_id = lu.league_id AND me.user_id = $1
       JOIN leagues l ON l.league_id = lu.league_id
      WHERE l.season = $2
        AND ${FIELDED_A_TEAM_SQL}
      ORDER BY lu.updated_at`,
    [userId, season],
  );

  const members: Record<string, string[]> = {};
  const users: Record<string, Leaguemate> = {};
  for (const r of rows) {
    (members[r.league_id] ??= []).push(r.user_id);
    users[r.user_id] = {
      user_id: r.user_id,
      display_name: r.display_name,
      avatar: r.avatar,
    };
  }
  return { members, users };
}

/**
 * Every team's roster in each of the manager's leagues for a season, with the
 * league's slots and scoring — the batch input for projecting them all at once.
 *
 * Two queries for the whole account rather than two per league, because the
 * caller is ranking the manager across a hundred-plus leagues in one request.
 * A league whose rosters aren't cached yet comes back with no teams, which
 * downstream reads as "nothing to rank" rather than an error — the leagues
 * stream is what fills rosters in, same as {@link getManagerRosters}.
 */
export async function getManagerLeagueRosters(
  userId: string,
  season: string,
): Promise<LeagueRosterSet[]> {
  const { rows: leagues } = await pool.query<{
    league_id: string;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
  }>(
    `SELECT l.league_id, l.roster_positions, l.scoring_settings
       FROM leagues l
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      WHERE l.season = $2
        AND ${FIELDED_A_TEAM_SQL}`,
    [userId, season],
  );
  if (leagues.length === 0) return [];

  const byLeague = new Map<string, LeagueRosterSet>(
    leagues.map((l) => [
      l.league_id,
      {
        league_id: l.league_id,
        roster_positions: l.roster_positions,
        scoring_settings: l.scoring_settings,
        teams: [],
      },
    ]),
  );

  const { rows: rosters } = await pool.query<{
    league_id: string;
    roster_id: number;
    owner_id: string | null;
    players: string[] | null;
    starters: string[] | null;
    reserve: string[] | null;
    taxi: string[] | null;
    settings: Record<string, unknown> | null;
  }>(
    `SELECT league_id, roster_id, owner_id, players, starters, reserve, taxi,
            settings
       FROM rosters
      WHERE league_id = ANY($1::varchar[])`,
    [[...byLeague.keys()]],
  );

  for (const r of rosters) {
    const s = r.settings ?? {};
    byLeague.get(r.league_id)?.teams.push({
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      record: {
        wins: Number(s.wins ?? 0),
        losses: Number(s.losses ?? 0),
        ties: Number(s.ties ?? 0),
      },
      fpts: foldPoints(s.fpts, s.fpts_decimal),
    });
  }

  return [...byLeague.values()];
}

const LEAGUE_TYPE_BY_CODE = new Map<number, LeagueType>(
  (Object.entries(LEAGUE_TYPE_CODES) as [LeagueType, number][]).map(
    ([type, code]) => [code, type],
  ),
);

/**
 * Each league's type — redraft, keeper or dynasty — from Sleeper's numeric
 * `settings.type`, keyed by league id. Regex-guarded before the cast because the
 * settings blob is loosely typed and omits its default, so an absent or junk
 * value reads redraft, matching the `/api/adp` `LEAGUE_TYPE_SQL` and the client
 * filters.
 *
 * Kept out of {@link LeagueRosterSet} because only the ADP-value board needs it:
 * everything else projects a league without caring how it keeps players between
 * seasons.
 */
export async function getLeagueTypes(
  leagueIds: readonly string[],
): Promise<Map<string, LeagueType>> {
  if (leagueIds.length === 0) return new Map();

  const { rows } = await pool.query<{ league_id: string; type_code: number }>(
    `SELECT league_id, ${LEAGUE_TYPE_SQL} AS type_code
       FROM leagues l
      WHERE league_id = ANY($1::varchar[])`,
    [[...leagueIds]],
  );

  const byLeague = new Map<string, LeagueType>();
  for (const r of rows) {
    byLeague.set(r.league_id, LEAGUE_TYPE_BY_CODE.get(r.type_code) ?? "redraft");
  }
  return byLeague;
}

type TeamRow = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: Record<string, unknown> | null;
  display_name: string | null;
  avatar: string | null;
  team_name: string | null;
};

/** Sleeper stores a whole-point count plus a separate hundredths field. */
function foldPoints(whole: unknown, decimal: unknown): number {
  return Number(whole ?? 0) + Number(decimal ?? 0) / 100;
}

/**
 * A league's rosters, league members, and derived standings for the expanded
 * league view. Teams are returned in standings order (wins desc, then points
 * for desc). Returns null when the league isn't cached. Player ids are returned
 * raw; the API route resolves them to names.
 */
export async function getLeagueDetail(
  leagueId: string,
): Promise<LeagueDetail | null> {
  const league = await pool.query<{
    league_id: string;
    name: string;
    season: string;
    status: string;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
  }>(
    `SELECT league_id, name, season, status, roster_positions, scoring_settings
       FROM leagues WHERE league_id = $1`,
    [leagueId],
  );
  if (league.rows.length === 0) return null;
  const l = league.rows[0];

  // The rosters and the traded picks are independent reads over the same league,
  // so they go together; the picks are resolved into per-roster portfolios below.
  const [{ rows }, { rows: tradedRows }] = await Promise.all([
    pool.query<TeamRow>(
      `SELECT
          r.roster_id, r.owner_id, r.players, r.starters, r.reserve, r.taxi,
          r.settings,
          lu.display_name, lu.avatar, lu.team_name
         FROM rosters r
         LEFT JOIN league_users lu
           ON lu.league_id = r.league_id AND lu.user_id = r.owner_id
        WHERE r.league_id = $1`,
      [leagueId],
    ),
    pool.query<TradedPick>(
      `SELECT season, round, roster_id, owner_id
         FROM traded_picks WHERE league_id = $1`,
      [leagueId],
    ),
  ]);

  const picksByRoster = ownedDraftPicks(
    tradedRows,
    rows.map((r) => r.roster_id),
    l.season,
  );

  const teams: LeagueTeam[] = rows.map((r) => {
    const s = r.settings ?? {};
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      manager: r.owner_id
        ? {
            user_id: r.owner_id,
            display_name: r.display_name ?? "",
            avatar: r.avatar,
            team_name: r.team_name,
          }
        : null,
      record: {
        wins: Number(s.wins ?? 0),
        losses: Number(s.losses ?? 0),
        ties: Number(s.ties ?? 0),
      },
      fpts: foldPoints(s.fpts, s.fpts_decimal),
      fpts_against: foldPoints(s.fpts_against, s.fpts_against_decimal),
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      picks: picksByRoster.get(r.roster_id) ?? [],
    };
  });

  // Standings order: most wins, then most points for as the tiebreaker.
  teams.sort(
    (a, b) => b.record.wins - a.record.wins || b.fpts - a.fpts,
  );

  return {
    league_id: l.league_id,
    name: l.name,
    season: l.season,
    status: l.status,
    roster_positions: l.roster_positions,
    scoring_settings: l.scoring_settings,
    teams,
  };
}

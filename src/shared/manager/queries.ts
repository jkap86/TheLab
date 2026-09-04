import { pool } from "@/shared/db";
import type { LeagueRecord, ManagerLeague } from "@/shared/contract";
import { QB_ELIGIBLE_STARTING_SLOTS } from "@/shared/ktc";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { DYNASTY_LEAGUE_TYPE } from "./draft-picks";
import type {
  LeagueDraftRow,
  LeagueUserName,
  TradedPick,
} from "./draft-picks";
import type { AdpEntry } from "./adp-value";
import type { RankLeague } from "./league-ranks";
import type { ManagerSyncState } from "./sync-freshness";
import type { WeekLineupOpponent } from "./week-lineups";

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
export const LEAGUE_TYPE_SQL = `
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
 * Whether the league is a dynasty one — the only format whose ordinary draft is
 * a *rookie* draft, and therefore the gate on {@link getManagerDraftAdp}'s board
 * split.
 *
 * {@link DYNASTY_LEAGUE_TYPE}'s own doc predicted this fragment and said the
 * constant would move back beside it. It stays in `draft-picks` instead, and the
 * fragment comes to the constant: `draft-picks` is pure and unit-tested under
 * Node's runner, so it must not import a module that pulls in `pg`. The
 * dependency points the one legal way.
 */
const DYNASTY_LEAGUE_SQL = `(${LEAGUE_TYPE_SQL} = ${DYNASTY_LEAGUE_TYPE})`;

/**
 * Whether the league is in its first year — no season before it to inherit
 * rosters from, and so the one kind of league that runs a startup draft of its
 * own.
 *
 * The three spellings mirror `draft-picks`' `isInaugural` exactly: Sleeper says
 * "no previous season" as null, `''` and `'0'` depending on vintage, and reading
 * only the null would make every older league look like a fresh one.
 */
const INAUGURAL_LEAGUE_SQL = `
  (l.previous_league_id IS NULL OR l.previous_league_id IN ('', '0'))`;

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
 * reads need exactly this much: a league where the manager holds a roster with
 * players on it right now. One spelling, so the two questions cannot drift
 * apart. Same interpolation contract — `leagues` aliased `l`, manager id bound
 * as `$1`.
 *
 * **A roster row is not a team.** Sleeper keeps the row after the players are
 * gone — a chopped manager's roster outlives their players going back into the
 * pool, and a league that has not drafted yet ships every roster empty — so a
 * bare existence test lists leagues with nothing in them to seat, rank or
 * price. The players array is what makes it a team, and the deliberate cost is
 * that a league is absent from the page until its draft fills a roster.
 *
 * `jsonb_typeof` before `jsonb_array_length` because the column is nullable and
 * untyped: null is Sleeper's own spelling of an empty roster, and both it and
 * anything that is not an array must read as "no players" rather than error the
 * query mid-scan.
 *
 * What it costs is the index-only scan on `rosters_owner_league_idx`, since
 * `players` is not in that index's INCLUDE and stays out on purpose — carrying
 * a whole roster's jsonb in the index would cost every sync's write far more
 * than the one heap fetch per league it saves a read.
 */
const HOLDS_A_ROSTER_SQL = `EXISTS (
    SELECT 1 FROM rosters r
     WHERE r.league_id = l.league_id AND r.owner_id = $1
       AND jsonb_typeof(r.players) = 'array'
       AND jsonb_array_length(r.players) > 0
  )`;

/**
 * True where the manager fielded a team in the league — holds a rostered team
 * now ({@link HOLDS_A_ROSTER_SQL}), or was chopped out of a league whose whole
 * point is chopping people out.
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

/**
 * A roster's standings inputs, read off Sleeper's settings blob.
 *
 * Guarded the way every other read of that blob is — the values are strings in
 * JSONB and a league carrying a non-numeric one must not fail the whole query —
 * and taking the alias as an argument because the ranks below compare two
 * rosters of the same league to each other.
 *
 * Points are `fpts` plus `fpts_decimal` hundredths: Sleeper splits a decimal
 * score across two integer fields, and dropping the second is what makes two
 * teams a tenth of a point apart tie for a place they do not share.
 */
const rosterWinsSql = (a: string) => `
  (CASE WHEN ${a}.settings->>'wins' ~ '^[0-9]+$'
        THEN (${a}.settings->>'wins')::int ELSE 0 END)`;

const rosterGamesSql = (a: string) => `
  (${rosterWinsSql(a)}
   + (CASE WHEN ${a}.settings->>'losses' ~ '^[0-9]+$'
           THEN (${a}.settings->>'losses')::int ELSE 0 END)
   + (CASE WHEN ${a}.settings->>'ties' ~ '^[0-9]+$'
           THEN (${a}.settings->>'ties')::int ELSE 0 END))`;

const rosterPointsSql = (a: string) => `
  ((CASE WHEN ${a}.settings->>'fpts' ~ '^-?[0-9]+([.][0-9]+)?$'
         THEN (${a}.settings->>'fpts')::numeric ELSE 0 END)
   + (CASE WHEN ${a}.settings->>'fpts_decimal' ~ '^[0-9]+$'
           THEN (${a}.settings->>'fpts_decimal')::numeric / 100 ELSE 0 END))`;

/**
 * Where the manager's roster sits among the league's, twice over.
 *
 * **Standard competition ranking, counted rather than windowed**: a roster's
 * place is one more than the number of rosters strictly ahead of it, so ties
 * share the better rank and the next distinct total skips — the same convention
 * `league-ranks.ts` ranks lineups by, and the one Sleeper's own standings page
 * uses.
 *
 * The standings comparison is a **row comparison**, which Postgres evaluates
 * lexicographically: wins first, points for as the tiebreak. That is Sleeper's
 * order, and spelling it as one comparison rather than two is what keeps it
 * from drifting into `wins > wins OR (wins = wins AND pts > pts)` and back.
 *
 * `league_played` and `league_scored` are the two guards that keep a rank from
 * being a claim. A league where nobody has played a game has no standings —
 * every roster is 0-0 and "1st of 12" among them says something that is not
 * true — and a league where nobody has scored has no points rank. They are two
 * booleans rather than one because the pre-season states differ: a league can
 * have played no games *and* carry no points, but a scoring quirk that leaves
 * points on the board with no result recorded should still not invent a
 * standings position.
 *
 * Written as a LATERAL so it runs once per league row against that league's
 * rosters — a dozen rows behind the `rosters` primary key.
 */
const MANAGER_RANKS_SQL = `
  LEFT JOIN LATERAL (
    SELECT
      1 + count(*) FILTER (
        WHERE (${rosterWinsSql("o")}, ${rosterPointsSql("o")})
            > (${rosterWinsSql("mr")}, ${rosterPointsSql("mr")})
      ) AS standings_rank,
      1 + count(*) FILTER (
        WHERE ${rosterPointsSql("o")} > ${rosterPointsSql("mr")}
      ) AS points_rank,
      bool_or(${rosterGamesSql("o")} > 0)  AS league_played,
      bool_or(${rosterPointsSql("o")} > 0) AS league_scored
    FROM rosters o
    WHERE o.league_id = l.league_id
  ) rk ON true`;

/**
 * The league columns every reader of a {@link ManagerLeague} selects.
 *
 * Shared rather than written out per query because two questions now ask it —
 * a manager's leagues, and the leagues a season's trades happened in — and the
 * second is not a manager question at all. A field added to `ManagerLeague` has
 * to arrive in both, and two column lists is how the trades board comes to be
 * missing a filter key the manager page has.
 */
export const LEAGUE_COLUMNS_SQL = `
  l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
  l.roster_positions, l.settings, l.scoring_settings`;

/** One row of {@link LEAGUE_COLUMNS_SQL}. */
export type LeagueRow = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  // JSONB comes back parsed, so these arrive as the shapes the contract names.
  roster_positions: string[] | null;
  settings: Record<string, unknown> | null;
  scoring_settings: Record<string, number> | null;
};

/** A {@link LeagueRow} plus the manager-specific half of the leagues read. */
type ManagerLeagueRowShape = LeagueRow & {
  team_name: string | null;
  wins: string | null;
  losses: string | null;
  ties: string | null;
  /** Null where no roster of theirs is stored — see {@link toRanks}. */
  manager_roster_id: number | null;
  standings_rank: string | null;
  points_rank: string | null;
  /** Whether *anyone* in the league has played, and whether anyone has scored. */
  league_played: boolean | null;
  league_scored: boolean | null;
};

/**
 * A {@link LeagueRow} as the shape every reader holds.
 *
 * `team_name` and `record` are arguments rather than columns of the row,
 * because both are a *manager's* in a league and one caller is asking about
 * leagues with no manager in the question — see `getSeasonTradeLeagues`, where
 * null on both is the honest answer rather than a gap to fill.
 */
export function toManagerLeague(
  r: LeagueRow,
  manager: {
    team_name?: string | null;
    record?: ManagerLeague["record"];
    standings_rank?: number | null;
    points_rank?: number | null;
  } = {},
): ManagerLeague {
  return {
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    // Resolved here rather than on the client, so a `"use client"` module never
    // imports `shared/sleeper` to render a face.
    avatar_url: sleeperAvatarUrl(r.avatar, "thumb"),
    team_name: manager.team_name ?? null,
    record: manager.record ?? null,
    standings_rank: manager.standings_rank ?? null,
    points_rank: manager.points_rank ?? null,
    // Sleeper's own blobs, forwarded rather than reduced — see `ManagerLeague`
    // for why the league filters need the keys and not a set of flags.
    roster_positions: r.roster_positions,
    settings: r.settings,
    scoring_settings: r.scoring_settings,
  };
}

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
  const { rows } = await pool.query<ManagerLeagueRowShape>(
    `SELECT ${LEAGUE_COLUMNS_SQL},
        lu.team_name,
        mr.roster_id           AS manager_roster_id,
        mr.settings->>'wins'   AS wins,
        mr.settings->>'losses' AS losses,
        mr.settings->>'ties'   AS ties,
        rk.standings_rank, rk.points_rank, rk.league_played, rk.league_scored
     FROM leagues l
     JOIN league_users lu
       ON lu.league_id = l.league_id AND lu.user_id = $1
     LEFT JOIN rosters mr
       ON mr.league_id = l.league_id AND mr.owner_id = $1
     ${MANAGER_RANKS_SQL}
     LEFT JOIN manager_league_order mo
       ON mo.league_id = l.league_id AND mo.user_id = $1 AND mo.season = $2
     WHERE l.season = $2
       AND ${MANAGER_LEAGUE_SQL}
     ORDER BY mo.position ASC NULLS LAST, l.name`,
    [userId, season],
  );

  return rows.map((r) =>
    toManagerLeague(r, {
      team_name: r.team_name,
      record: toRecord(r),
      ...toRanks(r),
    }),
  );
}

/**
 * The manager's two ranks, or nulls where ranking them would be a claim.
 *
 * **The roster gate is the one that is easy to lose.** `mr` is a LEFT JOIN and
 * the SQL reads its settings through the same regex guard every other roster
 * goes through, so a manager with *no* stored roster compares as 0-0-0 and
 * comes back ranked — last, but ranked, and drawn on the plate as a real
 * position. A league is on this list when the manager fielded a team *or* was
 * chopped out of a chopped one, and the second of those has no roster left to
 * rank. So the row carries `manager_roster_id` for no other purpose than this.
 */
function toRanks(r: ManagerLeagueRowShape): {
  standings_rank: number | null;
  points_rank: number | null;
} {
  if (r.manager_roster_id === null) {
    return { standings_rank: null, points_rank: null };
  }
  return {
    standings_rank:
      r.league_played && r.standings_rank != null ? Number(r.standings_rank) : null,
    points_rank:
      r.league_scored && r.points_rank != null ? Number(r.points_rank) : null,
  };
}

/**
 * The manager's record, or null where the league has no roster of theirs stored.
 *
 * All three null is the absent join, which is a different answer from `0-0-0`:
 * one says nothing has been fetched, the other that a season has not started.
 * A single stored count is enough to make the row real, and the other two read
 * as the zeroes Sleeper omits.
 */
function toRecord(r: ManagerLeagueRowShape): LeagueRecord | null {
  if (r.wins == null && r.losses == null && r.ties == null) return null;
  return {
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    ties: Number(r.ties ?? 0),
  };
}

/**
 * The ids of a manager's leagues for a season — {@link getManagerLeagues}
 * reduced to the one column the trades board's `mine` circle binds.
 *
 * The same predicate rather than a second one, deliberately: "which leagues are
 * this manager's" has one answer, and a circle that quietly disagreed with the
 * manager page about it would be a filter nobody could check.
 */
export async function getManagerLeagueIds(
  userId: string,
  season: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ league_id: string }>(
    `SELECT l.league_id
       FROM leagues l
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      WHERE l.season = $2
        AND ${MANAGER_LEAGUE_SQL}`,
    [userId, season],
  );
  return rows.map((r) => r.league_id);
}

/**
 * Everyone who shares a league with this manager for the season, as ids.
 *
 * It keeps two opposing rules intact: *which leagues* count is
 * {@link FIELDED_A_TEAM_SQL} — a league the manager never played in is not
 * theirs — and *who counts inside one* is bare membership, because someone
 * chopped out of a guillotine league is still someone you know.
 *
 * **The manager themselves is not among them.** The id list *is* the answer
 * here, so a manager listed as their own leaguemate would be a claim rather
 * than a sentinel; a caller that wants the reader in the set says so —
 * `shared/trades/circle` does, for one of its two leaguemate circles and not
 * the other, and its doc explains why the asymmetry is right.
 */
export async function getLeaguemateIds(
  userId: string,
  season: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT lm.user_id
       FROM leagues l
       JOIN league_users me
         ON me.league_id = l.league_id AND me.user_id = $1
       JOIN league_users lm
         ON lm.league_id = l.league_id AND lm.user_id <> $1
      WHERE l.season = $2
        AND ${MANAGER_LEAGUE_SQL}`,
    [userId, season],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Every roster the manager holds this season, as league id → the player ids on
 * it.
 *
 * The shares drawer's whole input, and it ships **raw**: Sleeper's array
 * verbatim, IR and taxi included, its `""` / `"0"` slot padding not stripped.
 * Counting happens on the client because the manager page narrows its league
 * list five ways and a share has to be counted over the leagues left — see
 * `ManagerPlayersPayload`.
 *
 * **`LIVE_LEAGUE_SQL` is required and `FIELDED_A_TEAM_SQL` is not**, which looks
 * backwards until you take them one at a time. The `owner_id` predicate below
 * *is* that fragment's roster half, so applying it too would only restate the
 * join. The tombstone is not implied by anything: a deleted league's roster rows
 * are frozen rather than cleared, so without the guard a league nobody can open
 * would keep contributing shares forever.
 *
 * Concatenating rather than assigning, in case Sleeper ever answers with two
 * rosters for one owner in one league — a co-owned team read twice would
 * otherwise silently drop one of them.
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
      WHERE r.owner_id = $1 AND l.season = $2
        AND ${LIVE_LEAGUE_SQL}`,
    [userId, season],
  );

  const out: Record<string, string[]> = {};
  for (const row of rows) {
    // The column is nullable and untyped — null is Sleeper's own spelling of an
    // empty roster, and a non-array must read as "no players" rather than throw
    // halfway through the fold.
    const players = Array.isArray(row.players) ? row.players : [];
    const held = out[row.league_id];
    if (held) held.push(...players);
    else out[row.league_id] = [...players];
  }
  return out;
}

/** One `league_users` row as {@link getManagerLeaguemates} reads it. */
export type LeaguemateRow = {
  user_id: string;
  display_name: string | null;
  avatar: string | null;
};

/**
 * Everyone in the manager's leagues this season: who is in each league, and
 * what to call them.
 *
 * The same two opposing rules {@link getLeaguemateIds} states — *which* leagues
 * count is {@link FIELDED_A_TEAM_SQL}, and *who* counts inside one is bare
 * membership, because someone chopped out of a guillotine league is still
 * someone you know.
 *
 * **The manager's own row is kept**, which is the one place this diverges from
 * that function, and deliberately: there the id list *is* the answer, so
 * listing a manager as their own leaguemate would be a claim. Here `members` is
 * a population to count over, and the manager's presence in a league is the
 * only thing separating "this league is stored and they share it with nobody"
 * from "this league has no member rows at all". The fold drops them.
 *
 * `ORDER BY lu.updated_at` so the newest spelling wins where one person was
 * synced under different display names across leagues — the same reading
 * `getTradeManagers` takes of the same table.
 */
export async function getManagerLeaguemates(
  userId: string,
  season: string,
): Promise<{
  members: Record<string, string[]>;
  users: Record<string, LeaguemateRow>;
}> {
  const { rows } = await pool.query<LeaguemateRow & { league_id: string }>(
    `SELECT lu.league_id, lu.user_id, lu.display_name, lu.avatar
       FROM league_users lu
       JOIN league_users me
         ON me.league_id = lu.league_id AND me.user_id = $1
       JOIN leagues l ON l.league_id = lu.league_id
      WHERE l.season = $2
        AND ${MANAGER_LEAGUE_SQL}
      ORDER BY lu.updated_at`,
    [userId, season],
  );

  const members: Record<string, string[]> = {};
  const users: Record<string, LeaguemateRow> = {};
  for (const row of rows) {
    (members[row.league_id] ??= []).push(row.user_id);
    users[row.user_id] = {
      user_id: row.user_id,
      display_name: row.display_name,
      avatar: row.avatar,
    };
  }
  return { members, users };
}

/**
 * One league as the lineups route reads it: {@link RankLeague} for the solve,
 * plus everything `leagueRosterPicks` resolves the pick portfolios from. One
 * row type rather than two queries, so the ranks and the picks cannot be
 * answered off different league sets.
 */
export type ManagerLeagueRow = RankLeague & {
  league_type: number;
  draft_rounds: number | null;
  previous_league_id: string | null;
  traded_picks: TradedPick[];
  drafts: LeagueDraftRow[];
  users: LeagueUserName[];
};

/**
 * What the lineups route solves and ranks each league from: the slots, the
 * scoring, and **every stored roster** — ranking the manager means solving the
 * other eleven teams too — plus the traded picks, drafts and member names the
 * pick portfolio is reconstructed from. Gated on {@link HOLDS_A_ROSTER_SQL} on
 * purpose: a league where the manager holds no rostered team (left, chopped
 * out, or not yet drafted) has no lineup to rank, where
 * {@link getManagerLeagues} still lists it for the chopped case.
 *
 * One round trip, with each child collection aggregated per league row — the
 * league set is decided once, in this WHERE, rather than re-derived by a
 * second query that could disagree with it.
 *
 * The casts inside the drafts blob follow TheLabX's own draft read: every
 * numeric read off a Sleeper settings blob (`rounds`, `teams`,
 * `reversal_round`, and the league's `draft_rounds` above) is regex-guarded
 * before the `::int` — junk must read as "unknown", not fail the query — while
 * `start_time` rides through `jsonb_build_object` as a JSON number, which is
 * exact for epoch milliseconds.
 */
export async function getManagerLeagueRosters(
  userId: string,
  season: string,
): Promise<ManagerLeagueRow[]> {
  const { rows } = await pool.query<ManagerLeagueRow>(
    `SELECT ${LINEUP_LEAGUE_COLUMNS_SQL}
       FROM leagues l
      WHERE l.season = $2
        AND ${LIVE_LEAGUE_SQL}
        AND ${HOLDS_A_ROSTER_SQL}`,
    [userId, season],
  );

  return rows;
}

/**
 * Everything a solve reads about one league: its shape, its rosters, its
 * members, its traded picks and its drafts.
 *
 * **Extracted so the two reads of it cannot drift**, which is
 * `LEAGUE_COLUMNS_SQL`'s own argument one grain down: `getManagerLeagueRosters`
 * answers this for a manager's whole account and {@link getLeagueLineupRow} for
 * one league by id, and a field added to {@link ManagerLeagueRow} now arrives on
 * both or on neither. Written against a league table aliased `l`.
 */
const LINEUP_LEAGUE_COLUMNS_SQL = `
            l.league_id, l.total_rosters, l.roster_positions, l.scoring_settings,
            l.previous_league_id,
            ${LEAGUE_TYPE_SQL} AS league_type,
            (CASE WHEN l.settings->>'draft_rounds' ~ '^[0-9]+$'
                  THEN (l.settings->>'draft_rounds')::int END) AS draft_rounds,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'roster_id', r.roster_id,
                      'owner_id',  r.owner_id,
                      'players',   COALESCE(r.players, '[]'::jsonb))
                    ORDER BY r.roster_id), '[]'::jsonb)
               FROM rosters r
              WHERE r.league_id = l.league_id) AS rosters,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'season',    tp.season,
                      'round',     tp.round,
                      'roster_id', tp.roster_id,
                      'owner_id',  tp.owner_id)), '[]'::jsonb)
               FROM traded_picks tp
              WHERE tp.league_id = l.league_id) AS traded_picks,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'draft_id',    d.draft_id,
                      'season',      d.season,
                      'status',      d.status,
                      'type',        d.type,
                      'start_time',  d.start_time,
                      'rounds',      CASE WHEN d.settings->>'rounds' ~ '^[0-9]+$'
                                          THEN (d.settings->>'rounds')::int END,
                      'teams',       CASE WHEN d.settings->>'teams' ~ '^[0-9]+$'
                                          THEN (d.settings->>'teams')::int END,
                      'reversal_round',
                                     CASE WHEN d.settings->>'reversal_round' ~ '^[0-9]+$'
                                          THEN (d.settings->>'reversal_round')::int END,
                      'draft_order', d.draft_order)), '[]'::jsonb)
               FROM drafts d
              WHERE d.league_id = l.league_id) AS drafts,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'user_id',      u.user_id,
                      'display_name', u.display_name,
                      'team_name',    u.team_name)), '[]'::jsonb)
               FROM league_users u
              WHERE u.league_id = l.league_id) AS users`;

/**
 * The same row for **one league**, named by id rather than reached through a
 * manager.
 *
 * The league timeline's read: it prices a rewound roster on today's boards, so
 * it needs exactly what a solve needs and nothing about whose page it is on.
 * `HOLDS_A_ROSTER_SQL` is deliberately absent — that predicate answers *which
 * leagues are a manager's*, and there is no manager in this question — while
 * `LIVE_LEAGUE_SQL` stays, since a tombstoned league's rows are frozen rather
 * than cleared and nothing should draw a history for a league nobody can open.
 *
 * Null where no such league is stored, which every caller reads as "nothing to
 * say" rather than as an error.
 */
export async function getLeagueLineupRow(
  leagueId: string,
): Promise<ManagerLeagueRow | null> {
  const { rows } = await pool.query<ManagerLeagueRow>(
    `SELECT ${LINEUP_LEAGUE_COLUMNS_SQL}
       FROM leagues l
      WHERE l.league_id = $1
        AND ${LIVE_LEAGUE_SQL}`,
    [leagueId],
  );
  return rows[0] ?? null;
}

/**
 * Average draft position over the drafts already synced for this manager's
 * leagues, split into the boards that can legitimately be pooled — the
 * superflex predicate's two populations, and rookie drafts apart from full ones.
 *
 * **A rookie draft is not a short startup draft, and its `pick_no` is not an
 * overall pick.** It runs three to five rounds over the incoming class alone, so
 * its 1.01 is `pick_no` 1 — the number a startup gives the best player in the
 * game. This read used to `AVG` the two together and hand the result to
 * {@link adpValue} against a startup-scale pool, which priced a 1.01 at the full
 * {@link ADP_PEAK} and put an entire third round of rookies above the sixtieth
 * player off a startup board. The boards are separate here and
 * {@link adpEntryValue} is what makes them summable again; see `adp-value.ts`
 * for the map.
 *
 * **A rookie draft is exactly a dynasty league's non-startup draft**, which is
 * the same rule `dynastyPickGrid` reads and is spelled from the same two facts:
 * only dynasty drafts a class rather than a pool, and only an *inaugural* league
 * holds a startup of its own — its earliest draft, since it runs a startup and a
 * rookie draft under one season label. A keeper league's draft is a full draft
 * with some picks pre-spent, not a rookie one.
 *
 * **Two drafts are excluded outright.** An auction's `pick_no` is nomination
 * order, which is not a pick order — the rule `leagueRosterPicks` already lives
 * by, and averaging it in was pricing players off the order they happened to be
 * called in. And a draft that is not `complete` has only its earliest picks
 * stored, so every player taken so far reads as a first-rounder while the rest
 * of the board has nothing at all; a half-finished rookie draft is the case that
 * makes it worst.
 *
 * This is deliberately still the fallback's ADP, not TheLabX's crawled boards:
 * the population is whatever drafts ride along with the manager's own league
 * graph. Coverage follows the data — a player those drafts never took has no
 * number here, and the lineup solve treats that as "nothing to say" rather than
 * zero. The real board machinery arrives with `/api/adp`.
 *
 * The superflex test is {@link QB_ELIGIBLE_STARTING_SLOTS} counted in SQL —
 * the same derived list `isSuperflexLineup` reads, bound rather than spelled,
 * so the two cannot drift.
 */
export function getManagerDraftAdp(
  userId: string,
  season: string,
): Promise<DraftAdpBoards> {
  return readDraftAdp(season, userId);
}

/**
 * The same two boards over **every** stored draft of the season, with no
 * manager in the question.
 *
 * The trades board is what needed one. It is `accountless` by construction —
 * the trades worth reading are the market's, not one account's — so there is no
 * manager whose synced drafts could be the population, and the draft-capital
 * basis had nothing to price against. Widening the population is the only
 * answer available: what the corpus holds *is* the board here.
 *
 * **The two splits that make an average meaningful are unchanged**, which is
 * what keeps this from being the pooling `adp-value.ts` warns against. Superflex
 * and standard drafts stay apart because a quarterback is a different asset in
 * each, and rookie boards stay apart from full ones because their `pick_no` is
 * not the same unit. What is pooled is drafts of the *same* kind across leagues,
 * which is what an average draft position has always meant.
 *
 * It is still the fallback's ADP rather than TheLabX's crawled boards: there is
 * no board *selection* here — no `adpBoardFor`, no filters, no signature — so a
 * reader cannot ask to be priced against dynasty startups alone. That arrives
 * with `/api/adp`, and this is the read it will replace.
 */
export function getSeasonDraftAdp(season: string): Promise<DraftAdpBoards> {
  return readDraftAdp(season, null);
}

/** The two populations an ADP average can legitimately be pooled over. */
export type DraftAdpBoards = {
  superflex: Map<string, AdpEntry>;
  standard: Map<string, AdpEntry>;
};

/**
 * The body both readings share, with the manager as the only difference.
 *
 * One statement rather than two, because every judgement in it — which draft is
 * a rookie board, which drafts are excluded, how the two boards fold together —
 * is a rule about drafts rather than about whose they are. Two copies would be
 * two chances for one of Sleeper's quirks to be read differently on two pages
 * showing the same players.
 */
async function readDraftAdp(
  season: string,
  userId: string | null,
): Promise<DraftAdpBoards> {
  const { rows } = await pool.query<{
    player_id: string;
    adp: number;
    superflex: boolean;
    rookie: boolean;
  }>(
    `WITH scoped_leagues AS (
       SELECT l.league_id,
              ${DYNASTY_LEAGUE_SQL} AS dynasty,
              ${INAUGURAL_LEAGUE_SQL} AS inaugural,
              (SELECT count(*)
                 FROM jsonb_array_elements_text(l.roster_positions) slot
                WHERE slot = ANY($3::text[])) > 1 AS superflex
         FROM leagues l
        WHERE l.season = $2
          AND ${LIVE_LEAGUE_SQL}
          -- A null manager is the corpus-wide read; the parameter is still
          -- bound so the two share one plan-shaped statement.
          AND ($1::text IS NULL
               OR EXISTS (SELECT 1 FROM league_users lu
                           WHERE lu.league_id = l.league_id
                             AND lu.user_id = $1))
     ),
     league_drafts AS (
       -- Sequenced over the league's drafts WHOLE, before the two exclusions
       -- below: the startup is the earliest draft that exists, not the earliest
       -- one that survived a filter. Ordered exactly as \`draft-picks\` sorts —
       -- start_time ascending with an undated stray last, ties on draft_id.
       SELECT d.draft_id,
              d.status,
              d.type,
              sl.dynasty,
              sl.inaugural,
              sl.superflex,
              row_number() OVER (PARTITION BY d.league_id
                                 ORDER BY d.start_time ASC NULLS LAST, d.draft_id) AS seq
         FROM drafts d
         JOIN scoped_leagues sl ON sl.league_id = d.league_id
     ),
     boards AS (
       SELECT draft_id,
              superflex,
              (dynasty AND NOT (inaugural AND seq = 1)) AS rookie
         FROM league_drafts
        WHERE status = 'complete'
          -- IS DISTINCT FROM, because a null type is an unknown format rather
          -- than a known auction and must not be swept out with them.
          AND type IS DISTINCT FROM 'auction'
     )
     SELECT p.player_id,
            b.superflex,
            b.rookie,
            AVG(p.pick_no)::float8 AS adp
       FROM draft_picks p
       JOIN boards b ON b.draft_id = p.draft_id
      WHERE p.player_id IS NOT NULL
      GROUP BY p.player_id, b.superflex, b.rookie`,
    [userId, season, [...QB_ELIGIBLE_STARTING_SLOTS]],
  );

  const superflex = new Map<string, AdpEntry>();
  const standard = new Map<string, AdpEntry>();
  for (const r of rows) {
    const board = r.superflex ? superflex : standard;
    // A first-year rookie can sit on both boards — taken in a rookie draft here
    // and in a redraft league's full draft there — and the full board wins.
    // It prices him against the whole pool, which is the scale `leagueAdpPool`
    // anchors to and the map only approximates; the rookie board is here to
    // answer where there is no full-draft number at all, which on a
    // dynasty-only account is every rookie. Order-independent on purpose: a
    // full row overwrites a rookie one, a rookie row defers to a full one.
    if (!r.rookie) board.set(r.player_id, { board: "full", adp: r.adp });
    else if (!board.has(r.player_id)) {
      board.set(r.player_id, { board: "rookie", adp: r.adp });
    }
  }
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

/**
 * One league's week, as the lineup checker reads it: the league's own slots and
 * scoring, and the manager's roster with the lineup they had set *that week*.
 *
 * `starters` and `players` are the raw Sleeper arrays, padding included — the
 * solve dedupes and drops `""`/`"0"` itself, because `compareLineup` reads
 * `starters` **positionally** against the league's starting slots and a
 * cleaned-up array would no longer line up.
 */
export type ManagerWeekLineupRow = {
  league_id: string;
  total_rosters: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  /** Sleeper seats this league's lineup itself — there is no gap to report. */
  best_ball: boolean;
  /**
   * The league's own settings blob, for the roster census — `reserve_slots` and
   * `taxi_slots` live here, and some leagues express them only here where
   * others express them only as `IR`/`TAXI` entries in `roster_positions`.
   */
  settings: Record<string, unknown> | null;
  roster_id: number;
  starters: string[] | null;
  players: string[] | null;
  /**
   * The *live* roster's own three arrays, padding included, for the census —
   * see the contract's `roster_count`. They are deliberately not the
   * week's: Sleeper stores no historical `reserve` or `taxi`, so the census is
   * a question about now and is read from the row that answers it.
   */
  roster_players: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  /**
   * Which lineup `starters` actually is.
   *
   * `"week"` is the `matchups` row for the week asked about — the lineup that
   * was really set then. `"current"` is the roster's live `starters`, which is
   * the same array for the week being played and a *different week's lineup*
   * for every other week the stepper walks. The caller says which, so a reader
   * is never shown today's lineup under another week's heading.
   */
  as_of: "week" | "current";
  /**
   * Who they play this week, and what that roster is starting — or null where
   * the week has no scheduled opponent for them.
   *
   * **Null covers three real states and none of them is a bye**: a week the
   * sync has no `matchups` rows for at all (every future week, by
   * construction), a week Sleeper filed without a `matchup_id` (the offseason,
   * and some playoff formats), and a league whose opponent's roster is not
   * stored. All three are "no answer", which is why the plate that reads this
   * draws a dash rather than a projected win.
   */
  opponent: WeekLineupOpponent | null;
};

type ManagerWeekLineupSqlRow = Omit<
  ManagerWeekLineupRow,
  "best_ball" | "as_of" | "opponent"
> & {
  best_ball: boolean | null;
  week_starters: string[] | null;
  week_players: string[] | null;
  opponent_roster_id: number | null;
  opponent_starters: string[] | null;
  opponent_players: string[] | null;
  opponent_week_starters: string[] | null;
  opponent_week_players: string[] | null;
};

/**
 * Every league the manager fielded a team in, with their roster for one week.
 *
 * **The first read of the `matchups` table**, which the sync has been filling
 * since the league graph landed. That is the whole point of it here: Sleeper's
 * `rosters.starters` is a *live* field — whatever the manager last moved to —
 * so grading week 3 against it would grade today's lineup and label it week 3.
 * The `matchups` row records what was set that week, and a `LEFT JOIN` is what
 * lets the two be told apart rather than silently substituted: a week with no
 * stored row falls back to the live lineup and is **flagged `as_of:
 * "current"`**, because the sync only fetches weeks up to the one being played
 * and a future week has no row by construction.
 *
 * A row whose `starters` is stored but empty counts as absent, since Sleeper
 * writes an empty array for a week a league never scheduled — `COALESCE` on the
 * array alone would prefer that to a real lineup.
 *
 * Gated on {@link MANAGER_LEAGUE_SQL}, the same predicate the leagues list and
 * the lineups route use, so the tool's league set cannot drift from the list
 * the page draws beside it.
 *
 * One row per league rather than every roster in it: this tool answers for the
 * manager's own lineup, where `getManagerLeagueRosters` has to solve all twelve
 * to rank one among them.
 *
 * `leagueId` narrows to one league, for the re-read that follows a refresh
 * press. It is an extra predicate on the *same* query rather than a second
 * function, which is the whole point: the narrowed answer is merged into the
 * batched one on the client, so the two must be solved from identically
 * qualified rows. In particular {@link MANAGER_LEAGUE_SQL} still applies, so a
 * narrowed read can never answer for a league the unnarrowed one would have
 * left out.
 */
export async function getManagerWeekLineups(
  userId: string,
  season: string,
  week: number,
  leagueId?: string,
): Promise<ManagerWeekLineupRow[]> {
  const { rows } = await pool.query<ManagerWeekLineupSqlRow>(
    `SELECT l.league_id, l.total_rosters, l.roster_positions, l.scoring_settings,
            l.settings,
            (CASE WHEN l.settings->>'best_ball' ~ '^[0-9]+$'
                  THEN (l.settings->>'best_ball')::int = 1 END) AS best_ball,
            r.roster_id,
            r.starters AS starters,
            r.players  AS players,
            r.players  AS roster_players,
            r.reserve  AS reserve,
            r.taxi     AS taxi,
            m.starters AS week_starters,
            m.players  AS week_players,
            om.roster_id AS opponent_roster_id,
            oor.starters AS opponent_starters,
            oor.players  AS opponent_players,
            om.starters  AS opponent_week_starters,
            om.players   AS opponent_week_players
       FROM leagues l
       JOIN rosters r
         ON r.league_id = l.league_id AND r.owner_id = $1
       LEFT JOIN matchups m
         ON m.league_id = l.league_id AND m.roster_id = r.roster_id AND m.week = $3
       -- The other side of the same game, off the pairing index. matchup_id is
       -- nullable — Sleeper files offseason and some playoff weeks without one
       -- — and a null never equals a null, so those rows simply find no
       -- opponent rather than pairing with every unpaired roster in the league.
       LEFT JOIN matchups om
         ON om.league_id = l.league_id AND om.week = $3
        AND om.matchup_id = m.matchup_id AND om.roster_id <> r.roster_id
       LEFT JOIN rosters oor
         ON oor.league_id = l.league_id AND oor.roster_id = om.roster_id
      WHERE l.season = $2
        AND ($4::varchar IS NULL OR l.league_id = $4)
        AND ${MANAGER_LEAGUE_SQL}
      ORDER BY l.league_id`,
    [userId, season, week, leagueId ?? null],
  );

  return rows.map((row) => {
    const stored = Array.isArray(row.week_starters) && row.week_starters.length > 0;
    return {
      league_id: row.league_id,
      total_rosters: row.total_rosters,
      roster_positions: row.roster_positions,
      scoring_settings: row.scoring_settings,
      // Sleeper omits the key on every league that isn't one, so absent is a
      // real `false` here — unlike the settings a week has no zero on.
      best_ball: row.best_ball === true,
      settings: row.settings,
      roster_id: row.roster_id,
      roster_players: row.roster_players,
      reserve: row.reserve,
      taxi: row.taxi,
      starters: stored ? row.week_starters : row.starters,
      // The week's own roster where there is one: a player dropped since is
      // still who that lineup was chosen from.
      players: stored ? (row.week_players ?? row.players) : row.players,
      as_of: stored ? "week" : "current",
      opponent: toOpponent(row),
    };
  });
}

/**
 * The opponent's half of the row, read on the same rule the manager's half is.
 *
 * **A stored-but-empty `starters` counts as absent here too**, and it has to:
 * Sleeper writes an empty array for a week a league never scheduled, so a
 * bare `COALESCE` would prefer that to the live lineup and project the
 * opponent at zero — which the plate would then draw as a win.
 *
 * The opponent is dropped entirely where no roster of theirs is stored. There
 * is nothing to project, and an opponent projected from nothing is a claim.
 */
function toOpponent(row: ManagerWeekLineupSqlRow): WeekLineupOpponent | null {
  if (row.opponent_roster_id === null) return null;
  const stored =
    Array.isArray(row.opponent_week_starters) &&
    row.opponent_week_starters.length > 0;
  const starters = stored ? row.opponent_week_starters : row.opponent_starters;
  if (!starters || starters.length === 0) return null;
  return {
    roster_id: row.opponent_roster_id,
    starters,
    players: stored
      ? (row.opponent_week_players ?? row.opponent_players)
      : row.opponent_players,
  };
}

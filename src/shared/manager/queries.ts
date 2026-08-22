import { pool } from "@/shared/db";

import { BEST_BALL_SQL, DYNASTY_LEAGUE_TYPE, LEAGUE_TYPE_SQL } from "./adp";
import { ADP_FILTER_DEFAULTS } from "./adp-filters";
import type { AdpBoardType } from "./adp-filters";
import { dynastyPickGrid, ownedDraftPicks } from "./draft-picks";
import { standingScore } from "./rank";
import type { LeagueDraft, TradedPick } from "./draft-picks";
import type { ManagerSyncState } from "./sync-freshness";
import type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
  ManagerMatchup,
  MatchupOpponent,
} from "./types";

export type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
  ManagerMatchup,
  MatchupOpponent,
};

/**
 * The columns a {@link ManagerLeague} is built from, aliased `l`.
 *
 * Three reads projected this list by hand and mapped it by hand — the two here
 * and the trades board's own league list, which is the same shape for a caller
 * that has no manager. A fourth column added to the type is one edit now rather
 * than three, and the compiler cannot see the other two.
 *
 * The record is deliberately **not** in it: it comes off a join to the manager's
 * own roster, and only one of the three callers has a manager to join to.
 */
export const LEAGUE_COLUMNS_SQL = `
  l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
  l.settings, l.roster_positions, l.scoring_settings`;

/** One row of {@link LEAGUE_COLUMNS_SQL}. */
export type LeagueRow = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  settings: Record<string, unknown> | null;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
};

/**
 * A {@link LeagueRow} as the league shape every reader of these routes holds.
 *
 * `record` is a separate argument rather than a column of the row, because it is
 * a *manager's* record in a league and two of the three callers are asking about
 * leagues with no manager in the question — see {@link getLeaguesByIds}.
 */
export function toManagerLeague(
  r: LeagueRow,
  record: ManagerLeague["record"] = null,
): ManagerLeague {
  return {
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    avatar: r.avatar,
    record,
    settings: r.settings,
    roster_positions: r.roster_positions,
    scoring_settings: r.scoring_settings,
  };
}

type Row = LeagueRow & {
  wins: string | null;
  losses: string | null;
  ties: string | null;
};

/**
 * Both of this manager+season's sync timestamps, or null if it has never been
 * tried at all.
 *
 * It used to be `getManagerSyncedAt`, one column, and that was the whole of the
 * bug {@link managerSyncGate} exists to fix: the caller could ask "when did we
 * last try" or "when was this last complete" but got one answer to both. The
 * two columns have always been in the table — see {@link ManagerSyncState} for
 * what each means — and every reader now says which of them it is asking about.
 *
 * A row with `attempt_at` and a null `synced_at` is a real state and not a
 * half-written one: a manager the crawler has enumerated but never fully synced,
 * or one whose every sync so far has left leagues behind.
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
 * Sleeper's `settings.type` for a **chopped** league — its native guillotine
 * format, where the week's low scorer is eliminated and their players go back
 * into the pool. It sits alongside 0 redraft, 1 keeper and 2 dynasty; the
 * client's own type filter spells the same code (`features/shared/league-filters`).
 */
const CHOPPED_LEAGUE_TYPE = 3;

/**
 * Whether the league is a chopped one, read off its settings blob.
 *
 * Composed from `LEAGUE_TYPE_SQL` the way `DYNASTY_BOARD_SQL` is in `./adp` —
 * the guard, the cast and the redraft fallback are that fragment's, so a change
 * to how a type is read reaches the chopped test too rather than leaving it on
 * an older spelling while five reads gate on it.
 *
 * Parenthesised as a whole because it ends in a comparison and is interpolated
 * into a larger boolean.
 */
const CHOPPED_LEAGUE_SQL = `(${LEAGUE_TYPE_SQL} = ${CHOPPED_LEAGUE_TYPE})`;

/**
 * Whether the league plays every team against the week's median score as well as
 * against its scheduled opponent — Sleeper's `league_average_match`.
 *
 * A second result per week, so a league carrying it is one league and two games:
 * the lineup checker's ledge prints both marks and its plate counts both. It is
 * read here rather than derived on the client because nothing the client holds
 * can answer it — the median is the *whole league's* scores for the week, which
 * is a solve per team rather than the two in the matchup, and only a read that
 * knows the setting can decide to pay for it.
 *
 * Guarded, cast and defaulted exactly as {@link BEST_BALL_SQL} is, for the
 * reason that fragment gives: Sleeper omits what a league doesn't set, so absent
 * or unparseable is *off* — the answer that costs nothing and claims nothing,
 * where reading it as on would put a median result on every league in the app.
 *
 * Interpolated, so a call site must alias `leagues` as `l`. Parenthesised as a
 * whole because it ends in a comparison.
 */
const MEDIAN_MATCH_SQL = `
  (CASE WHEN l.settings->>'league_average_match' ~ '^[0-9]+$'
        THEN (l.settings->>'league_average_match')::int ELSE 0 END = 1)`;

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
/**
 * True where Sleeper still serves the league.
 *
 * `gone_at` is the tombstone for a league Sleeper answers 200-with-null for —
 * one somebody deleted. The row and its children stay on purpose: the drafts
 * under it still feed `/api/adp` and its completed trades are still market
 * history, which is why a deletion is *marked* rather than cascaded away.
 *
 * **What the marker never did was stop anybody reading it.** It gated the
 * crawler's queue and nothing else, so a deleted league kept every row that
 * puts it on screen — `league_users` and `rosters` are only ever replaced by a
 * sync of the league itself, and a tombstoned league is never synced again, so
 * those rows are frozen rather than cleared. The league stayed in the leagues
 * list, in the share denominators and in the leaguemate counts indefinitely,
 * and pressing its refresh key answered "League gone" while leaving it exactly
 * where it was.
 *
 * So it is applied at every read that answers *this manager's leagues*, on
 * {@link FIELDED_A_TEAM_SQL}'s rule and for its reason: a league hidden from
 * the list but still counted in a share is a denominator describing rows nobody
 * renders. Reads with no manager in the question keep the whole corpus — the
 * ADP board and the trades market are what the row was kept for.
 *
 * Interpolated, so a call site must alias `leagues` as `l`.
 */
const LIVE_LEAGUE_SQL = `l.gone_at IS NULL`;

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
 * The two facts every manager-scoped league read needs: Sleeper still serves
 * the league, and the manager fielded a team in it.
 *
 * One fragment rather than two spelled out per call site, which is
 * {@link FIELDED_A_TEAM_SQL}'s own argument carried one step further — the
 * reads behind the cards disagreeing with the leagues route about *which*
 * leagues those are is work done for rows nobody renders, and a read that
 * applied one half and not the other would be exactly that. The two reads that
 * cannot take it whole take {@link LIVE_LEAGUE_SQL} alone, for the reason given
 * on each: they join `rosters.owner_id`, which is this predicate's first half.
 *
 * Interpolated, so a call site must alias `leagues` as `l` and bind the
 * manager's user id as `$1`.
 */
const MANAGER_LEAGUE_SQL = `${LIVE_LEAGUE_SQL} AND ${FIELDED_A_TEAM_SQL}`;

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
    `SELECT ${LEAGUE_COLUMNS_SQL},
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

  return rows.map((r) =>
    toManagerLeague(
      r,
      r.wins == null && r.losses == null && r.ties == null
        ? null
        : {
            wins: Number(r.wins ?? 0),
            losses: Number(r.losses ?? 0),
            ties: Number(r.ties ?? 0),
          },
    ),
  );
}

/**
 * Leagues still on this manager's list that Sleeper's enumeration did not
 * mention — the candidates for a tombstone, oldest attempt first.
 *
 * **The enumeration is the fast signal that a league is gone, and nothing used
 * to read it.** `syncManagerLeagues` asks Sleeper which leagues this manager is
 * in and then only ever writes the ones it got back, so a league that dropped
 * out of that answer was left exactly as it was: it kept its stored rosters and
 * members, kept passing {@link MANAGER_LEAGUE_SQL}, and stayed on the page until
 * the crawler's refresh rotation happened to claim it — a whole TTL later at
 * best, and never at all on a deployment running no background jobs.
 *
 * **Absent from the list is not deleted, though, which is why this returns
 * candidates rather than an answer.** Sleeper drops a manager from their own
 * enumeration when they *leave* a league too, and that league is alive and full
 * of other people — tombstoning it would hide it from every one of them and
 * pull it out of the crawl. Only `getLeague` can tell the two apart, so the
 * caller probes each of these and tombstones the nulls; the departures resolve
 * themselves on their own, since the next sync of one replaces its rosters
 * without the manager's and {@link FIELDED_A_TEAM_SQL} stops matching.
 *
 * That is also what the bound is for. A departure stays a candidate until its
 * league is next crawled, so an unbounded probe would re-ask Sleeper about every
 * league a manager ever left, on every sync, forever. Capped and ordered on
 * `sync_attempt_at` — the crawler's own "staying eager and holding the head of
 * the queue are the same fact" rule — so the caller's stamp rotates a probed
 * league to the back of its own queue and a backlog is walked rather than
 * re-walked.
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
 * Just the ids of the leagues {@link getManagerLeagues} would list.
 *
 * The same population and the same {@link FIELDED_A_TEAM_SQL} predicate, without
 * the settings blobs, the record join or the ordering — the caller is the trades
 * board's "my leagues" scope, which puts these ids into a `WHERE` and never
 * renders one. Reading the full shape for that would carry a hundred-odd
 * `scoring_settings` blobs across a request that discards all of them.
 *
 * It is a query here rather than a set the trades module derives for itself
 * because *which leagues are a manager's* is this module's fact: a second
 * definition would be free to disagree with the leagues route about, say, a
 * chopped league someone was knocked out of.
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
 * The id half of {@link getManagerLeaguemates}, and it keeps that function's two
 * opposing rules intact: *which leagues* count is {@link FIELDED_A_TEAM_SQL},
 * and *who counts inside one* is bare membership — someone knocked out of a
 * guillotine league is still someone you know.
 *
 * **The manager themselves is not among them**, which is where this parts
 * company with {@link getManagerLeaguemates}: that one keeps its own row so its
 * caller can tell "shared with nobody" from "not cached", and here the id list
 * *is* the answer, so a manager listed as their own leaguemate would be a claim
 * rather than a sentinel. A caller that wants the reader in the set says so —
 * `shared/trades/circle` does, for one of its two circles and not the other.
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

  const { rows } = await pool.query<LeagueRow>(
    `SELECT ${LEAGUE_COLUMNS_SQL}
     FROM leagues l
     WHERE l.league_id = ANY($1::varchar[])
     ORDER BY l.name`,
    [[...leagueIds]],
  );

  return rows.map((r) => toManagerLeague(r));
}

/**
 * Every league with a draft this board could average, for one season — or for
 * every season on file when `seasons` is null.
 *
 * **The board's league rules are a browser-side engine and this is what they run
 * over.** They are slot-group, scoring-key and size rules over Sleeper's JSONB
 * blobs, derived from the solver's own slot tables so a new flex counts the
 * moment the solver learns it; re-implementing that in SQL is the second copy
 * that drifts silently, and the symptom would be a filter quietly returning the
 * wrong leagues rather than an error. So the rules stay in one place, the client
 * evaluates them over this, and sends the resulting ids back as
 * `league_id`/`xleague_id`. The trades board's own league list exists for
 * exactly this reason; the populations differ (a trade there, a draft here), so
 * the two are two reads rather than one.
 *
 * **Narrowed by the season and by nothing else the drawer can change**, which is
 * the density strip's rule for the same reason: this is what the dialog's
 * per-option counts are taken over, and a population that reshaped under the
 * hand choosing the filters is worse than one that holds still. The season is
 * not one of those — it is the board's population rather than one of its
 * filters, the same split the strip draws. The consequence worth knowing is that
 * a league whose only draft in the season is a rookie draft is counted here even
 * with the board cut to startups: the dialog describes the season's corpus, and
 * the draft count in the drawer's own header is what describes the board.
 *
 * The two constants are the board's own: a draft that is neither snake nor
 * linear has no draft position to average (an auction's `pick_no` is nomination
 * order), and an unfinished one is never counted into an average whatever else
 * is selected.
 */
export async function getAdpLeagues(
  seasons: readonly string[] | null,
): Promise<ManagerLeague[]> {
  const params: unknown[] = [
    [...ADP_FILTER_DEFAULTS.draft_types],
    [...ADP_FILTER_DEFAULTS.draft_statuses],
  ];
  const seasonClause = seasons
    ? `AND d.season = ANY($${params.push([...seasons])}::varchar[])`
    : "";

  const { rows } = await pool.query<LeagueRow>(
    `SELECT ${LEAGUE_COLUMNS_SQL}
       FROM leagues l
      WHERE EXISTS (
              SELECT 1
                FROM drafts d
               WHERE d.league_id = l.league_id
                 AND d.type = ANY($1::varchar[])
                 AND d.status = ANY($2::varchar[])
                 ${seasonClause}
            )
      ORDER BY l.name`,
    params,
  );

  // `record` is null on every row and that is the answer rather than a gap: a
  // record is a *manager's* in a league, and this read deliberately has no
  // manager in the question — the same call `getSeasonTradeLeagues` makes.
  return rows.map((r) => toManagerLeague(r));
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
 * It needs no {@link FIELDED_A_TEAM_SQL} — it joins `owner_id`, which is that
 * predicate's first half — but it does take {@link LIVE_LEAGUE_SQL}, which the
 * join cannot stand in for: a deleted league's `rosters` rows are frozen, not
 * cleared, so the manager holds a roster there forever and every player on it
 * would keep counting toward their shares.
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
      WHERE r.owner_id = $1 AND l.season = $2
        AND ${LIVE_LEAGUE_SQL}`,
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
 * Who the manager plays in each of their leagues in one week — the lineup
 * checker's list, read from what the crawler has stored and nothing else.
 *
 * **The two sides are the same table read twice.** Sleeper returns a *side* per
 * roster rather than a game, so the opponent is the other row sharing this one's
 * `matchup_id`, and the join is `LEFT` because that pairing legitimately fails:
 * a null `matchup_id` never equals anything, which is exactly how a bye or an
 * unscheduled week arrives. That case comes back as a row with a null
 * `opponent`, where a league whose week isn't stored comes back as no row at all
 * — see {@link ManagerMatchup} for why those must not collapse into one answer.
 *
 * It needs no {@link FIELDED_A_TEAM_SQL}, for {@link getManagerRosters}' reason:
 * it joins on `owner_id`, which is that predicate's first half. A manager who
 * left a league holds no roster there and so has no side of its games. It takes
 * {@link LIVE_LEAGUE_SQL} for that read's reason too — a deleted league keeps
 * its stored rosters and matchups, so the lineup checker would go on pairing
 * the manager against an opponent in a league nobody can open.
 *
 * The opponent's name is resolved through the roster's owner rather than carried
 * on the matchup, because the matchup knows only roster ids — and an orphan team
 * resolves to a roster with no manager, which is a team you still play.
 */
export async function getManagerMatchups(
  userId: string,
  season: string,
  week: number,
): Promise<ManagerMatchup[]> {
  const { rows } = await pool.query<{
    league_id: string;
    roster_id: number;
    opponent_roster_id: number | null;
    opponent_owner_id: string | null;
    opponent_display_name: string | null;
    opponent_team_name: string | null;
    opponent_avatar: string | null;
  }>(
    `SELECT m.league_id,
            m.roster_id,
            o.roster_id     AS opponent_roster_id,
            opp.owner_id    AS opponent_owner_id,
            lu.display_name AS opponent_display_name,
            lu.team_name    AS opponent_team_name,
            lu.avatar       AS opponent_avatar
       FROM rosters r
       JOIN leagues l ON l.league_id = r.league_id
       JOIN matchups m
         ON m.league_id = r.league_id AND m.roster_id = r.roster_id AND m.week = $3
       LEFT JOIN matchups o
         ON o.league_id = m.league_id AND o.week = m.week
        AND o.matchup_id = m.matchup_id AND o.roster_id <> m.roster_id
       LEFT JOIN rosters opp
         ON opp.league_id = o.league_id AND opp.roster_id = o.roster_id
       LEFT JOIN league_users lu
         ON lu.league_id = opp.league_id AND lu.user_id = opp.owner_id
      WHERE r.owner_id = $1 AND l.season = $2
        AND ${LIVE_LEAGUE_SQL}`,
    [userId, season, week],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    roster_id: r.roster_id,
    opponent:
      r.opponent_roster_id === null
        ? null
        : ({
            roster_id: r.opponent_roster_id,
            owner_id: r.opponent_owner_id,
            display_name: r.opponent_display_name,
            team_name: r.opponent_team_name,
            avatar: r.opponent_avatar,
          } satisfies MatchupOpponent),
  }));
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
        AND ${MANAGER_LEAGUE_SQL}
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
    best_ball: boolean;
    median_match: boolean;
  }>(
    // Best ball through the same guarded fragment `/api/adp` filters on, so the
    // lineup solve and the board can't disagree about which leagues are one.
    `SELECT l.league_id, l.roster_positions, l.scoring_settings,
            ${BEST_BALL_SQL} AS best_ball,
            ${MEDIAN_MATCH_SQL} AS median_match
       FROM leagues l
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      WHERE l.season = $2
        AND ${MANAGER_LEAGUE_SQL}`,
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
        best_ball: l.best_ball,
        median_match: l.median_match,
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
      record: foldRecord(s),
      fpts: foldPoints(s.fpts, s.fpts_decimal),
    });
  }

  return [...byLeague.values()];
}

/**
 * The ADP board each league reads — dynasty for Sleeper `settings.type` 2,
 * redraft for everything else, keeper included (see `ADP_BOARDS` for why) —
 * keyed by league id. Regex-guarded before the cast because the settings blob
 * is loosely typed and omits its default, so an absent or junk value reads
 * redraft, matching the `/api/adp` `LEAGUE_TYPE_SQL` and the client filters.
 *
 * Kept out of {@link LeagueRosterSet} because only the ADP-value board needs it:
 * everything else projects a league without caring how it keeps players between
 * seasons.
 */
export async function getLeagueAdpBoards(
  leagueIds: readonly string[],
): Promise<Map<string, AdpBoardType>> {
  if (leagueIds.length === 0) return new Map();

  const { rows } = await pool.query<{ league_id: string; type_code: number }>(
    `SELECT league_id, ${LEAGUE_TYPE_SQL} AS type_code
       FROM leagues l
      WHERE league_id = ANY($1::varchar[])`,
    [[...leagueIds]],
  );

  const byLeague = new Map<string, AdpBoardType>();
  for (const r of rows) byLeague.set(r.league_id, adpBoardTypeOf(r.type_code));
  return byLeague;
}

/**
 * Which of the two ADP markets a `LEAGUE_TYPE_SQL` code reads — dynasty for
 * Sleeper's `settings.type` 2, redraft for everything else, keeper included.
 *
 * One line, and it exists so that a caller who *already holds* the code does not
 * have to re-read `leagues` to learn the same thing. {@link getLeagueDetail}
 * carries it now ({@link LeagueDetail.league_type}), so the league panel's value
 * columns resolve their board from the read they had already made rather than
 * from a second query for one row — which is the same league answering the same
 * question twice, a few milliseconds apart, over the same connection pool.
 *
 * Both readings go through here rather than one spelling the comparison out, for
 * the reason `BEST_BALL_SQL` is shared: a board and a panel that disagree about
 * whether a league is dynasty is a wrong number rather than an error.
 */
export function adpBoardTypeOf(typeCode: number): AdpBoardType {
  return typeCode === DYNASTY_LEAGUE_TYPE ? "dynasty" : "redraft";
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
 * A team's record out of a roster's `settings` blob.
 *
 * Zero-filled per field, which is the right reading *here* and not everywhere:
 * this is a roster that exists, so an absent `wins` is a season not yet played
 * rather than a league nobody fielded a team in. The null-record distinction
 * lives one level up, in {@link getManagerLeagues}, where the roster itself can
 * be missing.
 */
function foldRecord(settings: Record<string, unknown>): {
  wins: number;
  losses: number;
  ties: number;
} {
  return {
    wins: Number(settings.wins ?? 0),
    losses: Number(settings.losses ?? 0),
    ties: Number(settings.ties ?? 0),
  };
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
    settings: Record<string, unknown> | null;
    league_type: number;
    best_ball: boolean;
    median_match: boolean;
    previous_league_id: string | null;
  }>(
    // Both the type and the format are read through the same guarded fragments
    // `/api/adp` groups and filters leagues by, so "is this a dynasty league"
    // and "is this best ball" have one answer across the app. The median is the
    // third of them, through the fragment the lineup checker's own read uses.
    `SELECT league_id, name, season, status, roster_positions, scoring_settings,
            settings,
            ${LEAGUE_TYPE_SQL} AS league_type, ${BEST_BALL_SQL} AS best_ball,
            ${MEDIAN_MATCH_SQL} AS median_match,
            previous_league_id
       FROM leagues l WHERE league_id = $1`,
    [leagueId],
  );
  if (league.rows.length === 0) return null;
  const l = league.rows[0];

  // The rosters, the traded picks and the league's own drafts are independent
  // reads over the same league, so they go together; the picks are resolved into
  // per-roster portfolios below.
  const [{ rows }, { rows: tradedRows }, { rows: draftRows }] =
    await Promise.all([
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
      pool.query<LeagueDraft>(
        // Two casts, for the two reasons this file already casts. `start_time` is
        // a BIGINT, which `pg` hands back as a string, so it is a number by the
        // time it leaves the query — epoch milliseconds sit well inside float64's
        // exact range, which is why `/api/adp`'s density read spells it the same
        // way. And `rounds` is regex-guarded before its cast like every other
        // numeric read off a Sleeper blob: one league holding junk there must not
        // fail the whole panel, and unparseable reads as "depth unknown" rather
        // than as zero rounds.
        `SELECT draft_id, season, status, start_time::float8 AS start_time,
                CASE WHEN settings->>'rounds' ~ '^[0-9]+$'
                     THEN (settings->>'rounds')::int END AS rounds
           FROM drafts WHERE league_id = $1`,
        [leagueId],
      ),
    ]);

  // A dynasty league's pick market runs a fixed horizon of future drafts, so its
  // grid is resolved from the league's own drafts rather than derived from
  // whatever has been traded. Every other format keeps the derived grid: there
  // is no standing horizon to read, and a redraft league has no future picks at
  // all.
  const picksByRoster = ownedDraftPicks(
    tradedRows,
    rows.map((r) => r.roster_id),
    l.season,
    l.league_type === DYNASTY_LEAGUE_TYPE
      ? dynastyPickGrid(l.season, draftRows, l.previous_league_id)
      : null,
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
      record: foldRecord(s),
      fpts: foldPoints(s.fpts, s.fpts_decimal),
      fpts_against: foldPoints(s.fpts_against, s.fpts_against_decimal),
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      picks: picksByRoster.get(r.roster_id) ?? [],
    };
  });

  // Standings order, through the one ranking rule rather than a second
  // spelling of it: `standingScore` names this order as the thing it must
  // agree with (the ranks route folds the same two numbers), and a tie rule
  // changed there has to reach the panel's rows too — `orderByProjectedPoints`
  // leans on this order as its stable tiebreak.
  teams.sort(
    (a, b) =>
      standingScore(b.record.wins, b.fpts) - standingScore(a.record.wins, a.fpts),
  );

  return {
    league_id: l.league_id,
    name: l.name,
    season: l.season,
    status: l.status,
    roster_positions: l.roster_positions,
    scoring_settings: l.scoring_settings,
    settings: l.settings,
    best_ball: l.best_ball,
    median_match: l.median_match,
    // Already selected for the pick grid above, and carried out rather than
    // dropped: it is what the values read needs to pick an ADP market, and
    // buying it there cost a second query for a league already in hand.
    league_type: l.league_type,
    teams,
  };
}

/** One roster's scored week, as the league itself recorded it. */
export type RosterWeekPoints = {
  roster_id: number;
  week: number;
  points: number | null;
};

/**
 * What each roster in a league actually scored, over a set of weeks.
 *
 * Read from `matchups` rather than summed from stat lines, which is `teamPpg`'s
 * own argument in query form: the league already applied its scoring *and* the
 * lineup the manager actually set when it recorded the week, so this is the one
 * number that needs neither re-scoring nor a solve. Summing a roster's players
 * would answer a different question — what everyone on the roster scored,
 * including the three the manager benched.
 *
 * `points` is nullable because Sleeper stores a matchup row before the week is
 * played; the average drops those rather than counting a shutout.
 */
export async function listRosterWeekPoints({
  leagueId,
  weeks,
}: {
  leagueId: string;
  weeks: number[];
}): Promise<RosterWeekPoints[]> {
  if (weeks.length === 0) return [];

  const { rows } = await pool.query<RosterWeekPoints>(
    `SELECT roster_id, week, points
       FROM matchups
      WHERE league_id = $1 AND week = ANY($2::int[])`,
    [leagueId, weeks],
  );
  return rows;
}

/**
 * What each *manager* in this league's predecessor scored last season, keyed by
 * the owner rather than by a roster id.
 *
 * The season rollover is why this exists: Sleeper mints a new league id every
 * year and links it back through `previous_league_id`, and roster ids are
 * re-issued rather than following anybody. So carrying "what did this team
 * average" across the boundary means joining on the owner, which is the only id
 * that survives it.
 *
 * It is the team-level half of the week-1 fallback — a points-per-game average
 * counts the weeks *before* the one on screen, so in week 1 there are none and
 * last season is the honest stand-in.
 *
 * An empty map is the answer for an inaugural league and for one whose previous
 * season was never crawled. Both are honest absences and the panel draws an em
 * dash for them, rather than a number from nowhere.
 */
export async function getPreviousLeagueScores(
  leagueId: string,
): Promise<Map<string, RosterWeekPoints[]>> {
  const { rows } = await pool.query<{ previous_league_id: string | null }>(
    `SELECT previous_league_id FROM leagues WHERE league_id = $1`,
    [leagueId],
  );
  const previous = rows[0]?.previous_league_id;
  // Sleeper spells "no predecessor" both ways, the same pair the crawler's own
  // startup-draft test folds together.
  if (!previous || previous === "0") return new Map();

  const { rows: scored } = await pool.query<
    RosterWeekPoints & { owner_id: string | null }
  >(
    `SELECT r.owner_id, m.roster_id, m.week, m.points
       FROM matchups m
       JOIN rosters r
         ON r.league_id = m.league_id AND r.roster_id = m.roster_id
      WHERE m.league_id = $1 AND r.owner_id IS NOT NULL`,
    [previous],
  );

  const byOwner = new Map<string, RosterWeekPoints[]>();
  for (const row of scored) {
    if (!row.owner_id) continue;
    let weeks = byOwner.get(row.owner_id);
    if (!weeks) byOwner.set(row.owner_id, (weeks = []));
    weeks.push({ roster_id: row.roster_id, week: row.week, points: row.points });
  }
  return byOwner;
}

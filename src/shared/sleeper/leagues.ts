import { sleeperGet, sleeperGetOptional, sleeperUrl } from "./client";
import { freshUrl } from "./fresh";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
} from "./types/sleeper.types";

/**
 * Leagues a user belongs to in a given season.
 *
 * `season` is required, with no default: the only two honest answers are the
 * caller's own `?season=` and `getActiveSeason()`, and a default here would be
 * a third — a release note compiled into a signature. See CLAUDE.md on
 * `DEFAULT_SEASON`, which is why `state.ts` keeps that constant to itself.
 *
 * No `fresh` parameter, unlike the league reads below: the enumeration is the
 * manager sync's and the crawler's, and neither is a reader pressing a key.
 */
export function getUserLeagues(
  userId: string,
  season: string,
): Promise<SleeperLeague[]> {
  return sleeperGet(sleeperUrl("user", userId, "leagues", "nfl", season), []);
}

/**
 * A single league by id, or null when Sleeper has no such league (deleted, or
 * never existed).
 *
 * Usually that is 200 with a null body — Sleeper's convention — but this
 * endpoint does also answer 404 for some ids, so both are folded into the same
 * null, the way `getSleeperUser` folds them. The distinction is one callers
 * cannot act on: the crawler tombstones on this answer, and a 404 that threw
 * instead left the league due forever, burning a claim slot and a Sleeper
 * request on every rotation.
 */
export function getLeague(
  leagueId: string,
  fresh?: string,
): Promise<SleeperLeague | null> {
  return sleeperGetOptional<SleeperLeague | null>(
    freshUrl(sleeperUrl("league", leagueId), fresh),
    null,
  );
}

/**
 * A league's child collections, every one of them folding a 404 into its empty
 * fallback — {@link sleeperGetOptional} rather than {@link sleeperGet}.
 *
 * **The asymmetry this closes wedged TheLabX's crawler.** `getLeague` folded
 * 404 and these seven did not, so a league whose own endpoint answered 200
 * while one child 404'd could never sync and could never be tombstoned either:
 * the retire-a-dead-league mechanism asks the *league* endpoint, and that
 * endpoint said the league was alive.
 *
 * Folding is no more exposure than the 200-with-null fold these already
 * carried, because it produces the identical value and `persistLeagueGraph`
 * judges the *payload* rather than the transport: users and rosters cannot
 * legitimately be empty for a live league, so an empty one refuses the delete
 * and says so, while traded picks, transactions and matchups empty
 * legitimately and are replaced.
 *
 * **Each takes an optional `fresh` token as its last argument**, for the one
 * path a *reader* drives: the per-league refresh press, which is asking
 * precisely because something changed a moment ago and for which a CDN copy is
 * the whole problem (see `./fresh`). It is last and optional because every
 * other caller — the manager sync, the crawler — wants the cached copy and
 * passes nothing, and `freshUrl` hands an untokened URL straight back.
 */

/** All rosters (teams) in a league. */
export function getLeagueRosters(
  leagueId: string,
  fresh?: string,
): Promise<SleeperRoster[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "rosters"), fresh),
    [],
  );
}

/** All members of a league. */
export function getLeagueUsers(
  leagueId: string,
  fresh?: string,
): Promise<SleeperLeagueUser[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "users"), fresh),
    [],
  );
}

/** Traded future draft-pick assets in a league. */
export function getLeagueTradedPicks(
  leagueId: string,
  fresh?: string,
): Promise<SleeperTradedPick[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "traded_picks"), fresh),
    [],
  );
}

/** Drafts belonging to a league (usually one). */
export function getLeagueDrafts(
  leagueId: string,
  fresh?: string,
): Promise<SleeperDraft[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "drafts"), fresh),
    [],
  );
}

/**
 * Every pick made in a draft.
 *
 * The likeliest of these to answer 404 rather than a null body, because it is
 * the one whose id comes out of *another* payload: a draft Sleeper still lists
 * under `league/<id>/drafts` but no longer serves picks for takes the league's
 * whole graph down with it otherwise. An empty answer clears nothing — picks
 * are replaced only for the drafts that returned some.
 */
export function getDraftPicks(
  draftId: string,
  fresh?: string,
): Promise<SleeperDraftPick[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("draft", draftId, "picks"), fresh),
    [],
  );
}

/**
 * Roster moves (waivers, free agents, trades, commissioner) for a single week.
 * Sleeper has no "all transactions" endpoint — they are keyed by week, so a full
 * league history is the union of each week. Offseason activity lives at week 1.
 */
export function getLeagueTransactions(
  leagueId: string,
  week: number,
  fresh?: string,
): Promise<SleeperTransaction[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "transactions", week), fresh),
    [],
  );
}

/**
 * Every roster's scoring for a single week — one entry per roster, not per game
 * (see {@link SleeperMatchup}). Keyed by week for the same reason transactions
 * are, with no all-at-once endpoint, so a season is the union of each week.
 *
 * A week the league has not scheduled answers with either nothing or a row per
 * roster carrying a null `matchup_id` — the offseason reads one of those two
 * ways. Neither is filtered here: an empty week simply writes no rows, and the
 * unscheduled rows are stored as sent, so the table mirrors Sleeper rather than
 * this code's guess about which it will be.
 */
export function getLeagueMatchups(
  leagueId: string,
  week: number,
  fresh?: string,
): Promise<SleeperMatchup[]> {
  return sleeperGetOptional(
    freshUrl(sleeperUrl("league", leagueId, "matchups", week), fresh),
    [],
  );
}

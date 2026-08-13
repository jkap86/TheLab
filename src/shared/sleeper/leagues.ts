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
} from "./types";

/** NFL season this app pulls league data for. */
export const DEFAULT_SEASON = "2026";

/** Leagues a user belongs to in a given season. */
export function getUserLeagues(
  userId: string,
  season: string = DEFAULT_SEASON,
): Promise<SleeperLeague[]> {
  return sleeperGet(sleeperUrl("user", userId, "leagues", "nfl", season), []);
}

/**
 * A single league by id, or null when Sleeper has no such league (deleted, or
 * never existed).
 *
 * Usually that is 200 with a null body — Sleeper's convention — but this
 * endpoint does also answer 404 for some ids, so both are folded into the same
 * null, the way `getSleeperUser` folds them. The distinction is one
 * callers cannot act on and the crawler must not: it tombstones on this answer,
 * and a 404 that threw instead left the league due forever, burning a claim slot
 * and a Sleeper request on every rotation.
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
 * **The asymmetry this closes wedged the crawler.** `getLeague` folded 404 and
 * these seven did not, so a league whose own endpoint answered 200 while one
 * child 404'd could never sync and could never be tombstoned either: the
 * crawler's whole retire-a-dead-league mechanism asks the *league* endpoint, and
 * that endpoint said the league was alive. In the discovery pass that is not
 * merely a league lost. A first sync that fails holds its managers unstamped so
 * the league is not forgotten, and `pendingManagers` orders unstamped managers
 * first — so the same managers came back to the head of the queue every tick,
 * the same leagues were re-fetched, and discovery stopped finding anything for
 * anyone while the corpus stood still.
 *
 * Folding is no more exposure than the 200-with-null fold these already carried,
 * because it produces the identical value and `persistLeagueGraph` judges the
 * *payload* rather than the transport: users and rosters cannot legitimately be
 * empty for a live league, so an empty one refuses the delete and says so, while
 * traded picks, transactions and matchups empty legitimately and are replaced.
 * What changes is only that the two spellings of "no such thing" now reach that
 * judgement the same way instead of one of them failing the league outright.
 *
 * **Each of them takes an optional `fresh` token**, and every one of this app's
 * scheduled callers passes none — see {@link freshUrl}. It is threaded rather
 * than switched on globally because the two kinds of caller want opposite
 * things: the crawler's promise is a fifteen-minute TTL, so an edge copy is
 * inside its own error bars and costs Sleeper's origin nothing, while the one
 * path a *reader* drives is asking precisely because something changed a moment
 * ago. An argument each is verbose and is what keeps that difference visible at
 * the call site rather than hidden in a client.
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
 * whole graph down with it otherwise. An empty answer clears nothing — picks are
 * replaced only for the drafts that returned some.
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

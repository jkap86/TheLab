import type {
  LeagueRosterEntry,
  ManagerLeague,
  PlayerSummary,
} from "@/shared/contract";

// **Relative, with the extension**, not through the `features/shared` barrel:
// the rules below are the kind that is silent when wrong, so they are unit
// tested — and Node's own runner resolves the file it is given and knows
// nothing of the `@/*` aliases. It is the exception `shares-columns.ts` and
// `helpers/seat-compare.ts` already take, for the same reason. The barrel would
// also drag every drawer in this folder reads into a pure module.
import { leaguematePlayerId } from "../../shared/league-subjects.ts";

/**
 * What everybody else in a manager's leagues holds, folded three ways.
 *
 * The third shares fold, beside `shares.ts` and `leaguemates.ts` and on their
 * population rule exactly: **the caller hands it the league-filtered,
 * subject-unnarrowed list**, because the manager page narrows five ways and a
 * count taken over anything but the leagues in front of the reader answers a
 * different question. Counted over the selection instead, every figure would
 * collapse to the pick that produced it.
 *
 * Everything here is pure and everything here is silent when wrong: a league
 * with no stored rosters counted as one where nobody holds a player, an orphan
 * team read as a leaguemate, or a denominator taken off the leagues on screen
 * rather than the leagues that answered — none of the three draws anything but
 * an ordinary number.
 */

/**
 * Sleeper pads roster slots with an empty string and with `"0"`. Neither is a
 * player, and counting them would put one phantom row at the top of every
 * board — held, by construction, on every roster.
 */
function isPlayerId(id: string): boolean {
  return Boolean(id) && id !== "0";
}

// One collator for the tiebreak rather than `localeCompare` per comparison —
// `shares.ts`'s reason: the sort is thousands of them over one payload.
const NAME_ORDER = new Intl.Collator();

/** One player on one leaguemate's rosters, and how much of the shared set holds him. */
export type LeaguematePlayer = {
  player_id: string;
  /** The stored name, else the id — `PlayerShare`'s rule, a token beats a blank. */
  name: string;
  position: string | null;
  team: string | null;
  /** Leagues of the shared set where **that person** rosters him. */
  held: number;
  /** Whether the manager also rosters him somewhere in the counted set. */
  mine: boolean;
};

export type LeaguematePlayers = {
  /**
   * The denominator: leagues shared with them that **contributed a roster
   * set**, not leagues shared with them.
   *
   * A league whose rosters were never stored is skipped rather than counted as
   * one where they hold nobody, so this can legitimately read lower than the
   * `Share` cell on the row above — which counts membership, and membership is
   * stored where rosters may not be. Zeroing it would deflate every pip in the
   * rail.
   */
  league_count: number;
  /** Most-held first, ties broken by name. */
  players: LeaguematePlayer[];
};

/**
 * Which of a leaguemate's players the rail lists.
 *
 * A way of reading the board rather than a claim about it — `all` is the whole
 * roster across the shared set, `shared2` the players they hold in more than
 * one of those leagues, and `mine` the ones the manager holds somewhere too.
 */
export type RosterScope = "all" | "shared2" | "mine";

/**
 * Every player one leaguemate rosters across the leagues shared with them.
 *
 * **A roster is theirs when its `user_id` is theirs**, which is the whole join
 * and the reason the payload carries the owner rather than being keyed by one:
 * an orphan team belongs to nobody and must not be read as anybody's.
 *
 * A player is counted **once per league** however many times a roster names
 * him, and once per league across two rosters in it — a co-owned pair is one
 * league they hold him in, not two.
 */
export function leaguematePlayers(
  leagues: readonly ManagerLeague[],
  mateId: string,
  rosters: Record<string, readonly LeagueRosterEntry[]>,
  players: Record<string, PlayerSummary>,
  selfId: string | null,
  scope: RosterScope = "all",
): LeaguematePlayers {
  const held = new Map<string, number>();
  const ownedByMe = new Set<string>();
  let leagueCount = 0;

  for (const league of leagues) {
    const entries = rosters[league.league_id];
    // Absent is not empty — see `league_count`.
    if (!entries) continue;

    // Per league, so a player on two of their rosters in one league is one
    // league. The manager's own set is a separate pass over the same rows,
    // because `mine` asks about the counted set as a whole rather than about
    // the leagues shared with this person.
    const theirs = new Set<string>();
    let mateIsIn = false;
    for (const entry of entries) {
      if (entry.user_id === mateId) {
        mateIsIn = true;
        for (const id of entry.players) if (isPlayerId(id)) theirs.add(id);
      } else if (selfId != null && entry.user_id === selfId) {
        for (const id of entry.players) if (isPlayerId(id)) ownedByMe.add(id);
      }
    }

    // **The denominator is leagues this person fields a roster in**, not every
    // league whose rosters were stored: the rail is their board, and a league
    // they are a member of without holding a team contributes nothing to it
    // and must not be counted as a league where they hold nobody.
    if (!mateIsIn) continue;
    leagueCount++;
    for (const id of theirs) held.set(id, (held.get(id) ?? 0) + 1);
  }

  const out: LeaguematePlayer[] = [];
  for (const [player_id, count] of held) {
    const mine = ownedByMe.has(player_id);
    if (scope === "shared2" && count < 2) continue;
    if (scope === "mine" && !mine) continue;
    const summary = players[player_id];
    out.push({
      player_id,
      name: summary?.name ?? player_id,
      position: summary?.position ?? null,
      team: summary?.team ?? null,
      held: count,
      mine,
    });
  }

  out.sort((a, b) => b.held - a.held || NAME_ORDER.compare(a.name, b.name));
  return { league_count: leagueCount, players: out };
}

/**
 * How many of the counted leagues each of the three modes answers for one
 * player.
 *
 * **The three sum to the leagues that contributed a roster set**, never to the
 * leagues on screen — which is what makes them addable and what makes the sum
 * smaller than the panel's own league count on a partly-synced account. A
 * league nobody has stored is in none of the three, because it is not evidence
 * that a player is free there.
 *
 * `owned` is read off the same rosters the rest of the panel is: the manager's
 * own roster in that league, whoever else is in it.
 */
export type ModeCounts = { owned: number; taken: number; available: number };

export function playerModeCounts(
  leagues: readonly ManagerLeague[],
  playerId: string,
  rosters: Record<string, readonly LeagueRosterEntry[]>,
  selfId: string | null,
): ModeCounts {
  const counts: ModeCounts = { owned: 0, taken: 0, available: 0 };
  if (!isPlayerId(playerId)) return counts;

  for (const league of leagues) {
    const entries = rosters[league.league_id];
    if (!entries) continue;

    let mine = false;
    let theirs = false;
    let anyone = false;
    for (const entry of entries) {
      if (!entry.players.includes(playerId)) continue;
      anyone = true;
      // **An orphan team is nobody**, so it makes a player neither mine nor
      // taken while still holding him — which is why `available` is the
      // complement of `anyone` rather than the negation of the other two.
      if (selfId != null && entry.user_id === selfId) mine = true;
      else if (entry.user_id != null) theirs = true;
    }

    if (mine) counts.owned++;
    else if (theirs) counts.taken++;
    else if (!anyone) counts.available++;
    // The arm with no counter is a player held **only** by an orphan team: not
    // the manager's, nobody else's, and not free either. It falls out of all
    // three, which is why these sum to the leagues that answered rather than to
    // a fixed total — and why the panel prints them as three figures rather
    // than as a breakdown of one.
  }
  return counts;
}

/**
 * The two roll maps the modes narrow by: every league's rosters, and every
 * league's rosters that are not the manager's.
 *
 * **Both are built in one pass and neither creates a string**, which is what
 * makes them affordable over a payload this size — an entry is a reference to
 * an id already parsed out of the response.
 *
 * `owned` is not built here: it is `ManagerPlayersPayload.rosters`, which the
 * page already holds and which is the map the panel counted by before there
 * were three modes. Deriving a second copy of it from this payload would be two
 * spellings of one narrowing, and the one that is wrong would be the one
 * nobody was looking at.
 */
export function modeRolls(
  rosters: Record<string, readonly LeagueRosterEntry[]>,
  selfId: string | null,
): { taken: Record<string, string[]>; everyone: Record<string, string[]> } {
  const taken: Record<string, string[]> = {};
  const everyone: Record<string, string[]> = {};

  for (const [leagueId, entries] of Object.entries(rosters)) {
    const all: string[] = [];
    const others: string[] = [];
    for (const entry of entries) {
      const mine = selfId != null && entry.user_id === selfId;
      for (const id of entry.players) {
        if (!isPlayerId(id)) continue;
        all.push(id);
        // An orphan team's players are held but not *taken*: nobody is holding
        // them, which is the reading `playerModeCounts` takes one level up.
        if (!mine && entry.user_id != null) others.push(id);
      }
    }
    // Present even when empty — a league that answered with nothing rostered
    // is a league where everybody is available, and dropping the key would
    // make it read as one nobody has stored.
    everyone[leagueId] = all;
    taken[leagueId] = others;
  }
  return { taken, everyone };
}

/**
 * The combo roll: league → `user:player` for every pair its rosters name.
 *
 * **Built only while a combo is picked**, which is the caller's business and is
 * why it is a function rather than a derivation of the payload: it is the one
 * map here that mints strings, one per rostered player per league, and a reader
 * who never opens an expanded row should not pay for it.
 */
export function leaguematePlayerRolls(
  rosters: Record<string, readonly LeagueRosterEntry[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [leagueId, entries] of Object.entries(rosters)) {
    const pairs: string[] = [];
    for (const entry of entries) {
      // An orphan team names no pair: there is no person to have picked.
      if (entry.user_id == null) continue;
      for (const id of entry.players) {
        if (isPlayerId(id)) pairs.push(leaguematePlayerId(entry.user_id, id));
      }
    }
    out[leagueId] = pairs;
  }
  return out;
}

/**
 * Every player id each person in the counted leagues rosters — the search
 * index.
 *
 * One pass over the same rows the folds above walk, and it holds references
 * rather than strings of its own. Built for every person rather than per row
 * because that is what its reader asks: a typed name is matched against any
 * leaguemate's board, not against the board of a row that happens to be open.
 * It is the one derivation here that a reader who never types does not use,
 * which is why it costs a `Set` of references and nothing else.
 */
export function rosterIndex(
  leagues: readonly ManagerLeague[],
  rosters: Record<string, readonly LeagueRosterEntry[]>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const league of leagues) {
    const entries = rosters[league.league_id];
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.user_id == null) continue;
      let held = index.get(entry.user_id);
      if (!held) index.set(entry.user_id, (held = new Set()));
      for (const id of entry.players) if (isPlayerId(id)) held.add(id);
    }
  }
  return index;
}

/**
 * The search over those boards: does a person roster somebody whose name
 * contains the needle?
 *
 * **Both halves of what it reads are built on the first call, not on
 * construction.** {@link rosterIndex} is the one derivation a reader who never
 * types does not use, and the lower-cased names beside it are the same kind of
 * cost — two thousand `toLowerCase`s — so neither is paid until a needle
 * arrives. Built once per payload thereafter: the alternative, lower-casing
 * every rostered name per leaguemate per keystroke, is forty thousand of them
 * a character. The needle is the caller's to lower-case, because the drawer
 * already does that once per query.
 *
 * A closure rather than a memo inside the drawer, so the laziness is a fact
 * about this function and not about what a component may reassign during
 * render.
 */
export function rosterMatcher(
  leagues: readonly ManagerLeague[],
  rosters: Record<string, readonly LeagueRosterEntry[]>,
  players: Record<string, PlayerSummary>,
): (userId: string, needle: string) => boolean {
  let index: Map<string, Set<string>> | null = null;
  let names: Map<string, string> | null = null;
  return (userId, needle) => {
    index ??= rosterIndex(leagues, rosters);
    const held = index.get(userId);
    if (!held) return false;
    if (!names) {
      names = new Map();
      for (const [id, player] of Object.entries(players)) {
        names.set(id, player.name.toLowerCase());
      }
    }
    for (const id of held) {
      // An id with no stored name matches nothing, which is what the drawer's
      // chip already draws for it — a token rather than a searchable name.
      if (names.get(id)?.includes(needle)) return true;
    }
    return false;
  };
}

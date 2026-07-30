/**
 * Who is a candidate for a team's lineup, and whether a league can be projected
 * at all.
 *
 * These are the rules `./outlook` applied inline, once per entry point — three
 * copies of each, where nothing tested any of them. They are decisions rather
 * than plumbing: which players Sleeper will let start, and which leagues can be
 * answered for. Pure and free of runtime imports so they can be unit-tested, on
 * the same terms as `./optimal` beside them (hence the explicit `.ts`
 * extension). The matching slot-side rule is `recognisedSlots`, which lives in
 * `./optimal` with the rest of the slot vocabulary.
 */

import type { RosterPlayer } from "./optimal.ts";

/** What deciding a team's candidates needs of it: the roster. */
export type CandidateRoster = {
  players: readonly string[];
};

/** What deciding whether a league can be projected needs of it. */
export type ProjectableInput = {
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly unknown[];
};

/** The same league, with the two fields the guard proved are there. */
export type Projectable<T> = T & {
  rosterPositions: readonly string[];
  scoringSettings: Record<string, number>;
};

/**
 * Whether a league can be projected at all.
 *
 * Scoring a league with no `scoring_settings` comes back all zeroes and reads as
 * a roster of worthless players; one with no slots has no lineup to solve. Both
 * are refused rather than guessed at, so a caller gets nothing back instead of a
 * confident wrong answer.
 *
 * A type predicate because the batch callers filter on it and then need the two
 * fields: narrowing here is what keeps `!` out of the three places that used to
 * re-assert what this function had already checked.
 */
export function isProjectable<T extends ProjectableInput>(
  league: T,
): league is Projectable<T> {
  return Boolean(
    league.rosterPositions?.length &&
      league.scoringSettings &&
      league.teams.length > 0,
  );
}

/**
 * Every player id across these rosters, deduplicated — what the stat-line and
 * position reads are asked for.
 *
 * Empty ids are dropped: Sleeper pads a roster with them, and carrying one into
 * the query spends a parameter to match nothing.
 */
export function rosterPlayerIds(
  teams: readonly { players: readonly string[] }[],
): string[] {
  return [...new Set(teams.flatMap((t) => t.players))].filter(Boolean);
}

/**
 * The players eligible for this team's lineup, scored by `points`.
 *
 * Every rostered player is a candidate, IR and taxi included: this tool treats a
 * stashed player as bench depth that could be started rather than as unavailable,
 * so a strong player parked on IR or the taxi squad is ranked against the rest of
 * the bench like any other. (Sleeper itself won't seat one without a roster move
 * first, so the lineup this produces is "best available once you activate who you
 * need", not always one you can set in a single click.) `positions` is what makes
 * this a function rather than a `map` — it turns a roster into scored,
 * slot-eligible candidates — and every entry point in `./outlook` shares it so
 * they can't disagree about who is startable.
 *
 * `points` is supplied per caller because the three want different numbers off
 * the same roster — a season aggregate, a per-league score of that aggregate, or
 * nothing at all where the weekly solve re-scores every candidate itself.
 *
 * `positions` comes from the players cache rather than the projection, which
 * stores none. A player the cache doesn't know is eligible for no slot and so
 * never starts, which is better than guessing a position and recommending a
 * lineup Sleeper would reject.
 */
export function lineupCandidates(
  team: CandidateRoster,
  positions: Record<string, string[]>,
  points: (playerId: string) => number,
): RosterPlayer[] {
  return team.players
    .filter((id) => id)
    .map((id) => ({
      player_id: id,
      positions: positions[id] ?? [],
      points: points(id),
    }));
}

/**
 * The week-by-week lineup work: reshaping stored stat rows into one roster per
 * remaining week, and solving each week's own best lineup.
 *
 * The other half of `./optimal`, split by the question asked. That module
 * answers "who belongs in my starting slots from here" — one lineup ranked on
 * season-long totals. This one answers "what will this roster score", where the
 * manager is free to re-set the lineup every week, so a bye costs one week
 * rather than a slot and two backs who take turns being the better start both
 * count. The solver is imported relatively with a `.ts` extension so Node's
 * test runner can resolve the chain.
 *
 * Pure and free of runtime imports so it can be unit-tested — this used to live
 * inline in `./outlook`, which left the one rule that matters here untested:
 * a player with no projection for a week is *omitted* from that week's
 * candidates, never passed as a zero. The lineup is the same either way — a
 * zero can only fill a slot nobody else wanted — but omission is what keeps a
 * bye out of his benched-weeks count, which would otherwise make every player
 * on the roster read as a part-time starter.
 */

import { optimalLineup, round } from "./optimal.ts";
import type { PlayerWeekStats } from "./aggregate";
import type { RosterPlayer } from "./optimal";

/**
 * Score each stored row and group the results by week: week → player → points.
 *
 * The season total needs one dot product over a player's *summed* stat line
 * (see `./aggregate`), but which players start changes week to week, so the
 * weekly lineups need that sum broken back out per week. `score` is passed in
 * rather than imported so this stays dependency-free — the caller closes it
 * over the league's own scoring settings.
 */
export function groupWeeklyPoints(
  rows: readonly PlayerWeekStats[],
  score: (stats: Record<string, number> | null) => number,
): Map<number, Map<string, number>> {
  const byWeek = new Map<number, Map<string, number>>();
  for (const row of rows) {
    let week = byWeek.get(row.week);
    if (!week) byWeek.set(row.week, (week = new Map()));
    week.set(row.player_id, score(row.stats));
  }
  return byWeek;
}

/**
 * The candidates for each week's lineup solve: one roster per entry of `weeks`,
 * holding the players projected for that week at that week's points.
 *
 * A candidate absent from a week's points map is left out of that week rather
 * than included at zero — see the module comment for why that distinction is
 * load-bearing. A week with no points map at all (never synced) yields an empty
 * roster, so its lineup contributes nothing rather than being invented.
 */
export function weeklyRosters(
  candidates: readonly RosterPlayer[],
  weeks: readonly number[],
  weeklyPoints: ReadonlyMap<number, ReadonlyMap<string, number>>,
): RosterPlayer[][] {
  return weeks.map((week) => {
    const scored = weeklyPoints.get(week);
    return candidates.flatMap((player) => {
      const points = scored?.get(player.player_id);
      return points === undefined ? [] : [{ ...player, points }];
    });
  });
}

/**
 * How one player's projection divides between the weeks he makes that week's best
 * lineup and the weeks he doesn't.
 *
 * The two halves answer different questions and a single total answers neither.
 * For a starter, `bench_points` is what his slot is worth to somebody else on his
 * bye; for a bench player, `starting_points` is the only part of his projection
 * that ever reaches the lineup — a 60-point backup who is never the better start
 * is worth nothing, and a 60-point backup who is the better start three times is
 * worth exactly those three weeks.
 */
export type PlayerSplit = {
  /** Points in the weeks this player is in the best lineup. */
  starting_points: number;
  /** Points in the weeks he is projected but not started. */
  bench_points: number;
  /** Weeks he is in the best lineup. */
  starting_weeks: number;
  /** Weeks he is projected and left out of it. */
  bench_weeks: number;
};

/** Each week's best lineup, summed, and who the points belong to. */
export type WeeklyLineupSplit = {
  /**
   * A roster's projected points for the rest of the season: the sum of every
   * week's own best lineup.
   */
  points: number;
  /**
   * What those lineups leave behind: every projected point of every candidate who
   * didn't start, summed over the horizon.
   *
   * Depth, measured in the only unit that matters — a roster whose bench projects
   * high is either deep or logjammed, and either way it is carrying value it isn't
   * playing. Not a number to minimise: a bye week has to be covered by someone, so
   * zero here would mean a roster with nothing behind its starters.
   *
   * Counts only lineup candidates, so IR and taxi are out of it for the same
   * reason they are out of `points` — they were never eligible to start.
   */
  bench_points: number;
  /**
   * The same two totals attributed player by player, keyed by player id. Only
   * players who appear in at least one week are here.
   */
  players: Record<string, PlayerSplit>;
};

/**
 * What each week's best lineup scores, summed over the weeks given, and how those
 * points divide among the roster.
 *
 * A different question from `optimalLineup` run once on season-long totals, and
 * always at least as large — see the module comment for why the two numbers are
 * kept side by side rather than one standing in for the other.
 *
 * `weeks` holds one entry per remaining week: the same candidates, scored against
 * *that* week's projection ({@link weeklyRosters} builds exactly this). A player
 * absent from a week is neither started nor benched in it, which is what keeps a
 * bye out of the counts — his slot still goes to whoever is playing, because a
 * player with no projection could only ever contribute zero to the lineup he was
 * seated in.
 *
 * `points` is rounded once at the end, for the reason `./aggregate` sums stat lines
 * rather than points: eighteen weekly roundings are eighteen chances to drift. Each
 * player's halves are rounded once for the same reason, which means summing the
 * halves across a roster can land a cent or two off `points` — they are two
 * roundings of the same number, not two different numbers.
 */
export function weeklyLineupSplit(
  slots: readonly string[],
  weeks: readonly (readonly RosterPlayer[])[],
): WeeklyLineupSplit {
  const split = new Map<string, PlayerSplit>();
  const entry = (player_id: string): PlayerSplit => {
    let found = split.get(player_id);
    if (!found) {
      split.set(
        player_id,
        (found = {
          starting_points: 0,
          bench_points: 0,
          starting_weeks: 0,
          bench_weeks: 0,
        }),
      );
    }
    return found;
  };

  let sum = 0;
  let benched = 0;
  for (const players of weeks) {
    const started = new Set<string>();
    for (const slot of optimalLineup(slots, players)) {
      sum += slot.points;
      if (slot.player_id) started.add(slot.player_id);
    }

    for (const player of players) {
      const found = entry(player.player_id);
      if (started.has(player.player_id)) {
        found.starting_points += player.points;
        found.starting_weeks += 1;
      } else {
        found.bench_points += player.points;
        found.bench_weeks += 1;
        benched += player.points;
      }
    }
  }

  for (const found of split.values()) {
    found.starting_points = round(found.starting_points);
    found.bench_points = round(found.bench_points);
  }

  return {
    points: round(sum),
    // Summed alongside the per-player halves rather than from them, so the team
    // total rounds once off the raw weeks instead of accumulating a cent of drift
    // per player the way adding up the rendered column would.
    bench_points: round(benched),
    players: Object.fromEntries(split),
  };
}

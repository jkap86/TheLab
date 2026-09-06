import { playerFactsAt } from "./facts.ts";
import type { ExperienceBasis, PlayerRecord } from "./facts.ts";
import { pointsPerGame } from "./season-line.ts";
import type { SeasonAggregate } from "./season-line.ts";

/**
 * Turning a folded season and the players map into the rows `player_seasons`
 * takes — and refusing, loudly, the ones that cannot be turned.
 *
 * **Nothing malformed is written.** Every column the table declares NOT NULL
 * has to be answerable from the two sources, and where one is not the row is
 * skipped with a reason the load report counts. The alternative is a default,
 * and a default in this table is the claim the schema's own comments spend
 * three paragraphs refusing: a zero age, a rookie's experience on a veteran, a
 * points-per-game divided by no games.
 *
 * Pure, so a fixture drives every arm of it.
 */

/** One row as the loader writes it. Column names are the table's. */
export type PlayerSeasonWrite = {
  player_id: string;
  season: number;
  player_name: string;
  position: string;
  age: number;
  experience: number;
  draft_pick: number | null;
  games: number;
  fantasy_pts: number;
  fantasy_ppg: number;
  rec: number;
  rec_yards: number;
  target_share: number | null;
  rush_yards: number;
  rush_att: number;
  yprr: number | null;
  snap_share: number | null;
};

/** Why rows were left out, counted rather than logged one by one. */
export type SkipCounts = Record<string, number>;

export type BuiltSeason = {
  season: number;
  rows: PlayerSeasonWrite[];
  skipped: SkipCounts;
  /** How many rows leaned on each experience derivation — see `./facts`. */
  experience: Record<ExperienceBasis, number>;
  /** How many rows carry a real draft pick, which under Sleeper alone is none. */
  draftFilled: number;
};

export type BuildSeasonInput = {
  season: number;
  /** The season the players map describes — `years_exp`'s baseline. */
  currentSeason: number;
  aggregates: readonly SeasonAggregate[];
  /** The players map, keyed by Sleeper id. */
  players: ReadonlyMap<string, PlayerRecord>;
  /** The positions this corpus holds. */
  positions: readonly string[];
  /** The fewest games a season must have to be a season. */
  minGames: number;
};

/**
 * The rows for one season.
 *
 * **The position comes from the players map and not from the feed**, which
 * matters more than it sounds: the map is what every other read in this app
 * calls a player, so a corpus keyed to the feed's inline `player` blob would
 * classify a handful of players differently from the rest of the database for
 * no reason a reader could see. The feed's value is a fallback for a player
 * the map has dropped.
 *
 * **`minGames` is the activity floor and it is deliberately low.** The obvious
 * shape for a corpus is the top forty at each position, and it is wrong twice
 * over: the positional finish `readStoredSeasons` derives would rank forty
 * players among themselves and call the fortieth `WR40`, and — the expensive
 * one — a player who fell out of the top forty the following year would read
 * as having *not played*, which is precisely the false outcome the corpus's
 * did-not-play rule exists to make true. Loading everyone who took a snap is
 * what makes an absence mean an absence.
 */
export function buildSeasonRows(input: BuildSeasonInput): BuiltSeason {
  const { season, currentSeason, aggregates, players, positions, minGames } = input;
  const allowed = new Set(positions);
  const rows: PlayerSeasonWrite[] = [];
  const skipped: SkipCounts = {};
  const experience: Record<ExperienceBasis, number> = { rookie_year: 0, years_exp: 0 };
  let draftFilled = 0;

  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const aggregate of aggregates) {
    if (aggregate.games < minGames) {
      skip("no games played");
      continue;
    }

    const record = players.get(aggregate.player_id) ?? null;
    const position = (record?.position ?? aggregate.position ?? "").trim().toUpperCase();
    if (!position) {
      skip("no position");
      continue;
    }
    if (!allowed.has(position)) {
      skip(`position not loaded (${position})`);
      continue;
    }

    if (!record) {
      skip("not in the players map");
      continue;
    }

    const name = (record.name ?? aggregate.name ?? "").trim();
    if (!name) {
      skip("no name");
      continue;
    }

    const facts = playerFactsAt(record, season, currentSeason);
    if (!facts.ok) {
      skip(facts.reason);
      continue;
    }

    experience[facts.basis]++;
    if (facts.facts.draft !== null) draftFilled++;

    rows.push({
      player_id: aggregate.player_id,
      season,
      // The table's own width. A name past it is truncated rather than
      // dropping the season, since the identity that matters is the id.
      player_name: name.slice(0, 255),
      position,
      age: facts.facts.age,
      experience: facts.facts.exp,
      draft_pick: facts.facts.draft,
      games: aggregate.games,
      fantasy_pts: aggregate.fantasy_pts,
      fantasy_ppg: pointsPerGame(aggregate.fantasy_pts, aggregate.games),
      rec: aggregate.rec,
      rec_yards: aggregate.rec_yards,
      target_share: aggregate.target_share,
      rush_yards: aggregate.rush_yards,
      rush_att: aggregate.rush_att,
      // No source here publishes routes run — see `./facts` on the same shape
      // of absence, and `shared/comps/coverage` on what an absent criterion
      // costs rather than claims.
      yprr: null,
      snap_share: aggregate.snap_share,
    });
  }

  rows.sort((a, b) => a.player_id.localeCompare(b.player_id));
  return { season, rows, skipped, experience, draftFilled };
}

/** Two skip tallies added, for a report over several seasons. */
export function mergeSkips(into: SkipCounts, from: SkipCounts): SkipCounts {
  for (const [reason, count] of Object.entries(from)) {
    into[reason] = (into[reason] ?? 0) + count;
  }
  return into;
}

import type {
  CompCorpusSource,
  CompMatch,
  CompNextSeason,
  CompPlayerFacts,
  CompSeasonLine,
  CompSubject,
} from "@/shared/contract";
import type { CompRow, RankedComp } from "@/shared/comps";

/**
 * The corpus as the comps arithmetic reads it: every historical player-season
 * with a following season on file, and every player as he stands entering the
 * coming season. Built from stored rows by {@link buildCorpus}, or shipped
 * whole by the sample module — and the two must build the same object,
 * because the route and the ranking cannot tell them apart.
 *
 * Pure apart from type imports, so the builder is tested under Node's runner:
 * which rows are comps and which are subjects, and what each row's series
 * holds, is exactly the kind of rule that is silent when it is wrong.
 */

/** One player's season as the store holds it — the flat shape both readers produce. */
export type StoredSeason = {
  player_id: string;
  name: string;
  position: string;
  season: number;
  facts: CompPlayerFacts;
  line: CompSeasonLine;
  /** The positional finish that season (`WR12`), or null where it cannot be ranked. */
  finish: string | null;
};

/** A comp candidate: the row, its series and its payoff. */
export type CorpusSeason = CompRow & {
  player_id: string;
  name: string;
  position: string;
  season: number;
  next: CompNextSeason;
};

/** A subject: his last completed line and the series behind it. */
export type CorpusSubject = CompRow & {
  player_id: string;
  name: string;
  position: string;
  last_season: number;
  /** Null until priced — the route prices a stored subject off KeepTradeCut. */
  ktc: number | null;
};

export type CompCorpus = {
  source: CompCorpusSource;
  /** The season subjects are entering — one past the latest season on file. */
  subject_season: number;
  /**
   * The seasons the corpus actually holds rows for, ascending.
   *
   * This is what tells "he did nothing" from "we have no data": a player
   * absent from a season the loader *wrote* did not produce, and a player
   * absent from a season nobody loaded is unknown. See {@link buildCorpus}.
   */
  covered_seasons: number[];
  /** The latest season whose outcomes the corpus treats as complete. */
  max_completed_season: number;
  seasons: CorpusSeason[];
  subjects: CorpusSubject[];
};

/** What {@link buildCorpus} needs beyond the rows themselves. */
export type BuildCorpusOptions = {
  /**
   * The seasons the loader wrote, where it recorded them. Absent, the seasons
   * present in `rows` are used — which is the same answer whenever the loader
   * wrote at least one row per season it loaded, and the safe answer when it
   * did not, since an unrecorded season reads as uncovered and its absences
   * read as unknown rather than as zeroes.
   */
  coveredSeasons?: readonly number[];
  /**
   * The latest season whose following-year outcomes are knowable. Defaults to
   * the latest season on file, which is the loader's own promise: it refuses
   * to write an in-progress season as a completed one.
   */
  maxCompletedSeason?: number;
};

/** A next season nobody played, spelled once. */
const DID_NOT_PLAY: CompNextSeason = {
  ppg: 0,
  recyd: 0,
  rec: 0,
  gp: 0,
  finish: null,
  played: false,
};

/**
 * A corpus from flat stored rows.
 *
 * Four rules, and each is a claim the table cannot make for itself:
 *
 * - **A comp is a season whose following season the corpus can answer for.**
 *   The payoff column is what a reader looks at a comp for; a season the
 *   corpus knows nothing after is not a comp, and every row of the latest
 *   season is that case by construction — those players are the subjects
 *   instead.
 * - **A player who was not there the following year is a comp, and one of the
 *   most important ones.** This is the survivorship fix, and it is the reason
 *   `covered_seasons` exists. The rule this replaced required a stored row at
 *   season N+1 before season N could be a comp, which quietly deleted every
 *   retirement, every career-ending injury, every lost season and everyone who
 *   fell out of the league — precisely the outcomes a reader is looking at a
 *   comp to find out about. What was left was a forward-outcome distribution
 *   with the bad half removed: a board of comps whose next years, on average,
 *   went better than a real player's do.
 *
 *   So an absent N+1 is read as {@link DID_NOT_PLAY} — zero games, zero
 *   production, no finish, `played: false` — **but only where the corpus
 *   actually loaded season N+1**. That is the whole of the distinction: within
 *   a covered season an absence is a measurement, and outside one it is a hole
 *   in the data, which is not a comp at all. A gap in a career the loader did
 *   not cover is left out rather than turned into a zero.
 * - **A subject is a row of the latest season on file**, and he is entering
 *   the one after it. Which season that is comes off the data, not a
 *   constant: a table that gains a season gains a year of subjects with no
 *   edit here.
 * - **A row's series is the player's seasons at or before it, newest
 *   first.** Nothing after the row ever enters it — see `shared/comps/windows`
 *   for why reading forward would score a comp on its own answer.
 *
 * An empty input builds an empty corpus rather than throwing, since a table
 * that has not been loaded yet is an ordinary state the read above answers
 * for.
 */
export function buildCorpus(
  rows: readonly StoredSeason[],
  source: CompCorpusSource,
  options: BuildCorpusOptions = {},
): CompCorpus {
  const byPlayer = new Map<string, StoredSeason[]>();
  const present = new Set<number>();
  let latest = -Infinity;
  for (const row of rows) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row);
    byPlayer.set(row.player_id, list);
    present.add(row.season);
    if (row.season > latest) latest = row.season;
  }
  if (rows.length === 0) {
    return {
      source,
      subject_season: 0,
      covered_seasons: [...(options.coveredSeasons ?? [])].sort((a, b) => a - b),
      max_completed_season: options.maxCompletedSeason ?? 0,
      seasons: [],
      subjects: [],
    };
  }

  const covered = new Set(options.coveredSeasons ?? present);
  const maxCompleted = options.maxCompletedSeason ?? latest;

  /**
   * Whether a season's outcomes can be read at all.
   *
   * **Complete first, covered second, and both are needed.** A season still
   * being played is not an outcome even for the players who *do* have rows in
   * it: a payoff column nine games short would read as a collapse for everyone
   * in the corpus. So a row is a comp only when the season after it is one the
   * corpus treats as finished — which is what makes every row of the latest
   * season a subject rather than a comp, under the default and under an
   * explicit bound alike.
   */
  const complete = (season: number): boolean => season <= maxCompleted;

  /**
   * Whether an *absence* at a complete season is a measurement rather than a
   * hole. It has to be a season the loader actually wrote: a player missing
   * from a season nobody loaded is unknown, and turning that into a zero is
   * the one thing the survivorship fix must not do in reverse.
   */
  const covers = (season: number): boolean => covered.has(season);

  const seasons: CorpusSeason[] = [];
  const subjects: CorpusSubject[] = [];

  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.season - b.season);
    const bySeason = new Map(list.map((r) => [r.season, r]));
    list.forEach((row, index) => {
      // Newest first, the row itself first.
      const history = list
        .slice(0, index + 1)
        .reverse()
        .map((r) => r.line);
      const next = row.season + 1;
      const following = complete(next) ? bySeason.get(next) : undefined;
      if (following) {
        seasons.push({
          player_id: row.player_id,
          name: row.name,
          position: row.position,
          season: row.season,
          facts: row.facts,
          history,
          next: {
            ppg: following.line.ppg,
            recyd: following.line.recyd,
            rec: following.line.rec,
            gp: following.line.gp,
            finish: following.finish,
            played: true,
          },
        });
      } else if (complete(next) && covers(next)) {
        seasons.push({
          player_id: row.player_id,
          name: row.name,
          position: row.position,
          season: row.season,
          facts: row.facts,
          history,
          next: DID_NOT_PLAY,
        });
      }
      if (row.season === latest) {
        subjects.push({
          player_id: row.player_id,
          name: row.name,
          position: row.position,
          last_season: row.season,
          facts: row.facts,
          history,
          ktc: null,
        });
      }
    });
  }

  seasons.sort((a, b) => a.season - b.season || a.name.localeCompare(b.name));
  subjects.sort((a, b) => a.name.localeCompare(b.name));

  return {
    source,
    subject_season: latest + 1,
    covered_seasons: [...covered].sort((a, b) => a - b),
    max_completed_season: maxCompleted,
    seasons,
    subjects,
  };
}

/** The earliest and latest comp seasons, and how many there are. */
export function corpusBounds(corpus: CompCorpus): {
  from: number;
  to: number;
  seasons: number;
} {
  if (corpus.seasons.length === 0) return { from: 0, to: 0, seasons: 0 };
  let from = Infinity;
  let to = -Infinity;
  for (const s of corpus.seasons) {
    if (s.season < from) from = s.season;
    if (s.season > to) to = s.season;
  }
  return { from, to, seasons: corpus.seasons.length };
}

/** A subject, as the wire carries him. */
export function toCompSubject(
  subject: CorpusSubject,
  subjectSeason: number,
): CompSubject {
  return {
    player_id: subject.player_id,
    name: subject.name,
    position: subject.position,
    season: subjectSeason,
    last_season: subject.last_season,
    ...subject.facts,
    line: subject.history[0],
    years_on_file: subject.history.length,
    ktc: subject.ktc,
  };
}

/** A ranked comp, as the wire carries it. */
export function toCompMatch(ranked: RankedComp<CorpusSeason>): CompMatch {
  const { row } = ranked;
  return {
    player_id: row.player_id,
    name: row.name,
    position: row.position,
    season: row.season,
    ...row.facts,
    line: row.history[0],
    next: row.next,
    years_on_file: row.history.length,
    distance: ranked.distance,
    similarity: ranked.similarity,
    coverage: ranked.coverage,
    pairs: ranked.pairs,
  };
}

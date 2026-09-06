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
  seasons: CorpusSeason[];
  subjects: CorpusSubject[];
};

/**
 * A corpus from flat stored rows.
 *
 * Three rules, and each is a claim the table cannot make for itself:
 *
 * - **A comp is a season with the following season on file.** The payoff
 *   column is what a reader looks at a comp for, so a season with nothing
 *   after it is not one — including, by construction, every row of the latest
 *   season, whose players are the subjects instead.
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
 * with the sample.
 */
export function buildCorpus(
  rows: readonly StoredSeason[],
  source: CompCorpusSource,
): CompCorpus {
  const byPlayer = new Map<string, StoredSeason[]>();
  let latest = -Infinity;
  for (const row of rows) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row);
    byPlayer.set(row.player_id, list);
    if (row.season > latest) latest = row.season;
  }
  if (rows.length === 0) {
    return { source, subject_season: 0, seasons: [], subjects: [] };
  }

  const seasons: CorpusSeason[] = [];
  const subjects: CorpusSubject[] = [];

  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.season - b.season);
    list.forEach((row, index) => {
      // Newest first, the row itself first.
      const history = list
        .slice(0, index + 1)
        .reverse()
        .map((r) => r.line);
      const following = list[index + 1];
      if (following && following.season === row.season + 1) {
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
          },
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

  return { source, subject_season: latest + 1, seasons, subjects };
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
    pairs: ranked.pairs,
  };
}

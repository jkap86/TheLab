import type { CompCorpusMeta } from "@/shared/contract";
import { pool } from "@/shared/db";

import type { StoredSeason } from "./corpus";

/**
 * The stored corpus, flat: every `player_seasons` row, with the positional
 * finish derived beside it.
 *
 * **`finish` is ranked here rather than stored**, because it is a statement
 * about the whole position's population that season and the table is the
 * only thing that knows what that population is. Ranked by fantasy points
 * within `(season, position)`, standard competition ranking, which is what
 * `WR12` means everywhere else. The consequence a loader has to know: a
 * season loaded for its top forty receivers ranks those forty among
 * themselves, and the finish is only as true as the population is whole.
 *
 * Read whole and ordered by player then season, which is the order the
 * corpus builder wants and the primary key already provides.
 */
type PlayerSeasonRow = {
  player_id: string;
  player_name: string;
  position: string;
  season: number;
  age: string;
  experience: number;
  draft_pick: number | null;
  /** True where the source knew he went undrafted; false beside a null pick is unknown. */
  undrafted: boolean;
  games: number;
  fantasy_pts: string;
  fantasy_ppg: string;
  rec: number;
  rec_yards: number;
  target_share: string | null;
  rush_yards: number;
  yprr: string | null;
  snap_share: string | null;
  finish: string;
};

export async function readStoredSeasons(): Promise<StoredSeason[]> {
  const { rows } = await pool.query<PlayerSeasonRow>(
    `SELECT player_id, player_name, position, season, age, experience,
            draft_pick, undrafted, games, fantasy_pts, fantasy_ppg, rec, rec_yards,
            target_share, rush_yards, yprr, snap_share,
            position || rank() OVER (
              PARTITION BY season, position ORDER BY fantasy_pts DESC
            ) AS finish
       FROM player_seasons
      ORDER BY player_id, season`,
  );

  // `numeric` columns arrive as strings from `pg`, which is right for money
  // and wrong for a z-score; every one is converted exactly once, here.
  return rows.map((row) => ({
    player_id: row.player_id,
    name: row.player_name,
    position: row.position,
    season: row.season,
    facts: {
      age: Number(row.age),
      exp: row.experience,
      // Three states off two columns — see the migration that added the
      // second. A null pick is undrafted only where the row says so; otherwise
      // it is a slot nobody could supply, which is not the same fact.
      draft: row.draft_pick ?? (row.undrafted ? "udfa" : null),
    },
    line: {
      ppg: Number(row.fantasy_ppg),
      pts: Number(row.fantasy_pts),
      recyd: row.rec_yards,
      rec: row.rec,
      tgtsh: row.target_share === null ? null : Number(row.target_share),
      rush: row.rush_yards,
      yprr: row.yprr === null ? null : Number(row.yprr),
      snap: row.snap_share === null ? null : Number(row.snap_share),
      gp: row.games,
    },
    finish: row.finish,
  }));
}

/** The one corpus this table describes. */
export const CORPUS_NAME = "player_seasons";

/**
 * What a version probe reads: the metadata row where the loader wrote one, and
 * a fingerprint of the rows either way.
 *
 * The fingerprint is what covers a table loaded by an older loader, by a
 * restore, or by hand — the metadata row is a claim about the rows and its
 * absence must not mean "no rows". `count(*)` over a few thousand rows is a
 * millisecond, and this runs once per {@link CORPUS_META_TTL_MS} rather than
 * per request.
 */
export type CorpusProbe = {
  meta: CompCorpusMeta | null;
  rows: number;
  min_season: number | null;
  max_season: number | null;
};

type ProbeRow = {
  meta: RawMetaRow | null;
  rows: string;
  min_season: number | null;
  max_season: number | null;
};

type RawMetaRow = {
  source: string;
  source_version: string | null;
  scoring: string;
  loader_version: string;
  seasons: number[] | null;
  min_season: number;
  max_completed_season: number;
  row_count: number;
  player_count: number;
  loaded_at: string;
};

/**
 * The corpus's identity in one round trip.
 *
 * One statement rather than two so a probe cannot see a metadata row written
 * between two reads of the rows it describes — which would be a version string
 * naming a load the fingerprint disagrees with, and a cache that never settles.
 */
export async function probeCorpus(): Promise<CorpusProbe> {
  const { rows } = await pool.query<ProbeRow>(
    `SELECT (SELECT to_jsonb(m) FROM comps_corpus_meta m WHERE m.corpus = $1) AS meta,
            (SELECT count(*) FROM player_seasons) AS rows,
            (SELECT min(season) FROM player_seasons) AS min_season,
            (SELECT max(season) FROM player_seasons) AS max_season`,
    [CORPUS_NAME],
  );

  const row = rows[0];
  return {
    meta: row?.meta ? toCorpusMeta(row.meta) : null,
    rows: Number(row?.rows ?? 0),
    min_season: row?.min_season ?? null,
    max_season: row?.max_season ?? null,
  };
}

/**
 * A stored metadata row as the wire carries it.
 *
 * `loaded_at` arrives from `to_jsonb` already as an ISO string, and `seasons`
 * as a JSON array; both are normalised here so a caller never has to know
 * which of the two shapes a `timestamptz` or a `smallint[]` reached it in.
 */
function toCorpusMeta(row: RawMetaRow): CompCorpusMeta {
  return {
    source: row.source,
    source_version: row.source_version,
    scoring: row.scoring,
    loader_version: row.loader_version,
    loaded_at: new Date(row.loaded_at).toISOString(),
    seasons: (row.seasons ?? []).map(Number).sort((a, b) => a - b),
    max_completed_season: Number(row.max_completed_season),
    rows: Number(row.row_count),
    players: Number(row.player_count),
  };
}

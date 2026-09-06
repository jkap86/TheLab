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
            draft_pick, games, fantasy_pts, fantasy_ppg, rec, rec_yards,
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
      draft: row.draft_pick,
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

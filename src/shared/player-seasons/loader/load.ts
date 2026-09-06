import type { CompCorpusMeta } from "@/shared/contract";
import { COMP_POSITIONS } from "@/shared/comps";
import {
  bulkInsert,
  LOCK_KEYS,
  pool,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { getNflState } from "@/shared/sleeper";

import { CORPUS_NAME } from "../queries";
import { refreshCompCorpus } from "../read";
import { foldSeasonStats, DEFAULT_SCORING } from "./season-line.ts";
import type { CompsScoring } from "./season-line.ts";
import { latestCompleteSeason, planLoad, playersMapSeason } from "./plan.ts";
import type { CompsLoadPlan, CompsLoadRequest, NflSeasonState } from "./plan.ts";
import { fetchDraftCapital } from "./draft-fetch";
import { DRAFT_SOURCE_NAME } from "./draft-source.ts";
import type { DraftCapitalSource, KnownDraftCapital } from "./draft-source.ts";
import { readPlayerRecords } from "./players";
import type { PlayerRecord } from "./facts.ts";
import { buildSeasonRows, mergeSkips } from "./rows.ts";
import type { DraftCounts, PlayerSeasonWrite, SkipCounts } from "./rows.ts";
import { sleeperSeasonStats, SLEEPER_SOURCE_NAME } from "./sleeper-source.ts";
import type { SeasonStatSource } from "./sleeper-source.ts";

/**
 * The `player_seasons` loader: fetch a span of completed NFL seasons, fold
 * each into one row per player, and write the lot with the metadata row that
 * says what they are.
 *
 * The migration promised this and the repo did not have it, which is what made
 * the comps page a feature with a toy corpus behind it and no supported way to
 * replace one. It is a **script rather than a sync loop** for the reason that
 * migration gives: the corpus changes once a year, when a season ends, so a
 * background tick would be a loop that does nothing for eleven months and
 * then does something nobody is watching.
 *
 * Six things about it are decisions rather than plumbing.
 *
 * **It never writes an unfinished season.** `./plan` is the whole of that rule
 * and it reads Sleeper's own state rather than a clock; a season still being
 * played, written as a comp season, would turn every player who has not yet
 * appeared in it into a retirement and score the season before it against a
 * payoff column nine games short.
 *
 * **Everything is fetched before the transaction opens.** Never hold a pooled
 * connection across a Sleeper fan-out — the rule `fetchLeagueGraph` and
 * `persistLeagueGraph` are split by, one tool over — and this fan-out is
 * eighteen weeks a season.
 *
 * **One transaction for the whole load**, where the graph sync takes one per
 * league. A corpus is a single artefact whose covered-season list is a claim
 * about all of it: a load that wrote 2018–2021 and then failed would leave a
 * metadata row promising coverage it does not have, and the did-not-play rule
 * reads exactly that promise. All of it or none of it.
 *
 * **It upserts and never deletes.** Rerunning is the ordinary case — a fixed
 * source, a corrected season, a wider span — and a load that cleared the table
 * first would leave a window with no corpus in it, and a failure mid-way with
 * no corpus at all. A season loaded twice writes the same rows twice, which is
 * what "safe to rerun" means here.
 *
 * **It counts what it did and what it refused.** Inserted, updated, skipped
 * with a reason each, the seasons written, and the two figures a reader of the
 * resulting corpus needs to judge it: how many rows leaned on the weaker
 * experience derivation, and how the rows' draft capital resolved — drafted,
 * known undrafted, or unknown.
 *
 * **A draft source that cannot be read fails the load, before any season is
 * fetched.** Writing the seasons anyway would write every row as "unknown"
 * and stamp them covered, and the refresh gate would never come back for
 * them — which is the corpus of undrafted free agents this column just
 * stopped producing, with a different cause. `sleeper-source` makes the same
 * call for a week that will not fetch: a loud failure and a rerun beat a
 * quietly wrong table nothing revisits.
 *
 * **The advisory lock is the blocking-free kind**, so a second loader started
 * by accident reports that one is already running rather than queueing behind
 * it with a Sleeper fan-out in hand.
 */

/**
 * The loader/schema version written into the metadata row.
 *
 * Moved whenever the *meaning* of a written row changes — a new column, a
 * different derivation, a different scoring key — so a corpus written by an
 * older loader can be told apart without diffing rows. The corpus cache keys
 * on it too, so bumping it invalidates every held build.
 */
export const LOADER_VERSION = "2";

/** The fewest games a season needs to be a season. See `./rows`. */
export const DEFAULT_MIN_GAMES = 1;

export type CompsLoadOptions = CompsLoadRequest & {
  /** The scoring basis the whole table is on. */
  scoring?: CompsScoring;
  /** Which positions to load. Defaults to every position comps supports. */
  positions?: readonly string[];
  minGames?: number;
  /** The source of one season's weeks. Injected so tests need no network. */
  source?: SeasonStatSource;
  /** The source's name for the metadata row. */
  sourceName?: string;
  sourceVersion?: string | null;
  /** Overridden in tests; read from Sleeper otherwise. */
  state?: NflSeasonState;
  /** The players map. Read from Postgres otherwise. */
  players?: ReadonlyMap<string, PlayerRecord>;
  /** Draft capital by Sleeper id. Fetched from `./draft-source` otherwise. */
  draftSource?: DraftCapitalSource;
  /** Report progress a season at a time — the CLI prints these. */
  onProgress?: (line: string) => void;
};

export type CompsLoadReport = {
  /** True when another loader held the lock and this run did nothing. */
  locked: boolean;
  plan: CompsLoadPlan;
  seasons: number[];
  inserted: number;
  updated: number;
  skipped: SkipCounts;
  errors: { season: number; message: string }[];
  /** How many rows leaned on each experience derivation. */
  experience: { rookie_year: number; years_exp: number };
  /** How the written rows' draft capital resolved. */
  draft: DraftCounts;
  meta: CompCorpusMeta | null;
};

export async function loadCompsCorpus(
  options: CompsLoadOptions = { from: null, to: null },
): Promise<CompsLoadReport> {
  const report = await withAdvisoryLock(LOCK_KEYS.compsCorpus, () =>
    loadLocked(options),
  );
  return report ?? LOCKED_REPORT;
}

async function loadLocked(options: CompsLoadOptions): Promise<CompsLoadReport> {
  const log = options.onProgress ?? (() => {});
  const scoring = options.scoring ?? DEFAULT_SCORING;
  const positions = options.positions ?? [...COMP_POSITIONS];
  const minGames = options.minGames ?? DEFAULT_MIN_GAMES;
  const source = options.source ?? sleeperSeasonStats;

  // A state Sleeper did not answer is not a state that says a season is over,
  // and `latestCompleteSeason` reads that as "nothing is complete" — so a load
  // during an outage refuses every season by name rather than writing an
  // unfinished one. `planLoad` puts the reason on the console.
  const state = options.state ?? (await getNflState()) ?? { season: "", season_type: "" };
  const latestComplete = latestCompleteSeason(state);
  // Not the same number as `latestComplete`, and the difference is a year of
  // experience on every row the `years_exp` fallback answers for — see
  // `playersMapSeason`.
  const mapSeason = playersMapSeason(state, latestComplete + 1);
  const plan = planLoad(options, latestComplete);
  for (const refusal of plan.refused) {
    log(`refusing ${refusal.season}: ${refusal.reason}`);
  }

  const empty: CompsLoadReport = {
    locked: false,
    plan,
    seasons: [],
    inserted: 0,
    updated: 0,
    skipped: {},
    errors: [],
    experience: { rookie_year: 0, years_exp: 0 },
    draft: { drafted: 0, undrafted: 0, unknown: 0 },
    meta: null,
  };
  if (plan.seasons.length === 0) return empty;

  // The map is read once for every season: it is the same twelve thousand rows
  // whichever season is being derived, and the season enters through the
  // arithmetic rather than through the query.
  const players = options.players ?? (await readPlayerRecords());
  log(`players map: ${players.size} rows`);
  // Likewise once, and before any season is fetched — see the header on why
  // this one is allowed to fail the whole load.
  const draft: ReadonlyMap<string, KnownDraftCapital> = await (
    options.draftSource ?? fetchDraftCapital
  )();
  log(`draft capital: ${draft.size} players from ${DRAFT_SOURCE_NAME}`);

  // Everything fetched, folded and built before a connection is taken.
  const built: PlayerSeasonWrite[] = [];
  const skipped: SkipCounts = {};
  const experience = { rookie_year: 0, years_exp: 0 };
  const errors: { season: number; message: string }[] = [];
  const written: number[] = [];
  const draftCounts: DraftCounts = { drafted: 0, undrafted: 0, unknown: 0 };

  for (const season of plan.seasons) {
    try {
      const weeks = await source(season);
      const aggregates = foldSeasonStats(weeks, scoring);
      const seasonRows = buildSeasonRows({
        season,
        currentSeason: mapSeason,
        aggregates,
        players,
        draft,
        positions,
        minGames,
      });
      // A season that fetched but produced nothing is a failure rather than an
      // empty year: it means the shape changed or the span answered nothing,
      // and writing it as covered would make every player of the season before
      // it a retirement.
      if (seasonRows.rows.length === 0) {
        throw new Error("no rows built; the source answered nothing usable");
      }
      built.push(...seasonRows.rows);
      mergeSkips(skipped, seasonRows.skipped);
      experience.rookie_year += seasonRows.experience.rookie_year;
      experience.years_exp += seasonRows.experience.years_exp;
      draftCounts.drafted += seasonRows.draft.drafted;
      draftCounts.undrafted += seasonRows.draft.undrafted;
      draftCounts.unknown += seasonRows.draft.unknown;
      written.push(season);
      log(`${season}: ${seasonRows.rows.length} rows`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ season, message });
      log(`${season}: failed — ${message}`);
    }
  }

  // A season that failed is a season that was not covered, and coverage is
  // what the did-not-play rule reads. Writing the seasons that succeeded with
  // a hole in the middle is fine; claiming the hole was covered is not.
  if (written.length === 0) {
    return { ...empty, errors };
  }

  const existing = await readExistingKeys(written);
  let inserted = 0;
  let updated = 0;
  for (const row of built) {
    if (existing.has(`${row.player_id}:${row.season}`)) updated++;
    else inserted++;
  }

  const meta: CompCorpusMeta = {
    source: options.sourceName ?? SLEEPER_SOURCE_NAME,
    source_version: options.sourceVersion ?? null,
    scoring,
    loader_version: LOADER_VERSION,
    loaded_at: new Date().toISOString(),
    seasons: [...written].sort((a, b) => a - b),
    max_completed_season: latestComplete,
    rows: built.length,
    players: new Set(built.map((r) => r.player_id)).size,
  };

  await withTransaction(async (client) => {
    await bulkInsert(client, {
      table: "player_seasons",
      columns: [
        "player_id",
        "season",
        "player_name",
        "position",
        "age",
        "experience",
        "draft_pick",
        "undrafted",
        "games",
        "fantasy_pts",
        "fantasy_ppg",
        "rec",
        "rec_yards",
        "target_share",
        "rush_yards",
        "rush_att",
        "yprr",
        "snap_share",
      ],
      rows: built,
      values: (row) => [
        row.player_id,
        row.season,
        row.player_name,
        row.position,
        row.age,
        row.experience,
        row.draft_pick,
        row.undrafted,
        row.games,
        row.fantasy_pts,
        row.fantasy_ppg,
        row.rec,
        row.rec_yards,
        row.target_share,
        row.rush_yards,
        row.rush_att,
        row.yprr,
        row.snap_share,
      ],
      onConflict: `(player_id, season) DO UPDATE SET
          player_name = EXCLUDED.player_name, position = EXCLUDED.position,
          age = EXCLUDED.age, experience = EXCLUDED.experience,
          draft_pick = EXCLUDED.draft_pick, undrafted = EXCLUDED.undrafted,
          games = EXCLUDED.games,
          fantasy_pts = EXCLUDED.fantasy_pts, fantasy_ppg = EXCLUDED.fantasy_ppg,
          rec = EXCLUDED.rec, rec_yards = EXCLUDED.rec_yards,
          target_share = EXCLUDED.target_share, rush_yards = EXCLUDED.rush_yards,
          rush_att = EXCLUDED.rush_att, yprr = EXCLUDED.yprr,
          snap_share = EXCLUDED.snap_share`,
    });

    // The metadata row is written in the same transaction as the rows it
    // describes, so a corpus can never claim a coverage its rows do not have.
    // `seasons` is merged rather than replaced: a load of 2024 alone must not
    // erase the fact that 2018–2023 are on file, since coverage is what the
    // did-not-play rule reads and a narrowed list would turn every earlier
    // absence back into an unknown.
    await client.query(
      `INSERT INTO comps_corpus_meta
         (corpus, source, source_version, scoring, loader_version, seasons,
          min_season, max_completed_season, row_count, player_count, loaded_at)
       SELECT $1, $2, $3, $4, $5, s.seasons,
              (SELECT min(season) FROM player_seasons),
              $7,
              (SELECT count(*) FROM player_seasons),
              (SELECT count(DISTINCT player_id) FROM player_seasons),
              $8
         FROM (SELECT $6::int[] AS seasons) s
       ON CONFLICT (corpus) DO UPDATE SET
          source = EXCLUDED.source, source_version = EXCLUDED.source_version,
          scoring = EXCLUDED.scoring, loader_version = EXCLUDED.loader_version,
          seasons = (
            SELECT array_agg(DISTINCT x ORDER BY x)
              FROM unnest(comps_corpus_meta.seasons || EXCLUDED.seasons) AS x
          ),
          min_season = EXCLUDED.min_season,
          max_completed_season = greatest(
            comps_corpus_meta.max_completed_season, EXCLUDED.max_completed_season
          ),
          row_count = EXCLUDED.row_count, player_count = EXCLUDED.player_count,
          loaded_at = EXCLUDED.loaded_at`,
      [
        CORPUS_NAME,
        meta.source,
        meta.source_version,
        meta.scoring,
        meta.loader_version,
        meta.seasons,
        meta.max_completed_season,
        meta.loaded_at,
      ],
    );
  });

  // The process that wrote the rows is often the one about to read them; every
  // other process notices within `CORPUS_META_TTL_MS` on its own.
  refreshCompCorpus();

  return {
    locked: false,
    plan,
    seasons: meta.seasons,
    inserted,
    updated,
    skipped,
    errors,
    experience,
    draft: draftCounts,
    meta,
  };
}

/**
 * Which `(player_id, season)` pairs the seasons being written already hold.
 *
 * Read before the transaction and used only to split the upsert's count into
 * inserted and updated — a report figure rather than a decision, so a race
 * with another writer costs a miscount and never a wrong write. Postgres can
 * answer the same question with `RETURNING (xmax = 0)`, which `bulkInsert`
 * does not surface and which is not worth widening it for.
 */
async function readExistingKeys(seasons: readonly number[]): Promise<Set<string>> {
  const { rows } = await pool.query<{ player_id: string; season: number }>(
    `SELECT player_id, season FROM player_seasons WHERE season = ANY($1)`,
    [seasons],
  );
  return new Set(rows.map((r) => `${r.player_id}:${r.season}`));
}

/** What a run that lost the lock reports: another loader is already at it. */
const LOCKED_REPORT: CompsLoadReport = {
  locked: true,
  plan: { seasons: [], maxCompletedSeason: 0, refused: [] },
  seasons: [],
  inserted: 0,
  updated: 0,
  skipped: {},
  errors: [],
  experience: { rookie_year: 0, years_exp: 0 },
  draft: { drafted: 0, undrafted: 0, unknown: 0 },
  meta: null,
};

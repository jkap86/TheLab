/**
 * The comps page's wire types: a subject entering the coming season, the
 * historical player-seasons nearest to him, and what each of them did the year
 * after.
 *
 * Declared here with zero runtime imports, on the folder's rule: the criteria
 * panel and the comp card are `"use client"` modules that name these shapes,
 * and `shared/player-seasons` — which reaches Postgres — imports them back
 * with `import type`.
 */

/**
 * The four windows a production criterion can be read over.
 *
 * `last` is the row's own season. The other three read the player's seasons
 * *ending at that row's season* — a 2021 row's career figures use 2021 and
 * earlier, never later. Reading forward would leak the answer: the payoff
 * column is the following season, and a career average including it would
 * score the comp on information the comp cannot have had.
 */
export type CompWindowId = "last" | "avg2" | "cavg" | "chigh";

/**
 * The eleven things a reader can weight. A criterion is not simply a column:
 * `recyd` reads receiving yards *and* receptions, one thing a reader weights
 * and two columns the distance reads. The columns each one reads are in
 * `shared/comps/criteria`.
 */
export type CompCriterionId =
  | "age"
  | "draft"
  | "ppg"
  | "pts"
  | "recyd"
  | "tgtsh"
  | "rush"
  | "yprr"
  | "snap"
  | "gp"
  | "exp";

/**
 * The nine production fields a window applies to. Age, draft slot and
 * experience are facts about the player at that season, not production, and
 * have no window.
 */
export type CompStatField =
  | "ppg"
  | "pts"
  | "recyd"
  | "rec"
  | "tgtsh"
  | "rush"
  | "yprr"
  | "snap"
  | "gp";

/**
 * One season's production line.
 *
 * `tgtsh`, `yprr` and `snap` are **nullable, and null is not zero**: the data
 * behind them is not available for every season and position, and a null
 * excludes that criterion for that row rather than z-scoring as a zero —
 * see `shared/comps/knn`. The other six are counting stats every season has.
 */
export type CompSeasonLine = {
  /** Fantasy points per game, on the corpus's stated scoring basis. */
  ppg: number;
  /** Fantasy points, same basis. */
  pts: number;
  /** Receiving yards. */
  recyd: number;
  /** Receptions. */
  rec: number;
  /** Target share, as a percentage (0–100). */
  tgtsh: number | null;
  /** Rushing yards. */
  rush: number;
  /** Yards per route run. */
  yprr: number | null;
  /** Snap share, as a percentage (0–100). */
  snap: number | null;
  /** Games played. */
  gp: number;
};

/**
 * A player's NFL draft capital, in three states — and the third is the one
 * that used to be missing.
 *
 * A number is the overall pick. `"udfa"` is a player the source *knows* went
 * undrafted, which the distance reads as `UDFA_PICK` (see
 * `shared/comps/criteria`) because "came off the board after everyone" is an
 * ordinal statement about capital rather than an absence. **`null` is
 * unknown**: no source could say, and it is read the way a null target share
 * is — the pair is absent from that row's distance and the page prints an em
 * dash. It was a two-state field once, null standing for undrafted, and under
 * a source that publishes no draft position at all that spelled every player
 * in the corpus as an undrafted free agent.
 */
export type DraftCapital = number | "udfa" | null;

/**
 * The facts about a player at a season that are not production — the three
 * windowless criteria.
 */
export type CompPlayerFacts = {
  age: number;
  /** Seasons of experience entering that season. */
  exp: number;
  /** See {@link DraftCapital}. */
  draft: DraftCapital;
};

/**
 * What the comp did **the following season** — the reason anyone looks at a
 * comp. Only the fields the payoff pane prints cross the wire; `finish` is
 * the positional finish (`WR12`) and is null where the corpus cannot rank it.
 *
 * **`played` is what keeps the outcome distribution honest.** A comp whose
 * player was out of the league the year after is a real outcome and the most
 * important one a reader can be shown — retirement, a career-ending injury, a
 * lost season — so those rows carry `played: false` with zeroes beside it and
 * a null finish. A season whose following year the corpus *cannot* answer for
 * is not a comp at all and never reaches this type: see
 * `shared/player-seasons/corpus`, where the difference between "did nothing"
 * and "we have no data" is decided. Zeroes here are a measurement; they are
 * never a stand-in for an absence.
 */
export type CompNextSeason = {
  ppg: number;
  recyd: number;
  rec: number;
  gp: number;
  finish: string | null;
  /** False where the player has no following-season row in a covered season. */
  played: boolean;
};

/**
 * A player as he stands entering the coming season: his last completed line,
 * the facts about him, and what the market charges for him today.
 */
export type CompSubject = CompPlayerFacts & {
  player_id: string;
  name: string;
  position: string;
  /** The season he is entering — the page's headline year. */
  season: number;
  /** His last completed season, which `line` is. */
  last_season: number;
  line: CompSeasonLine;
  /** Seasons on file up to and including `last_season`. */
  years_on_file: number;
  /**
   * KeepTradeCut's dynasty 1QB value, or null where the board has no row —
   * a fact about the subject *today*, read beside the comps rather than
   * matched against them. See the KTC decision in CLAUDE.md.
   */
  ktc: number | null;
};

/** One (criterion, window) pair the distance ran on, with its weight. */
export type CompPair = {
  criterion: CompCriterionId;
  window: CompWindowId;
  weight: number;
};

/**
 * How one pair read for one comp: the gap in z-units between the comp and
 * the subject, the figure the window actually read off the comp, and **how
 * many seasons that figure was actually averaged over**.
 *
 * `gap` and `read` are both null where the pair could not be read for this
 * row — a null stat on either side — in which case that pair carried no weight
 * in the distance and cost the row weighted coverage.
 *
 * **`used` and `of` are what stop a one-season figure being labelled a
 * two-year average.** `of` is the seasons the window asked for once the row's
 * own series is taken into account (a two-year window over a rookie asks for
 * one), and `used` is how many of them actually carried a value. A windowless
 * criterion — age, draft slot, experience — reads one season by definition and
 * carries `1` in both. See `shared/comps/windows`.
 */
export type CompPairReading = {
  gap: number | null;
  read: number | null;
  /** Seasons that carried a value; null where nothing could be read. */
  used: number | null;
  /** Seasons the window asked for on this row. */
  of: number;
};

/** A historical player-season the subject is compared against, ranked. */
export type CompMatch = CompPlayerFacts & {
  player_id: string;
  name: string;
  position: string;
  season: number;
  /** The comp season's own line — the left pane, never a windowed figure. */
  line: CompSeasonLine;
  /** The season after, measured against `line`. */
  next: CompNextSeason;
  /** Seasons on file up to and including `season`; 1 marks a rookie row. */
  years_on_file: number;
  /** The RMS weighted z-distance. Lower is nearer. */
  distance: number;
  /**
   * The similarity readout, 0–100, calibrated against **this pool's own**
   * distance distribution rather than a constant chosen on a toy corpus —
   * see `shared/comps/similarity`. It ships from the server because the
   * calibration is a statement about the whole eligible pool, which the
   * browser holds only the top `k` of.
   */
  similarity: number;
  /**
   * The share of the requested weight this row could actually be compared on,
   * 0–1. 1 is every enabled criterion answerable on both sides. Below
   * `MIN_WEIGHTED_COVERAGE` a row does not rank at all, so every match here is
   * at or above it. The denominator is the weight the **subject** can be read
   * on, which is what stops a stat missing from the whole corpus — YPRR, say —
   * from disqualifying every candidate in it.
   */
  coverage: number;
  /** Keyed by `pairKey(criterion, window)`, one entry per pair requested. */
  pairs: Record<string, CompPairReading>;
};

/**
 * Which corpus answered. The page says so beside the results.
 *
 * **`unavailable` is a real answer and not an error**: the table has not been
 * loaded and this deployment will not fall back to the sample. It is a 200
 * carrying empty lists, so the page can say what is wrong in its own words
 * rather than printing a failure it cannot explain. A database that cannot be
 * *read* is still a 500 — see `shared/player-seasons/read`.
 */
export type CompCorpusSource = "sample" | "stored" | "unavailable";

/**
 * What produced the rows behind a comp, recorded at load time rather than
 * inferred at read time.
 *
 * The scoring basis is the field this exists for: every `ppg` on the page is
 * on one basis for the whole table, and a corpus that cannot say which is a
 * corpus whose numbers cannot be compared to anything. The rest is freshness —
 * which seasons were loaded, when, and by which loader.
 *
 * Null throughout for the sample corpus, whose provenance is a transcription.
 */
export type CompCorpusMeta = {
  /** The loader's own name for the source, e.g. `sleeper-season-stats`. */
  source: string;
  /** The source's version where it publishes one, else null. */
  source_version: string | null;
  /** The fantasy scoring the `pts`/`ppg` columns are on, e.g. `half_ppr`. */
  scoring: string;
  /** The loader/schema version the rows were written by. */
  loader_version: string;
  /** ISO instant of the last load. */
  loaded_at: string;
  /** The seasons the loader actually wrote, ascending. */
  seasons: number[];
  /** The latest season the loader treats as a complete historical outcome. */
  max_completed_season: number;
  rows: number;
  players: number;
};

/**
 * The corpus as a payload describes it: what answered, how fresh it is, and
 * the one string that identifies the build the ranking ran against.
 *
 * `version` is what the caches key on and what a diagnostic quotes; it moves
 * whenever the rows do.
 */
export type CompCorpusInfo = {
  source: CompCorpusSource;
  version: string;
  /** The latest complete season the comps run against, or null when empty. */
  through_season: number | null;
  meta: CompCorpusMeta | null;
};

/** `GET /api/comps/players`: every subject the page can comp, and the corpus's bounds. */
export type CompPlayersPayload = {
  source: CompCorpusSource;
  /** The season subjects are entering. */
  subject_season: number;
  /** The earliest and latest comp seasons on file, and how many there are. */
  corpus: { from: number; to: number; seasons: number };
  /** Provenance: which data, on which scoring basis, loaded when. */
  corpus_info: CompCorpusInfo;
  /** The positions this build can comp; anything else is not offered. */
  positions: string[];
  /** When KeepTradeCut's board was scraped, or null where it did not answer. */
  ktc_updated_at: string | null;
  players: CompSubject[];
};

/**
 * How much of the pool survived each stage, which is the diagnostic that says
 * whether a thin board is a narrow filter or a corpus that cannot answer the
 * criteria asked of it.
 *
 * `eligible` is what the season/position filter left, `ranked` is how many of
 * those cleared {@link CompMatch.coverage}'s minimum, and
 * `excluded_low_coverage` is the difference. `total` is the whole corpus.
 */
export type CompPoolCounts = {
  eligible: number;
  total: number;
  ranked: number;
  excluded_low_coverage: number;
};

/** `GET /api/comps`: the ranked comps for one subject under one set of pairs. */
export type CompsPayload = {
  source: CompCorpusSource;
  /** Echoed so a response can be matched to the question it answers. */
  subject: string | null;
  /** The subject's position, echoed so the panel can preset against it. */
  position: string | null;
  /** How many seasons each stage left. */
  pool: CompPoolCounts;
  /** Provenance: the build the ranking ran against. */
  corpus_info: CompCorpusInfo;
  /** The minimum weighted coverage a row had to clear to rank, 0–1. */
  min_coverage: number;
  /**
   * The share of the requested weight the **subject himself** can be read on.
   * Below 1 the corpus cannot answer some criterion for this player at all —
   * every candidate's coverage is measured against this rather than against
   * the full request, so a stat nobody has does not disqualify everybody.
   */
  subject_coverage: number;
  /** The pairs the distance ran on, echoed in the order the chips draw them. */
  pairs: CompPair[];
  comps: CompMatch[];
};

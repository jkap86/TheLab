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
 * The facts about a player at a season that are not production — the three
 * windowless criteria.
 */
export type CompPlayerFacts = {
  age: number;
  /** Seasons of experience entering that season. */
  exp: number;
  /**
   * Overall draft pick, or null for an undrafted player. The distance reads
   * a null as `UDFA_PICK` — see `shared/comps/criteria` — because "came off
   * the board after everyone" is an ordinal statement rather than an absence.
   */
  draft: number | null;
};

/**
 * What the comp did **the following season** — the reason anyone looks at a
 * comp. Only the fields the payoff pane prints cross the wire; `finish` is
 * the positional finish (`WR12`) and is null where the corpus cannot rank it.
 */
export type CompNextSeason = {
  ppg: number;
  recyd: number;
  rec: number;
  gp: number;
  finish: string | null;
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
 * the subject, and the figure the window actually read off the comp.
 *
 * Both null where the pair could not be read for this row — a null stat on
 * either side — in which case that pair carried no weight in the distance.
 */
export type CompPairReading = {
  gap: number | null;
  read: number | null;
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
  /** Keyed by `pairKey(criterion, window)`, one entry per pair requested. */
  pairs: Record<string, CompPairReading>;
};

/** Which corpus answered. The page says so beside the results. */
export type CompCorpusSource = "sample" | "stored";

/** `GET /api/comps/players`: every subject the page can comp, and the corpus's bounds. */
export type CompPlayersPayload = {
  source: CompCorpusSource;
  /** The season subjects are entering. */
  subject_season: number;
  /** The earliest and latest comp seasons on file, and how many there are. */
  corpus: { from: number; to: number; seasons: number };
  /** When KeepTradeCut's board was scraped, or null where it did not answer. */
  ktc_updated_at: string | null;
  players: CompSubject[];
};

/** `GET /api/comps`: the ranked comps for one subject under one set of pairs. */
export type CompsPayload = {
  source: CompCorpusSource;
  /** Echoed so a response can be matched to the question it answers. */
  subject: string | null;
  /** How many seasons the pool filter left, and how many the corpus holds. */
  pool: { eligible: number; total: number };
  /** The pairs the distance ran on, echoed in the order the chips draw them. */
  pairs: CompPair[];
  comps: CompMatch[];
};

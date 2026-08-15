import type { NflDraftPick } from "./types.ts";

/**
 * The DynastyProcess player-id crosswalk into {@link NflDraftPick} rows.
 *
 * This is the file `nfl_data_py.import_ids()` reads — that function is, in
 * full, a `pandas.read_csv` of one public CSV, which is why the ingest here is
 * TypeScript over the app's own axios instance rather than a second language
 * runtime in the deploy. `scripts/nfl-draft-picks.py` is the same read done
 * through `nfl_data_py` itself, kept as the provenance note and the way to
 * check this parser against the library's own answer.
 *
 * Pure and free of runtime imports, the bar `ktc/parse` and `ktc/match` hold:
 * every rule below is a decision about what a scraped row *means*, and a rule
 * nothing can test is a rule that regresses silently. The failure mode here is
 * not an exception — it is a plausible number filed under the wrong player,
 * which no amount of downstream care can detect.
 */

/** The columns this parser reads. Missing any of them fails the whole file. */
const REQUIRED_COLUMNS = [
  "sleeper_id",
  "draft_year",
  "draft_round",
  "draft_pick",
  "draft_ovr",
] as const;

/**
 * The earliest draft year worth believing. The NFL draft began in 1936, so
 * anything below it is junk rather than history — and junk is what this guard
 * is for: the crosswalk carries a literal `0` in the year column for at least
 * one player, which would otherwise become a draft class.
 */
export const NFL_DRAFT_FIRST_SEASON = 1936;

/**
 * The widest a believable overall pick and round can be.
 *
 * Deliberately generous rather than tuned to the modern seven-round, ~262-pick
 * draft: the crosswalk reaches back to players taken in thirty-round drafts,
 * and a bound cut to today's shape would silently drop them. What this rejects
 * is a value that cannot be a pick at all.
 */
export const NFL_DRAFT_MAX_OVERALL = 600;
export const NFL_DRAFT_MAX_ROUND = 40;

/** Why a candidate row was not stored. Counted, so a source change is visible. */
export type NflDraftRejection =
  | "no_sleeper_id"
  | "bad_season"
  | "bad_pick"
  | "class_pending"
  | "conflicting_duplicate";

export type NflDraftParse = {
  picks: NflDraftPick[];
  /** How many candidate rows fell out, by reason. */
  rejected: Record<NflDraftRejection, number>;
  /**
   * The newest draft class the file shows as actually *held* — the latest
   * season carrying at least one drafted player. See {@link settledClasses}.
   */
  newestSettledSeason: string | null;
};

/**
 * Split CSV text into rows.
 *
 * Written out rather than pulled in because the app has no CSV dependency and
 * this is the only file that needs one. It is RFC 4180 as far as the source
 * actually uses it — quoted fields (college names like `Miami, O.` carry
 * commas), doubled quotes inside them, and either line ending — plus embedded
 * newlines inside a quoted field, which the source does not currently produce
 * and which costs one branch to survive rather than silently splitting a row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote; a lone
        // one closes the field.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (char === ",") {
      endField();
      started = true;
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // CRLF: the \n does the work. A lone \r is a line ending too.
      if (text[i + 1] !== "\n") endRow();
    } else {
      field += char;
      started = true;
    }
  }

  // A file ending without a newline still has a last row; one ending *with* a
  // newline must not gain an empty one.
  if (started || field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * A crosswalk cell as a number, or null.
 *
 * The source spells a missing value `NA` and an occasional one as an empty
 * cell. Both are absent, and `Number("")` is 0 — the trap `parseSteepness`
 * names one module over, and a far worse one here, where 0 would read as a
 * draft class or the pick before the first.
 */
function cell(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "NA" || trimmed === "NaN") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An integer in `[min, max]`, or null — a pick number is never fractional. */
function intIn(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** A candidate row before the class-settled and duplicate rules are applied. */
type Candidate = {
  playerId: string;
  season: string;
  round: number | null;
  slot: number | null;
  overall: number | null;
};

/**
 * The draft classes this file shows as *held*: every season carrying at least
 * one player with an overall pick.
 *
 * This is what separates "went undrafted" from "has not been drafted yet", and
 * it is read off the data rather than off a calendar for the reason
 * `ktcPickBaseSeason` reads its anchor off KTC's own board: which classes exist
 * moves through the year, and a process that has to be told the date is a
 * process that is wrong every spring. A crosswalk listing next year's prospects
 * — which this one does, months before their draft — carries no drafted player
 * in that season, so the season is absent here and those rows are held back
 * instead of being published as undrafted.
 *
 * The consequence worth stating: on the morning of a draft, that class's
 * prospects are unknown rather than undrafted, and they become one or the other
 * as soon as a single pick is recorded. That is the honest reading of a file
 * that says nothing about them yet.
 */
export function settledClasses(candidates: readonly Candidate[]): Set<string> {
  const settled = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.overall !== null) settled.add(candidate.season);
  }
  return settled;
}

/**
 * Parse the crosswalk.
 *
 * Four rules decide what is stored, and each turns a silent wrong answer into a
 * visible absence:
 *
 * - **A row with no Sleeper id is not addressable.** The crosswalk covers every
 *   provider; two thirds of its rows name players Sleeper has never had.
 * - **A drafted row needs a believable round *and* overall.** They come off the
 *   same source row rather than being computed from each other, because
 *   compensatory picks make round sizes uneven — deriving one from the other is
 *   wrong for precisely the players it would be applied to.
 * - **An undrafted row is only stored once its class has been held**
 *   ({@link settledClasses}).
 * - **A Sleeper id claimed twice by rows that disagree is dropped entirely.**
 *   The crosswalk resolves a handful of ids onto two different players who
 *   share a name — one modern, one historical — so the pair carries two draft
 *   positions and nothing in the file says which belongs to the id. Keeping
 *   either would hand a real, plausible pick number to the wrong player, and a
 *   wrong pick is worse than a missing one everywhere this data is read.
 *   Rows that agree are simply folded.
 */
export function parseNflDraftPicks(csv: string): NflDraftParse {
  const rejected: Record<NflDraftRejection, number> = {
    no_sleeper_id: 0,
    bad_season: 0,
    bad_pick: 0,
    class_pending: 0,
    conflicting_duplicate: 0,
  };

  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) {
    return { picks: [], rejected, newestSettledSeason: null };
  }

  const index = new Map<string, number>();
  header.forEach((name, i) => index.set(name.trim(), i));

  const missing = REQUIRED_COLUMNS.filter((name) => !index.has(name));
  if (missing.length > 0) {
    // A renamed column is what a source change looks like from here, and it is
    // silent: every row would simply read as absent and the sync would refuse a
    // board of zero rows with no clue why. Naming the columns is the clue.
    throw new Error(
      `nfl draft crosswalk is missing column(s): ${missing.join(", ")}`,
    );
  }

  const at = (row: string[], name: string): string | undefined =>
    row[index.get(name) as number];

  const candidates: Candidate[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // `parseCsv` never emits a ragged row, but a blank trailing line is one
    // empty field rather than a record.
    if (!row || (row.length === 1 && row[0].trim() === "")) continue;

    const sleeperId = at(row, "sleeper_id")?.trim() ?? "";
    if (sleeperId === "" || sleeperId === "NA") {
      rejected.no_sleeper_id++;
      continue;
    }

    const year = intIn(
      cell(at(row, "draft_year")),
      NFL_DRAFT_FIRST_SEASON,
      // A class a century out is junk; the crosswalk's own newest class is the
      // upcoming one, so the bound only has to exclude nonsense.
      2100,
    );
    if (year === null) {
      rejected.bad_season++;
      continue;
    }

    // **Absent and unusable are different, and collapsing them is the one
    // mistake in this file that would produce a confident wrong answer.** An
    // absent `draft_ovr` is what says a player went undrafted; a *present* one
    // that isn't a believable pick says the column has moved or the row is
    // junk. Reading the second as the first would quietly file a corrupted row
    // under "undrafted" — a real, comparable value — so the raw cell is kept
    // and the two are told apart.
    const rawOverall = cell(at(row, "draft_ovr"));
    const overall = intIn(rawOverall, 1, NFL_DRAFT_MAX_OVERALL);
    if (rawOverall !== null && overall === null) {
      rejected.bad_pick++;
      continue;
    }

    const round = intIn(cell(at(row, "draft_round")), 1, NFL_DRAFT_MAX_ROUND);
    const slot = intIn(cell(at(row, "draft_pick")), 1, NFL_DRAFT_MAX_OVERALL);

    if (overall !== null && round === null) {
      // Half a drafted row. The schema refuses it and so does this: a pick with
      // no round would have to have one invented, and the invention is exactly
      // the arithmetic compensatory picks break.
      rejected.bad_pick++;
      continue;
    }

    candidates.push({
      playerId: sleeperId,
      season: String(year),
      round: overall === null ? null : round,
      slot: overall === null ? null : slot,
      overall,
    });
  }

  const settled = settledClasses(candidates);
  const newestSettledSeason =
    [...settled].sort().at(-1) ?? null;

  // Fold by player id, dropping any id whose rows disagree.
  //
  // **This runs before the pending-class filter, not after**, because the two
  // ask different questions. A conflict is about the *id* being ambiguous, and
  // an id claimed by two different players is ambiguous whether or not one of
  // those rows happens to be publishable yet. Filtering first would let a
  // held-back row hide the disagreement and publish its twin as though the id
  // were unambiguous — the wrong pick attached to the wrong player, which is
  // the exact outcome the conflict rule exists to prevent.
  const byPlayer = new Map<string, Candidate | null>();
  for (const candidate of candidates) {
    const seen = byPlayer.get(candidate.playerId);
    if (seen === undefined) {
      byPlayer.set(candidate.playerId, candidate);
      continue;
    }
    // Already poisoned by an earlier disagreement — stays poisoned.
    if (seen === null) {
      rejected.conflicting_duplicate++;
      continue;
    }
    if (sameAnswer(seen, candidate)) continue;
    byPlayer.set(candidate.playerId, null);
    // Both rows are lost, not just the second: the first was already counted
    // as a pick, so retiring it here is what keeps the counts honest.
    rejected.conflicting_duplicate += 2;
  }

  const picks: NflDraftPick[] = [];
  for (const candidate of byPlayer.values()) {
    if (candidate === null) continue;
    // Only now: an undrafted row is publishable once its class has been held.
    if (candidate.overall === null && !settled.has(candidate.season)) {
      rejected.class_pending++;
      continue;
    }
    picks.push(candidate);
  }

  return { picks, rejected, newestSettledSeason };
}

/** Whether two rows for one id say the same thing about the same draft. */
function sameAnswer(a: Candidate, b: Candidate): boolean {
  return (
    a.season === b.season && a.overall === b.overall && a.round === b.round
  );
}

import type { DraftCapital } from "@/shared/contract";

/**
 * NFL draft capital by Sleeper id, from a source that actually publishes it.
 *
 * Sleeper's players map — the loader's source for every other fact — carries
 * no draft position, so until this landed `player_seasons.draft_pick` was null
 * on every row and the page read every null as "undrafted": a corpus in which
 * Ja'Marr Chase was a UDFA. What fills the column is DynastyProcess's player
 * id crosswalk, the ffverse ecosystem's own join table, which carries a
 * `sleeper_id` beside `draft_year`, `draft_round`, `draft_pick` and
 * `draft_ovr` for some six thousand players — and which is what
 * `loader/facts` has been naming as the source that would fill this column
 * "with no other change" since the column existed.
 *
 * **Three states come out of two columns, and the reading is the whole
 * module.** `draft_ovr` is the overall pick where a player was drafted;
 * `draft_year` is the year he entered the league, drafted or not. So a row
 * with a year and no overall pick is a player the file *knows* went undrafted
 * — Austin Ekeler is `2017, NA, NA, NA` — where a Sleeper id the file has no
 * row for is a player it knows nothing about. The first is `"udfa"` and the
 * second is absent from the map, and the distance and the page read the two
 * differently. Folding them is the bug this exists to fix.
 *
 * **A Sleeper id the file lists twice with two answers is left unknown**, on
 * the KTC matcher's rule: an ambiguous row resolves to nobody rather than to
 * whichever copy came last. Two rows that agree are one answer.
 *
 * **A file whose header lacks the columns is refused rather than read as
 * empty.** An empty map is indistinguishable from a file nobody could parse,
 * and a load that wrote a whole season of unknowns off a renamed column would
 * be this bug again with a different cause. The loader fails the load on it,
 * which is the same call `sleeper-source` makes for a week that will not
 * fetch.
 *
 * Pure — the one line that reaches the network is `./draft-fetch`, kept apart
 * so this resolves under Node's own runner; {@link parseDraftCapital} is what
 * the tests drive.
 */

/** Where the crosswalk is published. A CSV of ~2.5MB, refreshed by its authors. */
export const DRAFT_SOURCE_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/** The source's name for the load report. */
export const DRAFT_SOURCE_NAME = "dynastyprocess-db_playerids";

/** A known answer: the overall pick, or the word for a known UDFA. Never null. */
export type KnownDraftCapital = Exclude<DraftCapital, null>;

/** What a load needs: draft capital keyed by Sleeper id, for every id the source knows. */
export type DraftCapitalSource = () => Promise<ReadonlyMap<string, KnownDraftCapital>>;

export type ParsedDraftCapital = {
  capital: Map<string, KnownDraftCapital>;
  /** Sleeper ids the file listed more than once with answers that disagree. */
  conflicts: string[];
  /** Rows read, including the ones that named no Sleeper id. */
  rows: number;
};

/** The columns the reading needs; a header missing any of them is refused. */
const REQUIRED_COLUMNS = ["sleeper_id", "draft_year", "draft_ovr"] as const;

/** The widest board a pick can plausibly sit on; anything past it is junk. */
const MAX_PICK = 500;

export function parseDraftCapital(csv: string): ParsedDraftCapital {
  const records = parseCsv(csv);
  if (records.length === 0) throw new Error("draft capital source is empty");

  const header = records[0];
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  for (const column of REQUIRED_COLUMNS) {
    if (!index.has(column)) {
      throw new Error(`draft capital source has no "${column}" column`);
    }
  }
  const at = (record: readonly string[], column: (typeof REQUIRED_COLUMNS)[number]) =>
    cell(record[index.get(column)!]);

  const capital = new Map<string, KnownDraftCapital>();
  const conflicted = new Set<string>();
  let rows = 0;

  for (const record of records.slice(1)) {
    // A trailing newline parses as one empty record; nothing to read there.
    if (record.length === 1 && record[0] === "") continue;
    rows++;

    const sleeperId = at(record, "sleeper_id");
    if (sleeperId === null || !/^\d+$/.test(sleeperId)) continue;

    const answer = readCapital(at(record, "draft_year"), at(record, "draft_ovr"));
    if (answer === null) continue;

    if (conflicted.has(sleeperId)) continue;
    const held = capital.get(sleeperId);
    if (held === undefined) {
      capital.set(sleeperId, answer);
    } else if (held !== answer) {
      capital.delete(sleeperId);
      conflicted.add(sleeperId);
    }
  }

  return { capital, conflicts: [...conflicted].sort(), rows };
}

/**
 * The three-state reading of a row's two draft columns. A year with no
 * overall pick is a known UDFA; an overall pick is the pick; neither is
 * nothing to say — which is *not* "undrafted", and is why it answers null
 * here and is left out of the map rather than written in as one.
 */
function readCapital(year: string | null, overall: string | null): KnownDraftCapital | null {
  if (overall !== null) {
    const pick = Number(overall);
    if (Number.isInteger(pick) && pick >= 1 && pick <= MAX_PICK) return pick;
    return null;
  }
  if (year !== null && /^\d{4}$/.test(year)) return "udfa";
  return null;
}

/** A cell's value, with R's `NA` and an empty string both read as absent. */
function cell(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === "" || value === "NA" ? null : value;
}

/**
 * RFC 4180, enough of it: comma-separated records, CRLF or LF, and fields in
 * double quotes that may contain commas, newlines and doubled quotes. The
 * file quotes a handful of names and nothing else, and a split on commas
 * would shear those rows one column to the right — which, in a file whose
 * columns are read by name, puts one player's draft pick under another's id.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

import type { CompSeasonLine } from "@/shared/contract";

import type { CompCorpus, CorpusSeason, CorpusSubject } from "./corpus";

/**
 * The sample corpus: twenty-six historical player-seasons and twelve subjects
 * entering 2026, transcribed from the design handoff's prototype.
 *
 * **It is what the page runs on until `player_seasons` is loaded**, and the
 * page says so — `CompCorpusSource` rides both payloads and the result rule
 * prints `Sample corpus` beside the count. Two things about it are worth
 * knowing before reading a number off it:
 *
 * - Every player has at most two seasons on file (the row and the one before
 *   it), so the two career windows agree with the two-year average here. The
 *   handoff names this as the reason the panel's copy says "two per player in
 *   this sample corpus", and that clause comes out with the first stored
 *   corpus.
 * - The figures are half-PPR, and three rows — Chase 2021, Nacua 2023 and
 *   Barkley 2018 — have no prior season at all. **Those are rookie seasons and
 *   not rows of zeroes**: a two-year window over them reads the one season
 *   there is and the card says so.
 *
 * The rows are kept as the prototype's tuples rather than expanded objects so
 * a transcription can be checked against `Comps.dc.html` line for line. The
 * ids are slugs of the names, since the sample predates any Sleeper crosswalk;
 * a stored corpus keys by Sleeper id, which is what lets a subject be priced.
 */

// [name, season, pos, age, draft, ppg, pts, recyd, rec, tgtsh, rush, yprr,
//  snap, gp, exp, next.ppg, next.recyd, next.rec, next.gp, next.finish]
type SeasonTuple = [
  string, number, string, number, number,
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, string,
];

const SEASONS: readonly SeasonTuple[] = [
  ["Cooper Kupp", 2021, "WR", 28, 69, 22.9, 439, 1947, 145, 30, 18, 2.85, 93, 17, 5, 19.9, 812, 75, 9, "WR29"],
  ["Justin Jefferson", 2022, "WR", 23, 22, 21.0, 357, 1809, 128, 30, 0, 2.79, 92, 17, 2, 20.1, 1074, 68, 10, "WR31"],
  ["Davante Adams", 2020, "WR", 28, 53, 24.4, 342, 1374, 115, 32, 0, 2.90, 88, 14, 6, 19.8, 1553, 123, 16, "WR4"],
  ["Tyreek Hill", 2018, "WR", 24, 165, 17.4, 278, 1479, 87, 22, 151, 2.60, 82, 16, 2, 16.5, 860, 58, 12, "WR22"],
  ["Michael Thomas", 2019, "WR", 26, 47, 22.0, 374, 1725, 149, 33, 0, 2.75, 95, 16, 3, 12.1, 438, 40, 7, "WR73"],
  ["A.J. Brown", 2022, "WR", 25, 51, 16.9, 287, 1496, 88, 25, 0, 2.50, 86, 17, 3, 18.7, 1456, 106, 17, "WR5"],
  ["CeeDee Lamb", 2021, "WR", 22, 17, 14.7, 250, 1102, 79, 24, 0, 2.05, 90, 16, 1, 15.2, 1359, 107, 17, "WR9"],
  ["Ja'Marr Chase", 2021, "WR", 21, 5, 16.3, 261, 1455, 81, 24, 0, 2.60, 84, 17, 0, 16.9, 1046, 87, 12, "WR12"],
  ["Amon-Ra St. Brown", 2022, "WR", 23, 112, 16.4, 262, 1161, 106, 26, 25, 2.15, 89, 16, 1, 17.6, 1515, 119, 16, "WR6"],
  ["Garrett Wilson", 2023, "WR", 23, 10, 12.1, 205, 1042, 95, 27, 0, 1.70, 91, 17, 1, 12.9, 1104, 101, 17, "WR21"],
  ["Chris Godwin", 2019, "WR", 24, 84, 18.4, 258, 1333, 86, 24, 0, 2.45, 87, 14, 2, 13.8, 840, 65, 12, "WR34"],
  ["Terry McLaurin", 2022, "WR", 27, 76, 12.6, 214, 1191, 77, 25, 0, 1.95, 92, 17, 3, 12.4, 1002, 79, 17, "WR24"],
  ["Puka Nacua", 2023, "WR", 22, 177, 15.4, 262, 1486, 105, 26, 0, 2.35, 86, 17, 0, 16.8, 990, 79, 11, "WR26"],
  ["Brandon Aiyuk", 2023, "WR", 26, 25, 13.4, 214, 1342, 75, 22, 0, 2.55, 83, 16, 3, 8.8, 374, 25, 7, "WR78"],
  ["DK Metcalf", 2020, "WR", 23, 64, 15.4, 246, 1303, 83, 25, 0, 2.30, 88, 16, 1, 12.4, 967, 75, 17, "WR25"],
  ["Stefon Diggs", 2020, "WR", 27, 146, 18.4, 295, 1535, 127, 29, 0, 2.40, 90, 16, 5, 15.1, 1225, 103, 17, "WR11"],
  ["Mike Evans", 2018, "WR", 25, 7, 15.0, 240, 1524, 86, 24, 0, 2.50, 85, 16, 4, 15.6, 1157, 67, 13, "WR17"],
  ["Nico Collins", 2024, "WR", 25, 89, 16.6, 199, 1006, 68, 27, 0, 2.65, 85, 12, 3, 15.9, 1180, 82, 15, "WR13"],
  ["Tee Higgins", 2021, "WR", 22, 33, 13.6, 191, 1091, 74, 22, 0, 2.10, 82, 14, 1, 13.9, 1029, 74, 15, "WR20"],
  ["Keenan Allen", 2020, "WR", 28, 76, 17.4, 244, 992, 100, 27, 0, 1.85, 89, 14, 7, 14.7, 1138, 106, 16, "WR15"],
  ["Christian McCaffrey", 2019, "RB", 23, 8, 29.4, 471, 1005, 116, 20, 1387, 1.90, 93, 16, 2, 22.0, 149, 17, 3, "RB60"],
  ["Austin Ekeler", 2021, "RB", 26, 260, 22.4, 344, 647, 70, 17, 911, 1.50, 76, 16, 4, 21.0, 722, 107, 17, "RB3"],
  ["Jonathan Taylor", 2021, "RB", 22, 41, 22.4, 373, 360, 40, 9, 1811, 1.20, 68, 17, 1, 12.9, 143, 28, 11, "RB37"],
  ["Bijan Robinson", 2024, "RB", 22, 8, 18.9, 321, 431, 61, 12, 1456, 1.35, 74, 17, 1, 19.4, 510, 65, 16, "RB4"],
  ["Saquon Barkley", 2018, "RB", 21, 2, 24.1, 386, 721, 91, 18, 1307, 1.60, 82, 16, 0, 16.2, 438, 52, 13, "RB18"],
  ["Alvin Kamara", 2020, "RB", 25, 67, 24.2, 363, 756, 83, 19, 932, 1.75, 66, 15, 3, 17.9, 439, 47, 13, "RB21"],
];

// [name, pos, age, draft, ktc, ppg, pts, recyd, rec, tgtsh, rush, yprr, snap, gp, exp]
type SubjectTuple = [
  string, string, number, number, number,
  number, number, number, number, number, number, number, number, number, number,
];

/** Each subject's 2025 line — the season he just finished. */
const SUBJECTS: readonly SubjectTuple[] = [
  ["Puka Nacua", "WR", 24, 177, 7900, 17.2, 258, 1230, 104, 28, 44, 2.40, 88, 15, 2],
  ["Jaxon Smith-Njigba", "WR", 23, 20, 8600, 18.1, 308, 1450, 100, 29, 0, 2.60, 90, 17, 2],
  ["Malik Nabers", "WR", 22, 6, 8400, 14.1, 197, 940, 72, 30, 0, 2.20, 89, 14, 1],
  ["Brian Thomas Jr.", "WR", 23, 23, 7600, 13.2, 224, 1050, 78, 26, 0, 2.05, 87, 17, 1],
  ["Drake London", "WR", 24, 8, 7500, 15.6, 250, 1180, 88, 29, 0, 2.15, 91, 16, 3],
  ["Garrett Wilson", "WR", 25, 10, 6800, 13.8, 234, 1090, 96, 27, 0, 1.85, 90, 17, 3],
  ["Ladd McConkey", "WR", 24, 34, 6600, 13.0, 208, 1010, 82, 24, 0, 2.10, 84, 16, 1],
  ["Rome Odunze", "WR", 23, 9, 6100, 11.4, 194, 880, 66, 21, 0, 1.75, 86, 17, 1],
  ["Marvin Harrison Jr.", "WR", 24, 4, 6300, 12.2, 195, 920, 62, 25, 0, 1.80, 88, 16, 1],
  ["Bijan Robinson", "RB", 24, 8, 9300, 20.1, 342, 480, 66, 13, 1380, 1.40, 76, 17, 2],
  ["Jahmyr Gibbs", "RB", 24, 12, 8900, 19.4, 330, 420, 55, 12, 1250, 1.45, 68, 17, 2],
  ["De'Von Achane", "RB", 24, 84, 8100, 18.6, 298, 590, 74, 16, 980, 1.55, 70, 16, 2],
];

// [ppg, pts, recyd, rec, tgtsh, rush, yprr, snap, gp]
type LineTuple = [number, number, number, number, number, number, number, number, number];

/**
 * The season *before* each comp row's own — what a two-year window reads its
 * second year from. A missing entry is a rookie season (see the module note).
 */
const PREVIOUS: Readonly<Record<string, LineTuple>> = {
  "Cooper Kupp|2021": [13.0, 208, 974, 92, 22, 0, 1.85, 88, 16],
  "Justin Jefferson|2022": [18.1, 289, 1616, 108, 26, 0, 2.55, 91, 17],
  "Davante Adams|2020": [15.6, 200, 997, 83, 27, 0, 2.35, 85, 12],
  "Tyreek Hill|2018": [15.1, 241, 1183, 75, 20, 59, 2.35, 78, 15],
  "Michael Thomas|2019": [18.9, 302, 1405, 125, 30, 0, 2.60, 93, 16],
  "A.J. Brown|2022": [14.3, 186, 869, 63, 22, 0, 2.20, 80, 13],
  "CeeDee Lamb|2021": [13.6, 218, 935, 74, 21, 0, 1.90, 87, 16],
  "Amon-Ra St. Brown|2022": [11.5, 138, 912, 90, 24, 12, 1.80, 72, 12],
  "Garrett Wilson|2023": [12.0, 156, 1103, 83, 25, 0, 1.80, 86, 13],
  "Chris Godwin|2019": [9.5, 152, 842, 59, 17, 0, 1.90, 74, 16],
  "Terry McLaurin|2022": [13.9, 236, 1053, 77, 27, 0, 1.90, 91, 17],
  "Brandon Aiyuk|2023": [11.9, 202, 1015, 78, 20, 0, 2.10, 82, 17],
  "DK Metcalf|2020": [11.1, 178, 900, 58, 20, 0, 2.00, 82, 16],
  "Stefon Diggs|2020": [13.0, 195, 1130, 63, 22, 0, 2.30, 84, 15],
  "Mike Evans|2018": [13.4, 201, 1001, 71, 24, 0, 2.10, 84, 15],
  "Nico Collins|2024": [14.1, 226, 1297, 80, 22, 0, 2.55, 83, 15],
  "Tee Higgins|2021": [12.8, 205, 908, 67, 21, 0, 1.95, 80, 16],
  "Keenan Allen|2020": [15.3, 245, 1199, 104, 26, 0, 2.05, 90, 16],
  "Christian McCaffrey|2019": [21.4, 342, 867, 107, 19, 1098, 1.80, 90, 16],
  "Austin Ekeler|2021": [17.5, 175, 403, 54, 18, 530, 1.55, 62, 10],
  "Jonathan Taylor|2021": [16.5, 247, 299, 36, 9, 1169, 1.15, 60, 15],
  "Bijan Robinson|2024": [15.6, 265, 487, 58, 13, 976, 1.30, 70, 17],
  "Alvin Kamara|2020": [17.4, 244, 533, 81, 18, 797, 1.70, 62, 14],
};

/** Each subject's 2024 line, on the same nine fields. */
const SUBJECT_PREVIOUS: Readonly<Record<string, LineTuple>> = {
  "Puka Nacua": [16.8, 185, 990, 79, 27, 20, 2.45, 87, 11],
  "Jaxon Smith-Njigba": [14.5, 246, 1130, 100, 24, 0, 2.15, 88, 17],
  "Malik Nabers": [15.0, 225, 1204, 109, 32, 0, 2.30, 90, 15],
  "Brian Thomas Jr.": [15.4, 262, 1282, 87, 25, 0, 2.40, 88, 17],
  "Drake London": [14.9, 253, 1271, 100, 28, 0, 2.05, 92, 17],
  "Garrett Wilson": [12.9, 219, 1104, 101, 26, 0, 1.80, 91, 17],
  "Ladd McConkey": [13.1, 210, 1149, 82, 25, 0, 2.25, 82, 16],
  "Rome Odunze": [9.8, 167, 734, 54, 19, 0, 1.55, 85, 17],
  "Marvin Harrison Jr.": [11.0, 187, 885, 62, 24, 0, 1.75, 86, 17],
  "Bijan Robinson": [18.9, 321, 431, 61, 12, 1456, 1.35, 74, 17],
  "Jahmyr Gibbs": [19.2, 326, 517, 52, 12, 1412, 1.50, 62, 17],
  "De'Von Achane": [17.2, 292, 592, 78, 17, 907, 1.60, 66, 17],
};

/** The season subjects are entering; their line is the one before it. */
const SAMPLE_SUBJECT_SEASON = 2026;

function lineOf(t: LineTuple): CompSeasonLine {
  return {
    ppg: t[0],
    pts: t[1],
    recyd: t[2],
    rec: t[3],
    tgtsh: t[4],
    rush: t[5],
    yprr: t[6],
    snap: t[7],
    gp: t[8],
  };
}

function slug(name: string): string {
  return `sample:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function seasonOf(t: SeasonTuple): CorpusSeason {
  const [name, season, position, age, draft, ...rest] = t;
  const own = lineOf(rest.slice(0, 9) as LineTuple);
  const prev = PREVIOUS[`${name}|${season}`];
  return {
    player_id: slug(name),
    name,
    position,
    season,
    facts: { age, exp: rest[9], draft },
    history: prev ? [own, lineOf(prev)] : [own],
    next: { ppg: rest[10], recyd: rest[11], rec: rest[12], gp: rest[13], finish: rest[14] },
  };
}

function subjectOf(t: SubjectTuple): CorpusSubject {
  const [name, position, age, draft, ktc, ...rest] = t;
  const own = lineOf(rest.slice(0, 9) as LineTuple);
  const prev = SUBJECT_PREVIOUS[name];
  return {
    player_id: slug(name),
    name,
    position,
    last_season: SAMPLE_SUBJECT_SEASON - 1,
    facts: { age, exp: rest[9], draft },
    history: prev ? [own, lineOf(prev)] : [own],
    ktc,
  };
}

/** The sample corpus, built once at module load. */
export const SAMPLE_CORPUS: CompCorpus = {
  source: "sample",
  subject_season: SAMPLE_SUBJECT_SEASON,
  seasons: SEASONS.map(seasonOf),
  subjects: SUBJECTS.map(subjectOf),
};

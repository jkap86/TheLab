import type {
  CompCriterionId,
  CompStatField,
  CompWindowId,
} from "@/shared/contract";

/**
 * The comps vocabulary: the eleven criteria, the four windows, and the rules
 * that say which of the first take the second.
 *
 * **Pure, with a type-only import**, and deep-imported by the client for it —
 * the criteria panel draws its keys from these tables and the route validates
 * a request against them, and the two must be one spelling. It is the
 * arrangement `shared/ktc/roster` and `shared/projections/slots` already live
 * under: this folder's barrel is equally pure (nothing in `shared/comps`
 * reaches Postgres — the corpus reads live in `shared/player-seasons`), so a
 * `"use client"` module may import the barrel itself.
 */

/** One of the four windows, with every spelling the page prints it under. */
export type CompWindow = {
  id: CompWindowId;
  /** The window key's face: `1Y`, `2Y`, `CAR`, `BEST`. */
  key: string;
  /** The weight row's full label. */
  label: string;
  /** The comp card's chip tag. */
  tag: string;
};

/**
 * The windows in **canonical order**. An arriving window is inserted here
 * rather than appended, so the weight rails under a criterion always read
 * top-down in the same order as the keys above them.
 */
export const WINDOWS: readonly CompWindow[] = [
  { id: "last", key: "1Y", label: "Last year", tag: "last yr" },
  { id: "avg2", key: "2Y", label: "2 year average", tag: "2 yr" },
  { id: "cavg", key: "CAR", label: "Career average", tag: "career" },
  { id: "chigh", key: "BEST", label: "Career high", tag: "best" },
];

export const WINDOW_IDS: readonly CompWindowId[] = WINDOWS.map((w) => w.id);

/** A window arriving on a criterion takes this weight until the reader moves it. */
export const DEFAULT_PAIR_WEIGHT = 1;

/** The weight rail's bounds: 0.2–3 in steps of 0.2. */
export const WEIGHT_MIN = 0.2;
export const WEIGHT_MAX = 3;
export const WEIGHT_STEP = 0.2;

/** How many comps the board returns: 3–25, default 10. */
export const K_MIN = 3;
export const K_MAX = 25;
export const DEFAULT_K = 10;

/**
 * The column a windowless criterion reads. Age, draft slot and experience are
 * facts about the player *at* a season rather than production, so a window
 * over them would be a question with no meaning.
 */
export type CompFactField = "age" | "draft" | "exp";

export type CompField = CompStatField | CompFactField;

/** One weighted window on a criterion — the unit the distance runs on. */
export type WeightedWindow = { id: CompWindowId; w: number };

/**
 * One criterion as the panel holds it: its vocabulary, the columns it reads,
 * and its state.
 *
 * `fields` is why a criterion is not simply a column — "Rec yd / rec" is one
 * thing a reader weights and two columns the distance reads, and its gap is
 * the *mean* of its fields' z-gaps so a two-column criterion does not outweigh
 * a one-column one. `wins` is a set of weighted windows, and the weight lives
 * on the pair rather than the criterion: "PPG last year" at 1.6 and "PPG
 * career best" at 0.8 are two dimensions with two influences.
 *
 * A windowed criterion's `wins` is **never empty** — the last window key is
 * disabled rather than the state being corrected afterwards. A windowless
 * criterion carries exactly `[{ id: "last", … }]`, which is what lets one
 * shape serve both: its one "window" is the row's own season, which is the
 * only reading a fact has.
 */
export type CompCriterion = {
  id: CompCriterionId;
  /** The panel key's label. */
  label: string;
  /** The chip's label. */
  short: string;
  fields: readonly CompField[];
  on: boolean;
  wins: readonly WeightedWindow[];
};

/**
 * The eleven criteria with their default state — the table the panel opens on.
 *
 * **KTC is deliberately not here.** A comp criterion has to be readable off
 * the comp season, and a 2019 market price is not recoverable: `ktc_values`
 * is a current-value table, and dynasty value in 2019 was never recorded in a
 * form this app can query. The alternatives were worse — match only on
 * seasons since the sync began, or synthesise a historical value from draft
 * capital and production and then match on the number we invented. So KTC
 * stays a fact about the subject, on his plate, as what the market charges
 * for him today. If it is ever wanted in the distance, the honest route is
 * snapshotting forward from now and letting the criterion appear once there
 * are seasons with real values behind it.
 */
export const CRITERIA: readonly CompCriterion[] = [
  { id: "age", label: "Age", short: "Age", fields: ["age"], on: true, wins: [{ id: "last", w: 1.4 }] },
  { id: "draft", label: "Draft capital", short: "Draft", fields: ["draft"], on: true, wins: [{ id: "last", w: 0.6 }] },
  { id: "ppg", label: "Fantasy PPG", short: "PPG", fields: ["ppg"], on: true, wins: [{ id: "last", w: 1.6 }, { id: "chigh", w: 0.8 }] },
  { id: "pts", label: "Total points", short: "Pts", fields: ["pts"], on: false, wins: [{ id: "last", w: 1 }] },
  { id: "recyd", label: "Rec yd / rec", short: "Rec yd", fields: ["recyd", "rec"], on: true, wins: [{ id: "last", w: 1 }] },
  { id: "tgtsh", label: "Target share", short: "Tgt sh", fields: ["tgtsh"], on: true, wins: [{ id: "last", w: 1 }] },
  { id: "rush", label: "Rush yards", short: "Rush", fields: ["rush"], on: false, wins: [{ id: "last", w: 1 }] },
  { id: "yprr", label: "Yards / route", short: "YPRR", fields: ["yprr"], on: true, wins: [{ id: "avg2", w: 1 }] },
  { id: "snap", label: "Snap share", short: "Snap", fields: ["snap"], on: false, wins: [{ id: "last", w: 0.8 }] },
  { id: "gp", label: "Games played", short: "GP", fields: ["gp"], on: false, wins: [{ id: "last", w: 0.6 }] },
  { id: "exp", label: "Years exp", short: "Exp", fields: ["exp"], on: true, wins: [{ id: "last", w: 0.8 }] },
];

export const CRITERION_IDS: readonly CompCriterionId[] = CRITERIA.map((c) => c.id);

/** The nine production fields a window applies to. */
export const WINDOW_FIELDS: readonly CompStatField[] = [
  "ppg",
  "pts",
  "recyd",
  "rec",
  "tgtsh",
  "rush",
  "yprr",
  "snap",
  "gp",
];

export function isStatField(field: CompField): field is CompStatField {
  return (WINDOW_FIELDS as readonly string[]).includes(field);
}

/** Whether a criterion takes a window — every field it reads is production. */
export function isWindowed(criterion: Pick<CompCriterion, "fields">): boolean {
  return criterion.fields.every(isStatField);
}

/**
 * The pick an undrafted player is read as, one past the last pick a
 * seven-round draft can hold. "Came off the board after everyone" is an
 * ordinal statement about draft capital rather than an absence, which is why
 * it enters the distance where a null target share does not — and the subject
 * grid prints it as `UDFA`, never as a number, from the same constant.
 */
export const UDFA_PICK = 260;

export function criterionById(id: CompCriterionId): CompCriterion {
  const found = CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown comp criterion: ${id}`);
  return found;
}

export function windowById(id: CompWindowId): CompWindow {
  const found = WINDOWS.find((w) => w.id === id);
  if (!found) throw new Error(`Unknown comp window: ${id}`);
  return found;
}

export function isCriterionId(value: string): value is CompCriterionId {
  return (CRITERION_IDS as readonly string[]).includes(value);
}

export function isWindowId(value: string): value is CompWindowId {
  return (WINDOW_IDS as readonly string[]).includes(value);
}

/**
 * The one spelling of a pair's key — `ppg:chigh` — which the route writes into
 * `CompMatch.pairs` and the chip reads back out. Spelled twice is a chip
 * drawing a gap for a pair the distance did not run.
 */
export function pairKey(criterion: CompCriterionId, window: CompWindowId): string {
  return `${criterion}:${window}`;
}

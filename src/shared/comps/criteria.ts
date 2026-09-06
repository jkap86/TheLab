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

/**
 * The positions this feature can comp, and the reason the list is short.
 *
 * `player_seasons` is the criteria table and nothing else, so what a comp can
 * be run on is exactly what those thirteen columns describe: fantasy
 * production, receiving, rushing, snaps, and the three facts. A kicker or a
 * defence has none of that in a form these criteria read, so they are not
 * offered as subjects rather than being offered and quietly compared on
 * columns that are zero for all of them — the failure this list exists to
 * prevent. A position outside it is a 404 from the comps route, not a WR
 * comparison wearing somebody else's name.
 */
export const COMP_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type CompPosition = (typeof COMP_POSITIONS)[number];

export function isCompPosition(position: string): position is CompPosition {
  return (COMP_POSITIONS as readonly string[]).includes(position);
}

/**
 * Which criteria mean something for a position.
 *
 * **A quarterback is the case this exists for.** The corpus carries no passing
 * column — the schema is the criteria table, and no criterion reads one — so a
 * QB comp runs on fantasy production, rushing, snaps and the three facts.
 * Receiving yards, target share and yards per route are not merely weak for a
 * quarterback; they are zero or null for every one of them, which would make a
 * receiving criterion a constant the distance cannot learn anything from while
 * still looking, in the panel, like a question that was asked. So they are not
 * offered.
 *
 * Rushing is the mirror image and is offered everywhere, because a receiver
 * with carries is a real and rare thing rather than a category error.
 *
 * The route does **not** reject a pair that falls outside this list. A
 * criterion that means nothing for a position still has a defined reading, the
 * panel cannot produce such a request, and a 400 on a URL nothing generates is
 * a failure mode bought for no protection. What this governs is what is
 * *offered*, which is where the silence would otherwise be.
 */
export const POSITION_CRITERIA: Record<CompPosition, readonly CompCriterionId[]> = {
  QB: ["age", "draft", "ppg", "pts", "rush", "snap", "gp", "exp"],
  RB: ["age", "draft", "ppg", "pts", "recyd", "tgtsh", "rush", "yprr", "snap", "gp", "exp"],
  WR: ["age", "draft", "ppg", "pts", "recyd", "tgtsh", "rush", "yprr", "snap", "gp", "exp"],
  TE: ["age", "draft", "ppg", "pts", "recyd", "tgtsh", "rush", "yprr", "snap", "gp", "exp"],
};

export function criterionAppliesTo(
  criterion: CompCriterionId,
  position: string,
): boolean {
  if (!isCompPosition(position)) return true;
  return POSITION_CRITERIA[position].includes(criterion);
}

/**
 * What each position's panel opens on, as `criterion -> the windows it reads`.
 * A criterion absent from a preset is off; one present is on with those
 * weighted windows.
 *
 * **The defaults were receiving-centric for every position, and that was
 * wrong for two of the four.** A running back compared on target share and
 * yards per route is being asked a receiver's question: those two decide
 * almost nothing about a back's season and the two that do — carries and
 * rushing yards — were switched off. So `rush` is heavy for an RB, `recyd`
 * (which reads receptions beside yards, and pass-catching backs are the ones
 * whose comps matter) keeps real weight, and `yprr` drops to a supporting
 * figure rather than a headline one. A quarterback's preset is what his
 * columns can actually answer.
 *
 * WR and TE are two entries rather than one for a reason worth stating: they
 * are close today and the difference is deliberate — a tight end's target
 * share is a larger share of what decides his season than a receiver's, and
 * his rushing is not a signal at all. Sharing one entry would make the day
 * they diverge an edit to a name rather than to a table.
 *
 * `WR` is byte-for-byte the state {@link CRITERIA} declares, which is what
 * keeps "the panel's own defaults" and "the WR preset" one thing rather than
 * two that can drift.
 */
export const POSITION_PRESETS: Record<
  CompPosition,
  Readonly<Partial<Record<CompCriterionId, readonly WeightedWindow[]>>>
> = {
  WR: {
    age: [{ id: "last", w: 1.4 }],
    draft: [{ id: "last", w: 0.6 }],
    ppg: [{ id: "last", w: 1.6 }, { id: "chigh", w: 0.8 }],
    recyd: [{ id: "last", w: 1 }],
    tgtsh: [{ id: "last", w: 1 }],
    yprr: [{ id: "avg2", w: 1 }],
    exp: [{ id: "last", w: 0.8 }],
  },
  TE: {
    age: [{ id: "last", w: 1.4 }],
    draft: [{ id: "last", w: 0.6 }],
    ppg: [{ id: "last", w: 1.6 }, { id: "chigh", w: 0.8 }],
    recyd: [{ id: "last", w: 1 }],
    tgtsh: [{ id: "last", w: 1.2 }],
    yprr: [{ id: "avg2", w: 1 }],
    snap: [{ id: "last", w: 0.8 }],
    exp: [{ id: "last", w: 0.8 }],
  },
  RB: {
    age: [{ id: "last", w: 1.4 }],
    draft: [{ id: "last", w: 0.6 }],
    ppg: [{ id: "last", w: 1.6 }, { id: "chigh", w: 0.8 }],
    rush: [{ id: "last", w: 1.6 }, { id: "avg2", w: 0.8 }],
    recyd: [{ id: "last", w: 1 }],
    tgtsh: [{ id: "last", w: 0.6 }],
    yprr: [{ id: "avg2", w: 0.4 }],
    snap: [{ id: "last", w: 0.8 }],
    exp: [{ id: "last", w: 0.8 }],
  },
  QB: {
    age: [{ id: "last", w: 1.4 }],
    draft: [{ id: "last", w: 0.6 }],
    ppg: [{ id: "last", w: 1.6 }, { id: "chigh", w: 0.8 }],
    pts: [{ id: "last", w: 0.8 }],
    rush: [{ id: "last", w: 1.2 }, { id: "avg2", w: 0.6 }],
    gp: [{ id: "last", w: 0.6 }],
    exp: [{ id: "last", w: 0.8 }],
  },
};

/**
 * The criteria table a position's panel opens on: every criterion in canonical
 * order, switched on with the preset's windows where the preset names it and
 * off with {@link CRITERIA}'s own windows where it does not.
 *
 * A criterion that does not apply to the position (see
 * {@link POSITION_CRITERIA}) comes back off, whatever the preset says, so one
 * table cannot both offer and hide the same key.
 *
 * A position with no preset — nothing outside {@link COMP_POSITIONS} is
 * offered as a subject, so this is the null-subject case rather than an
 * unknown-position one — falls back to {@link CRITERIA} exactly, which is what
 * the panel showed before it knew whose comps it was configuring.
 */
export function defaultCriteriaFor(position: string | null): CompCriterion[] {
  const preset =
    position !== null && isCompPosition(position) ? POSITION_PRESETS[position] : null;
  if (!preset) return CRITERIA.map((c) => ({ ...c, wins: c.wins.map((w) => ({ ...w })) }));

  return CRITERIA.map((criterion) => {
    const wins = preset[criterion.id];
    const applies = criterionAppliesTo(criterion.id, position!);
    return {
      ...criterion,
      on: applies && wins !== undefined,
      wins: (wins ?? criterion.wins).map((w) => ({ ...w })),
    };
  });
}

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

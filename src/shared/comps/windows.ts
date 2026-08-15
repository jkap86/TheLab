import { compsField, compsFieldTakesWindow } from "./fields.ts";

import type { CompsField } from "./fields.ts";
import type { CompsSeasonPool } from "./career.ts";
import type { CompsBasis } from "./filters.ts";
import type { CompsPoolRow } from "./knn.ts";

/**
 * Which seasons a stat is read over — the second axis of a comparison.
 *
 * A comp's subject is a player-*season*, so every field used to mean "that
 * season's number" and nothing else. That answers "who else had a year like
 * this" and cannot answer "who else arrived here the same way": a 900-yard
 * season off three quiet ones is a different player from a 900-yard season off
 * three loud ones, and the two were indistinguishable. A window is the reader
 * saying which stretch of career each stat should describe, per stat — targets
 * over the last three years beside a snap share from this one is a legitimate
 * and common question.
 *
 * Three rules hold the set up, and each is the difference between a number and
 * a number that means something:
 *
 * - **A pooled window is one long season, never an average of seasons.** Three
 *   years of targets per game is total targets over total games, so a 4-game
 *   season weighs a quarter of a 16-game one rather than half of the pair (and
 *   under season totals it is the three years' sum, which is what that basis
 *   plus that label say together) — the
 *   rule `aggregate.ts` already keeps for the horizon and `career_ppg` for
 *   career form. That is why every field this applies to is expressed as a
 *   ratio (`assemble.ts` writes the components onto `rates`), so pooling is
 *   Σnumerator / Σdenominator and a target share pools *exactly* rather than
 *   being averaged into an approximation of itself.
 * - **`prev*` is strictly prior and `career_*` includes the anchor.** Both
 *   readings are what the words say, which is the whole argument: "his previous
 *   three years" excludes the season in hand and "his career best" would be a
 *   lie if it excluded the season that *was* his best. There is no leak in the
 *   inclusive half — the default window is the anchor season itself, so its
 *   outcome is already on the board.
 * - **A window answers from the seasons that are stored, or answers null.** A
 *   second-year player's "prev 3 years" is his one prior season: under totals
 *   that is honestly less production over the span, and under per-game it is
 *   the rate he actually posted. No stored season in the span at all is null —
 *   the rookie rule, `career_ppg`'s own, and it is what excludes those seasons
 *   from a windowed comparison rather than floating them in at zero.
 *
 * Corpus-relative, like every other cross-season number here: "career" reaches
 * as far as the stats archive has backfilled, so a window deepens as older
 * seasons land.
 */

export const COMPS_WINDOW_KEYS = [
  "season",
  "prev1",
  "prev2",
  "prev3",
  "prev3_best",
  "career_best",
  "career_worst",
] as const;

export type CompsWindowKey = (typeof COMPS_WINDOW_KEYS)[number];

export type CompsWindow = {
  key: CompsWindowKey;
  /** The option's own name, in the picker. */
  label: string;
  /** The suffix a value wears where it is read beside others: "prev 3 yrs". */
  short: string;
  /**
   * How far back the window reaches from the anchor season, in seasons;
   * `"career"` is every stored season with no lower bound.
   */
  span: number | "career";
  /**
   * `pooled` combines its seasons into one line; `best`/`worst` take the
   * extreme single season under the basis. `single` is the anchor season
   * itself — the default, and the one window that reads a row's own value
   * rather than deriving anything.
   */
  kind: "single" | "pooled" | "best" | "worst";
  /** Whether the anchor season is one of the window's own seasons. */
  includesAnchor: boolean;
};

export const DEFAULT_COMPS_WINDOW: CompsWindowKey = "season";

export const COMPS_WINDOWS: readonly CompsWindow[] = [
  {
    key: "season",
    label: "This season",
    short: "this season",
    span: 0,
    kind: "single",
    includesAnchor: true,
  },
  {
    key: "prev1",
    label: "Prev year",
    short: "prev yr",
    span: 1,
    kind: "pooled",
    includesAnchor: false,
  },
  {
    key: "prev2",
    label: "Prev 2 yrs",
    short: "prev 2 yrs",
    span: 2,
    kind: "pooled",
    includesAnchor: false,
  },
  {
    key: "prev3",
    label: "Prev 3 yrs",
    short: "prev 3 yrs",
    span: 3,
    kind: "pooled",
    includesAnchor: false,
  },
  {
    key: "prev3_best",
    label: "Prev 3 best",
    short: "best of prev 3",
    span: 3,
    kind: "best",
    includesAnchor: false,
  },
  {
    key: "career_best",
    label: "Career best",
    short: "career best",
    span: "career",
    kind: "best",
    includesAnchor: true,
  },
  {
    key: "career_worst",
    label: "Career worst",
    short: "career worst",
    span: "career",
    kind: "worst",
    includesAnchor: true,
  },
];

const byKey = new Map(COMPS_WINDOWS.map((window) => [window.key, window]));

export function compsWindow(key: string): CompsWindow | undefined {
  return byKey.get(key as CompsWindowKey);
}

export function isCompsWindow(value: string): value is CompsWindowKey {
  return byKey.has(value as CompsWindowKey);
}

/**
 * The separator between a field and its window in a *dimension* key.
 *
 * `@` is not in any catalogue key and never in a stat key, so the split is
 * unambiguous; it never reaches a query string either — the wire carries
 * `fields=` and `windows=` as parallel lists, the `weights=` precedent — so
 * this spelling lives entirely inside the payload, where it keys `values`,
 * `excluded_missing` and the field specs.
 */
const SEPARATOR = "@";

/**
 * A field under a window, as one key. The default window spells as the bare
 * field key, which is what makes every unwindowed request — and every stored
 * board written before windows existed — byte-for-byte what it was.
 */
export function compsDimensionKey(
  field: string,
  window: CompsWindowKey,
): string {
  return window === DEFAULT_COMPS_WINDOW ? field : `${field}${SEPARATOR}${window}`;
}

/**
 * A dimension key back into its halves. A key with no separator, or one whose
 * suffix names no window, reads as the whole key under the default window —
 * these are built here and never parsed from user input, so being lenient
 * costs nothing and mislabelling a field would cost a reader.
 */
export function parseCompsDimensionKey(key: string): {
  field: string;
  window: CompsWindowKey;
} {
  const at = key.lastIndexOf(SEPARATOR);
  if (at <= 0) return { field: key, window: DEFAULT_COMPS_WINDOW };
  const suffix = key.slice(at + 1);
  if (!isCompsWindow(suffix)) return { field: key, window: DEFAULT_COMPS_WINDOW };
  return { field: key.slice(0, at), window: suffix };
}

/**
 * How a dimension is named on screen: the catalogue's label, plus the window
 * where it isn't the season's own. One spelling for the summary line, the
 * comparison table and the dropped-field note, so a stat can't be called two
 * things on one page.
 */
export function compsDimensionLabel(key: string): string {
  const { field, window } = parseCompsDimensionKey(key);
  const label = compsField(field)?.label ?? field;
  return window === DEFAULT_COMPS_WINDOW
    ? label
    : `${label} · ${compsWindow(window)?.short ?? window}`;
}

/**
 * A field's value on one season as a ratio, so windows pool it exactly.
 *
 * `d: null` is the third state and it is what carries the `total` basis: the
 * quantity is *additive*, so a window over it sums and divides by nothing.
 * "His previous three years' targets" under season totals is 300, and the 100
 * a per-season mean would report is a different number under a label that says
 * totals. The cost is stated rather than hidden — a total over a span is
 * smaller for a player with less of that span stored, which is true of him and
 * also true of a season near the archive's own floor, the corpus-relative
 * caveat every cross-season number here already carries.
 */
function seasonRatio(
  row: CompsPoolRow,
  field: CompsField,
  basis: CompsBasis,
): { n: number; d: number | null } | null {
  // A derived field is already a rate and carries its own components — the
  // player's count over his team's, or over his snaps — so pooling it is
  // Σnumerator / Σdenominator and never a mean of the seasons' rates. A row
  // assembled without them (or a season whose feed can't answer the field)
  // simply doesn't contribute.
  if (field.derived === true) return row.rates?.[field.key] ?? null;

  const raw = row.values[field.key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // The basis is applied *inside* the window, which is the whole point: three
  // years per game is the summed totals over the summed games, not the mean of
  // three per-game seasons.
  return { n: raw, d: field.perGame && basis === "per_game" ? row.games : null };
}

const value = (ratio: { n: number; d: number | null } | null): number | null => {
  if (ratio === null) return null;
  if (ratio.d === null) return ratio.n;
  return ratio.d > 0 ? ratio.n / ratio.d : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The seasons a window reaches, given the anchor year. */
function inWindow(window: CompsWindow, year: number, anchor: number): boolean {
  if (year > anchor) return false;
  if (year === anchor) return window.includesAnchor;
  return window.span === "career" || year >= anchor - window.span;
}

/**
 * The pools with every requested non-default dimension written onto each row's
 * `values`, keyed by `compsDimensionKey` and **already resolved under the
 * basis** — which is why a windowed spec is never `perGame` again: the divisor
 * is the window's own games, not the anchor season's, so dividing twice would
 * be the bug this materialization exists to prevent.
 *
 * Derived at read time over the whole corpus, `withCareerValues`' own rule and
 * for its own reason: a window is a property of the *corpus*, so backfilling an
 * archive season changes every later season's answer without any of those
 * seasons' own data moving, and a cached copy would hold the stale one for a
 * TTL it never earned.
 *
 * A request naming no window at all is the common case and costs nothing: the
 * pools come straight back and not one row is rebuilt.
 *
 * **A windowed request does pay the corpus-wide pass on every request, and that
 * is deliberately not cached.** `withCareerValues` memoizes its own pass against
 * the corpus's identity because it takes no other input; this one varies with
 * the *dimension set* and the basis, so a cache would need an entry per
 * combination — and each entry is a full enriched copy of every player-season on
 * file, which is tens of megabytes. A bounded cache would therefore multiply the
 * process's resident corpus by its own size to save a pass that only runs for
 * readers who moved a window, and an unbounded one is a leak with a slow fuse.
 * If this ever needs to be cheaper, the shape to reach for is materializing the
 * *dimensions* alone — one `Map<dimensionKey, (number | null)[]>` per season,
 * keyed off the same corpus identity — rather than rebuilding every row.
 */
export function withWindowValues(
  pools: readonly CompsSeasonPool[],
  wanted: readonly { key: string; window: CompsWindowKey }[],
  basis: CompsBasis,
): CompsSeasonPool[] {
  const dimensions = new Map<string, { field: CompsField; window: CompsWindow }>();
  for (const { key, window } of wanted) {
    if (window === DEFAULT_COMPS_WINDOW) continue;
    const field = compsField(key);
    const spec = compsWindow(window);
    // Unknown keys are the parser's to refuse; skipping beats crashing, and a
    // field the catalogue says takes no window would be pooling a KTC value.
    if (field === undefined || spec === undefined) continue;
    if (!compsFieldTakesWindow(field)) continue;
    dimensions.set(compsDimensionKey(key, window), { field, window: spec });
  }
  if (dimensions.size === 0) return [...pools];

  // Every stored season per player, so a row can read the ones around it. A
  // season whose label isn't a year can't be placed on the timeline and is
  // left out of every window rather than guessed at.
  const seasonsByPlayer = new Map<string, { year: number; row: CompsPoolRow }[]>();
  for (const pool of pools) {
    const year = Number(pool.season);
    if (!Number.isInteger(year)) continue;
    for (const row of pool.rows) {
      let list = seasonsByPlayer.get(row.player_id);
      if (!list) {
        list = [];
        seasonsByPlayer.set(row.player_id, list);
      }
      list.push({ year, row });
    }
  }

  return pools.map((pool) => {
    const anchor = Number(pool.season);
    return {
      season: pool.season,
      rows: pool.rows.map((row) => {
        const values = { ...row.values };
        const seasons = Number.isInteger(anchor)
          ? (seasonsByPlayer.get(row.player_id) ?? [])
          : [];
        for (const [key, { field, window }] of dimensions) {
          values[key] = windowValue(seasons, anchor, field, window, basis);
        }
        return { ...row, values };
      }),
    };
  });
}

function windowValue(
  seasons: readonly { year: number; row: CompsPoolRow }[],
  anchor: number,
  field: CompsField,
  window: CompsWindow,
  basis: CompsBasis,
): number | null {
  let pooledN = 0;
  // Null until a season contributes a divisor — an additive quantity never
  // does, which is what makes a pooled total a sum rather than a mean.
  let pooledD: number | null = null;
  let answered = false;
  let extreme: number | null = null;

  for (const season of seasons) {
    if (!inWindow(window, season.year, anchor)) continue;
    const ratio = seasonRatio(season.row, field, basis);
    const resolved = value(ratio);
    if (ratio === null || resolved === null) continue;
    answered = true;
    if (window.kind === "pooled") {
      pooledN += ratio.n;
      if (ratio.d !== null) pooledD = (pooledD ?? 0) + ratio.d;
    } else if (
      extreme === null ||
      (window.kind === "worst" ? resolved < extreme : resolved > extreme)
    ) {
      extreme = resolved;
    }
  }

  // No season in the span answered this field — a rookie under a career
  // window, or a stretch the feed can't speak to. Null is what excludes those
  // seasons from the comparison; a zero would float them into it.
  if (!answered) return null;
  if (window.kind !== "pooled") return extreme === null ? null : round2(extreme);
  if (pooledD === null) return round2(pooledN);
  return pooledD > 0 ? round2(pooledN / pooledD) : null;
}

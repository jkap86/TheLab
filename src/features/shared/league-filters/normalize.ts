import {
  ALL,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  FIXED_FILTERS,
  SLOT_GROUP_BY_KEY,
} from "./defaults.ts";
import type { CompareOp, FilterRule, LeagueFilters } from "./types.ts";

/**
 * What a *stored* selection is allowed to be — the one rule both ends of
 * `features/shared/league-filters-store` share.
 *
 * It exists because a `LeagueFilters` is now something the device keeps, and a
 * stored value is untrusted in the three ordinary ways: it may have been written
 * by a build whose vocabulary has since moved, hand-edited by anything on the
 * origin, or left behind by a reader's own private-mode experiment. It sits in
 * this folder rather than beside the store because what it decides is a fact
 * about the *vocabulary* — the seventh concern in the folder's own split — and
 * because keeping it free of React is what lets Node's runner drive it.
 *
 * **Applied on write as well as on read**, so the two ends cannot come to
 * disagree about what a valid selection is, and so a value this build refuses is
 * cleaned up the first time the reader touches the dialog rather than being
 * refused forever.
 *
 * **The recovery is per field, not per selection.** A bad `type` costs the type
 * rail and nothing else; a bad rule costs that rule. Throwing the whole
 * selection away on one bad field would turn a stale stored rule into a reader
 * losing the four they had built beside it.
 */

const COMPARE_OP_VALUES: ReadonlySet<string> = new Set(
  COMPARE_OPS.map((op) => op.value),
);

/**
 * Each fixed filter's own options, keyed by field.
 *
 * Derived from {@link FIXED_FILTERS} rather than spelling the two unions again,
 * which is the walk `activeFilters` and `clearFilter` already take and for its
 * reason: a third fixed filter, or an option added to one, is accepted by the
 * store with no second edit here — and a value the rail cannot render can never
 * be read back out of storage.
 */
const FIXED_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  FIXED_FILTERS.map((filter) => [
    filter.key,
    new Set<string>(filter.options.map((option) => option.value)),
  ]),
);

/** A stored fixed filter, or the neutral value where it names nothing real. */
function fixed<K extends "type" | "bestBall">(
  raw: unknown,
  key: K,
): LeagueFilters[K] {
  return typeof raw === "string" && FIXED_VALUES.get(key)?.has(raw)
    ? (raw as LeagueFilters[K])
    : ALL;
}

/**
 * One stored rule, or null where this build could not act on it.
 *
 * **A rule that cannot be evaluated is dropped rather than kept**, and that is
 * the decision the whole module turns on. Every predicate here fails *closed*: a
 * `compare` handed an op outside {@link COMPARE_OPS} falls through its switch,
 * and {@link slotCount} answers null for a group it does not know — so a rule
 * this build cannot read matches no league at all, and keeping one would empty
 * the grid for the life of the stored value, under a chip naming a rule nothing
 * but `Clear` can undo. Dropping it widens the selection by one rule, which the
 * trigger's count and the summary sentence both state honestly, being derived
 * from the same list.
 *
 * A non-finite `value` goes the same way and for the same reason: `compare`
 * against `NaN` is false for every league on every op.
 *
 * The rule is rebuilt rather than passed through, so a stored entry carrying
 * anything else — a fourth field, a stale one — lands in storage as the three
 * the engine reads.
 */
function rule(
  raw: unknown,
  closedKeys?: ReadonlyMap<string, unknown>,
): FilterRule | null {
  if (!raw || typeof raw !== "object") return null;
  const { key, op, value } = raw as Record<string, unknown>;
  if (typeof key !== "string" || key.length === 0) return null;
  if (closedKeys && !closedKeys.has(key)) return null;
  if (typeof op !== "string" || !COMPARE_OP_VALUES.has(op)) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return { key, op: op as CompareOp, value };
}

/**
 * One stored rule list, dropping what this build cannot act on.
 *
 * `closedKeys` is what makes the three lists validate differently, and the
 * asymmetry is the point rather than an oversight. **Slot keys are a closed
 * vocabulary** — `SLOT_GROUP_BY_KEY` is the whole of what `slotCount` can
 * count — so a stored group this build has never heard of is exactly the
 * empties-the-grid case above. **Settings and scoring keys are open**: both
 * menus are built from the keys the leagues in hand actually carry, and
 * `storedSetting` and `scoringValue` read an unranked key perfectly well, so
 * checking those against a table would throw away a house rule somebody
 * deliberately asked about.
 */
function rules(
  raw: unknown,
  closedKeys?: ReadonlyMap<string, unknown>,
): readonly FilterRule[] {
  if (!Array.isArray(raw)) return [];
  const kept: FilterRule[] = [];
  for (const entry of raw) {
    const parsed = rule(entry, closedKeys);
    if (parsed) kept.push(parsed);
  }
  return kept;
}

/**
 * Fold an unknown stored value into a selection this build can act on.
 *
 * Exported for the tests as well as the store: every rule in it is silent when
 * it goes wrong — a selection lost on an upgrade, a grid emptied by a rule
 * nothing on screen can explain, a fixed filter sitting on a value no rail has
 * a state for.
 */
export function normalizeLeagueFilters(value: unknown): LeagueFilters {
  if (!value || typeof value !== "object") return DEFAULT_LEAGUE_FILTERS;
  const stored = value as Record<string, unknown>;
  return {
    type: fixed(stored.type, "type"),
    bestBall: fixed(stored.bestBall, "bestBall"),
    settings: rules(stored.settings),
    slots: rules(stored.slots, SLOT_GROUP_BY_KEY),
    scoring: rules(stored.scoring),
  };
}

import type { CompPair, CompCriterionId, CompWindowId } from "@/shared/contract";
import {
  DEFAULT_PAIR_WEIGHT,
  WINDOWS,
  criterionAppliesTo,
  defaultCriteriaFor,
  isWindowed,
} from "../../../shared/comps/criteria.ts";
import type { CompCriterion } from "../../../shared/comps/criteria.ts";

/**
 * The criteria panel's state and the four edits it makes to it — pure, and
 * tested, because two of the four carry a rule that is silent when wrong.
 *
 * The whole criteria table is state (the handoff's own shape): every criterion
 * with its `on` and its weighted windows. The edits return a new list rather
 * than mutating, which is what lets the page hold it in one `useState`.
 *
 * The imports are relative with `.ts` so this resolves under Node's own
 * runner, the arrangement `features/trades/query-fns.ts` already makes.
 */

/**
 * The table as the panel opens for a position: a fresh copy of that position's
 * preset, windows included.
 *
 * With no position — before a subject is picked — it is the vocabulary's own
 * defaults, which are the receiver preset. See `shared/comps/criteria` for why
 * a running back opening on a receiver's criteria was worth fixing.
 */
export function defaultCriteria(position: string | null = null): CompCriterion[] {
  return defaultCriteriaFor(position);
}

export function toggleCriterion(
  list: readonly CompCriterion[],
  id: CompCriterionId,
): CompCriterion[] {
  return list.map((c) => (c.id === id ? { ...c, on: !c.on } : c));
}

/**
 * Add or remove one window on a criterion.
 *
 * **The last window cannot be removed.** Its key is disabled, so this is belt
 * and braces rather than a correction — a windowed criterion always reads
 * over at least one window, and the bound is enforced by the key rather than
 * by silently fixing the state afterwards.
 *
 * **An arriving window takes the default weight and is inserted in canonical
 * `WINDOWS` order**, never appended, so the weight rails under a criterion
 * always read top-down in the same order as the keys above them.
 */
export function toggleWindow(
  list: readonly CompCriterion[],
  id: CompCriterionId,
  window: CompWindowId,
): CompCriterion[] {
  return list.map((c) => {
    if (c.id !== id) return c;
    const has = c.wins.some((w) => w.id === window);
    if (has && c.wins.length === 1) return c;
    if (has) return { ...c, wins: c.wins.filter((w) => w.id !== window) };
    const added = [...c.wins, { id: window, w: DEFAULT_PAIR_WEIGHT }];
    return {
      ...c,
      wins: WINDOWS.flatMap((spec) => added.filter((w) => w.id === spec.id)),
    };
  });
}

export function setWeight(
  list: readonly CompCriterion[],
  id: CompCriterionId,
  window: CompWindowId,
  weight: number,
): CompCriterion[] {
  return list.map((c) =>
    c.id === id
      ? { ...c, wins: c.wins.map((w) => (w.id === window ? { ...w, w: weight } : w)) }
      : c,
  );
}

/**
 * The criteria a position's panel shows.
 *
 * **A criterion the panel hides must not reach the request**, which is the one
 * thing this and {@link activePairs} have to agree about. A reader who leaves
 * target share on for a receiver and then picks a quarterback would otherwise
 * be shown a panel with no target share in it and handed a board ranked partly
 * on target share, with nothing on screen naming the criterion doing the work.
 * So both filter through the same predicate.
 */
export function visibleCriteria(
  list: readonly CompCriterion[],
  position: string | null,
): CompCriterion[] {
  if (position === null) return [...list];
  return list.filter((c) => criterionAppliesTo(c.id, position));
}

/**
 * The pairs the distance runs on: every window of every criterion that is on
 * *and applies to the subject's position*, in panel order — which is also the
 * order the comp card draws its chips in, since the route echoes the list it
 * was handed.
 */
export function activePairs(
  list: readonly CompCriterion[],
  position: string | null = null,
): CompPair[] {
  return visibleCriteria(list, position)
    .filter((c) => c.on)
    .flatMap((c) =>
      c.wins.map((w) => ({ criterion: c.id, window: w.id, weight: w.w })),
    );
}

export function activeCount(
  list: readonly CompCriterion[],
  position: string | null = null,
): number {
  return visibleCriteria(list, position).filter((c) => c.on).length;
}

/**
 * Whether a window key is disabled: on a switched-off criterion every key is,
 * and on a live one the last window standing is. The faint tone a disabled
 * key wears is only legitimate *because* it is disabled — a live control may
 * not sit under the app's contrast floor.
 */
export function windowKeyDisabled(
  criterion: CompCriterion,
  window: CompWindowId,
): boolean {
  if (!criterion.on) return true;
  return criterion.wins.length === 1 && criterion.wins[0].id === window;
}

export { isWindowed };

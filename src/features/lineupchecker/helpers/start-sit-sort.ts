import type { WeekReading } from "@/features/shared";

/**
 * The start/sit console's order: which head the list is sorted by, and which
 * way.
 *
 * **The column heads are the sort control, and this is everything they
 * decide.** It is pure and under Node's own runner for `stat-board.ts`'s
 * reason: a comparison that folds an absent figure into its numbers, or a
 * tiebreak that reverses with the arrow, renders a perfectly ordinary list in
 * the wrong order, and nothing on screen says so.
 */

/**
 * What the list can be ordered by: the name, the four counts and the figure —
 * **exactly the heads on screen**, so the vocabulary cannot name an order the
 * row could not show.
 *
 * `fielded` went with the Sort rail that offered it. It was the sum of the four
 * counts — what a press on a row narrows to — and no column, so it has no head
 * to be pressed; a head sorting by a number the row does not print is an order
 * a reader cannot check.
 */
export type StartSitSortKey = "name" | WeekReading | "figure";

/** A key and a direction — what a press on one head leaves. */
export type StartSitSort = { key: StartSitSortKey; ascending: boolean };

/**
 * The reader's own starts, most first: the panel's first question is their own
 * lineups, which is the order the drawer this console replaced opened on and
 * the order `weekTwoSidedShares` already returns its players in.
 */
export const DEFAULT_START_SIT_SORT: StartSitSort = {
  key: "start",
  ascending: false,
};

/**
 * Which way a key reads on its **first** press.
 *
 * A name is a list a reader looks somebody up in, so A–Z. Every other key is a
 * superlative question — who did my lineups start most, who is worth most — so
 * most first. The reverse of each is a real question too (the players nobody
 * started, the cheapest), and a second press on the same head is what asks it.
 */
export function startSitAscending(key: StartSitSortKey): boolean {
  return key === "name";
}

/**
 * A press on a head: **a new key sorts by it in its own direction, the lit key
 * reverses**.
 *
 * One function rather than a ternary at each call site, because the two arms
 * are not symmetrical — a fresh press takes the key's own direction and a
 * repeat takes the opposite of whatever is in force — and a component that got
 * that backwards would be a list whose first press on `Name` opened at Z. It is
 * `nextStatSort`'s rule, one console over.
 */
export function nextStartSitSort(
  held: StartSitSort,
  key: StartSitSortKey,
): StartSitSort {
  return held.key === key
    ? { key, ascending: !held.ascending }
    : { key, ascending: startSitAscending(key) };
}

/** What the order reads off a row — structural, so the console's own row fits. */
export type StartSitSortable = {
  name: string;
  started: number;
  benched: number;
  oppStarted: number;
  oppBenched: number;
  /** Null where the counted leagues disagree — see `WeekTwoSidedShare.figure`. */
  figure: number | null;
};

// One collator rather than `localeCompare` per comparison, which re-resolves
// the locale each call — a sort over a thousand rows is thousands of them, on
// every keystroke of the search.
const NAME_ORDER = new Intl.Collator();

/** A key's own number for a row. Only the figure can be absent. */
function weigh(
  row: StartSitSortable,
  key: Exclude<StartSitSortKey, "name">,
): number | null {
  switch (key) {
    case "start":
      return row.started;
    case "bench":
      return row.benched;
    case "opp-start":
      return row.oppStarted;
    case "opp-bench":
      return row.oppBenched;
    case "figure":
      return row.figure;
  }
}

/**
 * The rows in the held order, as a new array.
 *
 * **An absent figure sorts last in either direction, and a zero sorts as a
 * zero.** A player the counted leagues disagree about has no figure rather than
 * the lowest one, so there is no direction a reader could flip to make him the
 * highest — folded into the comparison, reversing the arrow would float every
 * such row to the top of the list. A count is never absent; a player started in
 * no lineups is a real nought and sorts as one.
 *
 * **Ties break on the name, A–Z, and the tiebreak never reverses.** A count is a
 * small integer over a list that runs to a thousand rows, so ordering by `Start`
 * leaves long runs of equals; a tiebreak that flipped with the arrow would
 * reshuffle every one of them on each press, which reads as the list changing
 * under the reader rather than as the order they asked for.
 */
export function sortStartSit<T extends StartSitSortable>(
  rows: readonly T[],
  sort: StartSitSort,
): T[] {
  const sign = sort.ascending ? 1 : -1;
  const { key } = sort;
  if (key === "name") {
    return [...rows].sort((a, b) => sign * NAME_ORDER.compare(a.name, b.name));
  }
  return [...rows].sort((a, b) => {
    const left = weigh(a, key);
    const right = weigh(b, key);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else if (left !== right) {
      return sign * (left - right);
    }
    return NAME_ORDER.compare(a.name, b.name);
  });
}

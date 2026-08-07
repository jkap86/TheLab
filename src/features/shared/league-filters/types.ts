/**
 * The vocabulary the league filters are written in — and nothing that reads or
 * builds it.
 *
 * This module and its five siblings were one 640-line file. The split is by
 * *what a thing is*, not by what reads it, which is what keeps each of them
 * readable on its own: the types here, the tables a reader picks from in
 * `./defaults`, the rules that judge a league in `./predicates`, what the page
 * says about a selection in `./summaries`, what the menus offer in `./options`,
 * and the composition list in `./breakdown`.
 *
 * The direction of the arrows is the point of the arrangement. Everything
 * depends on this module and this module depends on nothing, so a component that
 * only needs the shape of a `LeagueFilters` — most of them, since the state is
 * threaded through several — pulls in no slot tables, no predicates and no
 * `SLOT_POSITIONS` walk. That is the tree-shaking the one file could not offer
 * whatever the bundler did with it, because a single module is a single unit.
 *
 * Types only, so it is erased entirely from any bundle that imports nothing else
 * here.
 */

/** How a rule compares a league's number against the one the reader typed. */
export type CompareOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/**
 * One rule: a key, a comparison and a number.
 *
 * The same shape serves all three lists — what differs is only which number the
 * key names (a count of slots, a scoring rate, a count of teams), which is why
 * the families are three arrays of one type rather than three types.
 */
export type FilterRule = {
  /**
   * A slot-group key, a league-size key (both `./defaults`), or a Sleeper
   * `scoring_settings` key.
   */
  key: string;
  op: CompareOp;
  value: number;
};

export type LeagueFilters = {
  /**
   * Sleeper `settings.type`: "all" or a stringified 0=redraft, 1=keeper,
   * 2=dynasty, 3=chopped (its native guillotine format).
   */
  type: "all" | "0" | "1" | "2" | "3";
  /** Sleeper `settings.best_ball`: "all", or filter by best-ball on/off. */
  bestBall: "all" | "yes" | "no";
  /** Where the league is in its season. */
  status: "all" | "pre_draft" | "drafting" | "in_season" | "done";
  /** Rules over how many of a slot group `roster_positions` holds. */
  slots: readonly FilterRule[];
  /** Rules over what `scoring_settings` pays for a stat. */
  scoring: readonly FilterRule[];
  /**
   * Rules over how big the league is — `teams = 12`, `teams ≥ 10`.
   *
   * A list rather than the single comparison one attribute seems to want,
   * because the lists are AND-only: a band is `teams ≥ 10` *and* `teams ≤ 12`,
   * which costs nothing to express here and would need a second field and a
   * second control as a pair of bounds.
   *
   * It arrived with the ADP board, whose own size chip this replaced, and it is
   * a fact about a league like every other rule here — so the manager tabs and
   * the trades board read it too rather than it being a fourth filter set only
   * one page knows about.
   */
  size: readonly FilterRule[];
};

/**
 * A group of lineup slots a rule can count, with the predicate that decides
 * membership.
 *
 * A predicate rather than a list because the useful groups aren't all
 * enumerations: `Starters` is "not a bench slot", which has to keep counting a
 * slot spelling this build has never seen, and the rest are derived from the
 * solver's tables so they can't drift from what the lineup solve does.
 */
export type SlotGroup = {
  /** Stable — a stored rule names it. */
  key: string;
  label: string;
  /** What the group covers, shown under the menu entry. */
  hint: string;
  matches: (slot: string) => boolean;
};

/**
 * One filter currently narrowing the list, named and addressable.
 *
 * Everything the page says about the selection is derived from this list — the
 * count on the trigger, the words beside the header's record, and the chips in
 * the dialog's readout rail. They used to be three walks over the same fields,
 * which is three chances for a filter added above to be counted and not named,
 * or named and not removable.
 *
 * The address is a field for a fixed filter and a *position* for a rule, which
 * is what `clearFilter` needs to undo one — rules are identified by where they
 * sit, since two identical rules are indistinguishable and removing "the
 * matching one" would be ambiguous.
 */
export type ActiveFilter =
  | { kind: "fixed"; field: "type" | "bestBall" | "status"; label: string }
  | { kind: "slot"; index: number; label: string }
  | { kind: "scoring"; index: number; label: string }
  | { kind: "size"; index: number; label: string };

/** One line of the readout rail's composition list. */
export type LeagueBreakdownRow = { key: string; label: string; count: number };

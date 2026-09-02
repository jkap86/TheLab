/**
 * The vocabulary the league filters are written in — and nothing that reads or
 * builds it.
 *
 * The split across this folder is by *what a thing is*, not by what reads it:
 * the types here, the tables a reader picks from in `./defaults`, the rules that
 * judge a league in `./predicates`, what the menus offer in `./options`, what
 * the page says about a selection in `./summaries`, and the composition list in
 * `./breakdown`. Everything depends on this module and this module depends on
 * nothing, so a component that only needs the *shape* of a `LeagueFilters` —
 * most of them, since the state is threaded through several — pulls in no slot
 * tables, no predicates and no `SLOT_POSITIONS` walk.
 *
 * Types only, so it is erased entirely from any bundle that imports nothing
 * else here.
 *
 * **Ported from TheLabX minus two fields.** Its `LeagueFilters` also carries a
 * `season` and a `status`. Season is absent because this repo's leagues route
 * answers one season by construction (`WHERE l.season = $2`), so the control
 * would have a single option — a fact rather than a choice. Status is out of
 * scope here.
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
  /**
   * Rules over what a league is *configured* as — `teams ≥ 12`,
   * `trade_deadline ≤ 12`, `disable_trades = 0`.
   *
   * A list rather than the single comparison one attribute seems to want,
   * because the lists are AND-only and a band is `teams ≥ 10` *and*
   * `teams ≤ 12`.
   *
   * `teams` is the one key that is **not** in Sleeper's `settings` blob: it
   * reads `total_rosters` off the league row. Every other key is a number in
   * the blob.
   */
  settings: readonly FilterRule[];
  /** Rules over how many of a slot group `roster_positions` holds. */
  slots: readonly FilterRule[];
  /** Rules over what `scoring_settings` pays for a stat. */
  scoring: readonly FilterRule[];
};

/**
 * One value of a setting whose numbers are *names* rather than quantities.
 *
 * `disable_trades` is 0 or 1 and neither digit says which is which; a rule
 * reading `disable_trades = 1` is one a reader cannot check, and the chip the
 * match rail draws from it is worse. Where a key declares these, the row renders
 * a menu instead of a number field and the comparison narrows to is / is not —
 * `>` on an enum being a question with no meaning.
 */
export type SettingValue = { value: number; label: string };

/**
 * A settings key the menu ranks and names, with what its numbers mean.
 *
 * The table only *ranks and names*: the menu itself is built from the keys the
 * leagues in hand actually carry ({@link settingKeyOptions}), because what a
 * league configures is a house rule and a fixed list would offer keys nobody
 * sets while hiding the one someone wants. A key this build has never heard of
 * is still offered, spelled with its underscores opened out — the scoring bay's
 * arrangement exactly.
 */
export type SettingKey = {
  /** Stable — a stored rule names it. */
  key: string;
  label: string;
  /** What the key covers, shown under the menu entry. */
  hint: string;
  /**
   * What an *absent* key means, which cannot have one answer across the blob.
   *
   * Sleeper omits what a league doesn't set, so a count or a flag reads absent
   * as a real `0` — `taxi_slots` missing is no taxi squad, `disable_trades`
   * missing is trades enabled — the same rule `scoringValue` follows and the
   * reason `bonus_rec_te > 0` is how TE premium is asked. A **week** has no zero
   * on its scale, so absent there is unknown and fails the rule rather than
   * reporting week 0. An unranked key is read as `"zero"`, the common case.
   */
  absent: "zero" | "unknown";
  /** Named values, where this key's numbers are labels — see {@link SettingValue}. */
  values?: readonly SettingValue[];
  /**
   * One value on the key's own scale that is not on the scale — Sleeper spells
   * "no trade deadline" as `trade_deadline: 99`.
   *
   * It is a third value kind rather than a label, and it needs both halves of
   * the treatment. **Null for comparison**, or `trade_deadline ≥ 13` answers
   * "leagues that trade late" with every league that never stops trading — a
   * filter returning the wrong rows rather than an error, and the same shape as
   * the `total_rosters` of 0 that {@link settingValue} already keeps null for.
   * **And reachable by name**, since unlike that zero this is a known answer
   * rather than an absence, so "no trade deadline" has to stay askable.
   */
  sentinel?: SettingValue;
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
 * count on the trigger, the words under the header's season line, and the chips
 * in the dialog's readout rail. Three walks over the same fields would be three
 * chances for a filter added above to be counted and not named, or named and
 * not removable.
 *
 * The address is a field for a fixed filter and a *position* for a rule, which
 * is what `clearFilter` needs to undo one — rules are identified by where they
 * sit, since two identical rules are indistinguishable and removing "the
 * matching one" would be ambiguous.
 */
export type ActiveFilter =
  | { kind: "fixed"; field: "type" | "bestBall"; label: string }
  | { kind: "setting"; index: number; label: string }
  | { kind: "slot"; index: number; label: string }
  | { kind: "scoring"; index: number; label: string };

/** One line of the readout rail's composition list. */
export type LeagueBreakdownRow = { key: string; label: string; count: number };

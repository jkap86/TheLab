import type { ManagerLeague } from "@/shared/manager";

import { LIVE_STATUSES, SLOT_GROUP_BY_KEY } from "./defaults.ts";
import type { CompareOp, FilterRule, LeagueFilters } from "./types.ts";

/**
 * Whether a league passes — the rules, which encode Sleeper's settings quirks.
 *
 * Kept apart from the tables a reader picks from and from the words the page
 * says about a selection, because this is the half that has to be *right*: it is
 * what decides which leagues' trades are on a board and what a share is counted
 * out of, and every rule in it is a quirk somebody was caught by once.
 *
 * The `ManagerLeague` import is type-only, so it is erased and the alias costs
 * nothing.
 */

/**
 * Scoring rates are fractions Sleeper stores as floats — 0.1 a rushing yard,
 * 0.04 a passing yard — so an exact `===` is one binary representation away from
 * reporting that a half-PPR league doesn't pay 0.5. Every comparison is made with
 * a tolerance far below any rate a league actually uses.
 */
const EPSILON = 1e-9;

/** Whether a league's number satisfies a rule's comparison. */
export function compare(
  actual: number,
  op: CompareOp,
  target: number,
): boolean {
  switch (op) {
    case "eq":
      return Math.abs(actual - target) < EPSILON;
    case "ne":
      return Math.abs(actual - target) >= EPSILON;
    case "gte":
      return actual >= target - EPSILON;
    case "lte":
      return actual <= target + EPSILON;
    case "gt":
      return actual > target + EPSILON;
    case "lt":
      return actual < target - EPSILON;
  }
}

/**
 * How many of a group's slots a league starts, or null when it can't be known.
 *
 * Null and zero are different answers, and keeping them apart is what stops
 * `k = 0` — "leagues without a kicker" — from sweeping in every league whose
 * lineup simply hasn't been synced. A rule against an unknown lineup fails
 * rather than passing on an assumed zero.
 */
export function slotCount(league: ManagerLeague, key: string): number | null {
  const group = SLOT_GROUP_BY_KEY.get(key);
  const slots = league.roster_positions;
  if (!group || !slots) return null;
  let count = 0;
  // A counting loop rather than `filter().length`: this runs once per league per
  // rule, and on the trades page that is a few hundred leagues times however
  // many rules a reader has built, on every filter change. The array the filter
  // allocated was never read.
  for (const slot of slots) if (group.matches(slot)) count += 1;
  return count;
}

/**
 * What a league pays for a stat, or null when its scoring isn't stored.
 *
 * A key *absent from a stored blob* is 0, not unknown: Sleeper omits what a
 * league doesn't pay for, which is exactly why `bonus_rec_te > 0` is how TE
 * premium is asked. A missing blob is unknown, and fails the rule for the reason
 * an unsynced lineup does.
 */
export function scoringValue(
  league: ManagerLeague,
  key: string,
): number | null {
  const scoring = league.scoring_settings;
  if (!scoring) return null;
  const value = scoring[key];
  return typeof value === "number" ? value : 0;
}

/** Whether a league's lineup satisfies one slot rule. */
export function matchesSlotRule(
  league: ManagerLeague,
  rule: FilterRule,
): boolean {
  const count = slotCount(league, rule.key);
  return count !== null && compare(count, rule.op, rule.value);
}

/** Whether a league's scoring satisfies one scoring rule. */
export function matchesScoringRule(
  league: ManagerLeague,
  rule: FilterRule,
): boolean {
  const value = scoringValue(league, rule.key);
  return value !== null && compare(value, rule.op, rule.value);
}

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(league: ManagerLeague, key: string): number | undefined {
  const value = league.settings?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * A league's Sleeper type as a number: 0 redraft, 1 keeper, 2 dynasty, 3 chopped.
 *
 * Chopped is Sleeper's own guillotine format, and it is the code
 * `getManagerLeagues` tests to decide whether a manager with no roster left the
 * league or was eliminated from it — the one place the distinction changes what
 * is on screen.
 *
 * Sleeper omits `type` for standard redraft leagues, so a missing value is 0 —
 * the same assumption `/api/adp` makes in SQL, and the reason this is a function
 * rather than a field read at each call site: the share cards count dynasty and
 * redraft leagues off it too, and a second copy of the fallback is a second
 * chance to forget it.
 */
export function leagueType(league: ManagerLeague): number {
  return settingNumber(league, "type") ?? 0;
}

/**
 * The scoring bucket a league falls in, from its `rec` points. Mirrors the
 * `SCORING_SQL` `/api/adp` groups by exactly — absent/unparseable and anything
 * under half a point is standard — so a filter seeded from a league matches the
 * league it came from rather than landing a bucket off.
 *
 * It lives here rather than in `manager/adp-controls`, where it started, because
 * both ends of the app bucket a league this way. `features/shared` can't import a
 * feature, so the definition moved down and `adp-controls` re-exports it. The
 * league filters themselves no longer bucket at all: a `rec` rule says what it
 * means without rounding three rates into three names.
 */
export function deriveScoring(
  scoring: Record<string, number> | null,
): "std" | "half_ppr" | "ppr" {
  const rec = scoring?.rec;
  if (typeof rec !== "number") return "std";
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "std";
}

/**
 * Whether a league passes the active filters.
 *
 * Ordered cheapest-first, which matters now that this runs over every league of
 * a season rather than over one account's hundred-odd: the three fixed filters
 * are field reads and the rules walk `roster_positions`, so a league rejected on
 * its type never touches its lineup.
 */
export function matchesFilters(
  league: ManagerLeague,
  filters: LeagueFilters,
): boolean {
  if (filters.type !== "all") {
    if (leagueType(league) !== Number(filters.type)) return false;
  }
  if (filters.bestBall !== "all") {
    const isBestBall = settingNumber(league, "best_ball") === 1;
    if (filters.bestBall === "yes" ? !isBestBall : isBestBall) return false;
  }
  if (filters.status !== "all") {
    const matches =
      filters.status === "done"
        ? !LIVE_STATUSES.has(league.status)
        : league.status === filters.status;
    if (!matches) return false;
  }
  // Every rule narrows — the lists are an AND, like the fixed filters above them.
  // An OR would need a rule to say which group it joins, and "dynasty leagues
  // that start two QBs" is the question people actually arrive with.
  for (const rule of filters.slots) {
    if (!matchesSlotRule(league, rule)) return false;
  }
  for (const rule of filters.scoring) {
    if (!matchesScoringRule(league, rule)) return false;
  }
  return true;
}

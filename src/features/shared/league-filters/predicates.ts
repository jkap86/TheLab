import type { AdpBoardType, ManagerLeague } from "@/shared/manager";

import {
  LIVE_STATUSES,
  SETTING_KEY_BY_KEY,
  SLOT_GROUP_BY_KEY,
  TEAMS_KEY,
} from "./defaults.ts";
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

/**
 * A league's stored number for a settings key, exactly as it is stored — the
 * sentinel included — or null when nothing is.
 *
 * Two keys' worth of quirk live here and nowhere else. `teams` is not in the
 * blob at all: it reads `total_rosters` off the league row, where a **0 is
 * unknown rather than a real size**, since Sleeper always reports it for a live
 * league and a 0 is a row this app stored before the league answered —
 * `teams < 10` sweeping in every such league is exactly the `k = 0` trap
 * `slotCount` keeps null for. And an **absent key is read per key**: Sleeper
 * omits what a league doesn't set, so a count or a flag is a real 0 (the rule
 * `scoringValue` follows) while a week has no zero on its scale and is unknown.
 */
function storedSetting(league: ManagerLeague, key: string): number | null {
  if (key === TEAMS_KEY) {
    const teams = league.total_rosters;
    return typeof teams === "number" && teams > 0 ? teams : null;
  }
  const settings = league.settings;
  if (!settings) return null;
  const raw = settings[key];
  if (typeof raw === "number") return raw;
  return SETTING_KEY_BY_KEY.get(key)?.absent === "unknown" ? null : 0;
}

/**
 * Whether this league's value for `key` is that key's sentinel, or null when it
 * can't be known — and null for a key that has no sentinel at all, since "is it
 * the sentinel" is not a question that key answers.
 *
 * Its own function because two callers must agree: {@link matchesSettingRule}
 * decides a sentinel rule with it, and the dialog's row renders the sentinel by
 * name off the same table.
 */
export function settingIsSentinel(
  league: ManagerLeague,
  key: string,
): boolean | null {
  const sentinel = SETTING_KEY_BY_KEY.get(key)?.sentinel;
  if (!sentinel) return null;
  const stored = storedSetting(league, key);
  return stored === null ? null : stored === sentinel.value;
}

/**
 * A league's *comparable* number for a settings key, or null when there isn't
 * one — nothing stored, or a value that is a name rather than a place on the
 * scale.
 *
 * **The sentinel reads as null, and that is the whole of the fix.** Sleeper
 * spells "no trade deadline" as `trade_deadline: 99`; read as a week, one of
 * the two obvious rules is right by luck and the other is silently wrong —
 * `99 ≤ 12` is false so "an early deadline" works, while `99 ≥ 13` is true so
 * "leagues that trade late" answers with every league that never stops trading.
 * A filter returning the wrong rows rather than an error. Null for comparison
 * costs the sentinel nothing, because {@link matchesSettingRule} reaches it by
 * name instead.
 */
export function settingValue(
  league: ManagerLeague,
  key: string,
): number | null {
  const stored = storedSetting(league, key);
  if (stored === null) return null;
  const sentinel = SETTING_KEY_BY_KEY.get(key)?.sentinel;
  return sentinel && stored === sentinel.value ? null : stored;
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

/**
 * Whether a rule is addressing a key's sentinel by name rather than comparing
 * against the scale — "trade deadline **is** no deadline".
 *
 * Only `=` and `≠` can mean that: the sentinel is not a place on the scale, so
 * `trade_deadline ≥ 99` is a comparison a reader could type and would have no
 * reading. Exported because the dialog's row draws itself from the same answer —
 * a menu and an is / is not, rather than a number field — and a row that
 * disagreed with the predicate about which of the two a rule was would be the
 * usual two spellings of one question.
 */
export function isSentinelRule(rule: FilterRule): boolean {
  const sentinel = SETTING_KEY_BY_KEY.get(rule.key)?.sentinel;
  return (
    sentinel !== undefined &&
    rule.value === sentinel.value &&
    (rule.op === "eq" || rule.op === "ne")
  );
}

/** Whether a league's configuration satisfies one settings rule. */
export function matchesSettingRule(
  league: ManagerLeague,
  rule: FilterRule,
): boolean {
  if (isSentinelRule(rule)) {
    // Matched by identity, never through `compare` — and an unknown still fails,
    // on the terms every other rule here fails one: a league whose settings were
    // never synced is not evidence either way.
    const isSentinel = settingIsSentinel(league, rule.key);
    if (isSentinel === null) return false;
    return rule.op === "eq" ? isSentinel : !isSentinel;
  }
  const value = settingValue(league, rule.key);
  return value !== null && compare(value, rule.op, rule.value);
}

/**
 * A league as far as its `settings` blob — everything {@link leagueType} reads.
 *
 * Widened from `ManagerLeague` because the league detail panel asks the same
 * question of a different shape: `/api/league/[leagueId]` sends one league's blob
 * beside its rosters, not a `ManagerLeague`, and its Settings tab has to name the
 * type the same way the filters and the trade cards do. A structural parameter
 * costs existing callers nothing — a `ManagerLeague` still satisfies it — and it
 * is the alternative to a second copy of the fallback below.
 */
export type LeagueSettingsBlob = { settings: Record<string, unknown> | null };

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(
  league: LeagueSettingsBlob,
  key: string,
): number | undefined {
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
 * redraft leagues off it too, the league detail panel's Settings tab names it in
 * words, and a second copy of the fallback is a second chance to forget it.
 */
export function leagueType(league: LeagueSettingsBlob): number {
  return settingNumber(league, "type") ?? 0;
}

/**
 * Which of `/api/adp`'s two boards a league's own market is: Sleeper's
 * `settings.type` 2 is dynasty, and everything else — redraft and keeper — reads
 * the redraft board.
 *
 * Exported for the reason {@link leagueType} is, and this one had already been
 * written out three times before a fourth reader asked for it: the server groups
 * crawled drafts with `DYNASTY_BOARD_SQL`, `getLeagueTypes` buckets a stored
 * league with a bare `=== 2`, and `seedFromLeague` chose the drawer's displayed
 * board with a copy of its own. A haul priced off the market its league isn't in
 * is wrong at every line — the same failure reading a superflex roster off KTC's
 * 1QB board is — so it is worth one definition rather than four.
 *
 * **A league the list hasn't answered for yet is redraft**, which is the same
 * shape as an unsynced lineup falling to KTC's 1QB board: the broader market,
 * never a guess at the narrower one. A trade in an unknown league is priced
 * against the drafts most leagues run rather than left blank.
 */
export function leagueAdpBoard(league: ManagerLeague | null): AdpBoardType {
  return league && leagueType(league) === 2 ? "dynasty" : "redraft";
}

/**
 * Whether a league scores best ball — lineups set automatically, so depth is
 * worth what a starter is.
 *
 * Sleeper omits `best_ball` for the ordinary lineup league, so absent is false;
 * unlike `roster_positions`, there is no unknown here worth keeping apart, since
 * a league whose settings blob never synced is not evidence of a format either
 * way and both readings of it land on the same answer.
 *
 * Exported rather than read inline for the reason {@link leagueType} is: the
 * trade card prints this beside the league's name and {@link matchesFilters}
 * selects on it, and a card that says "best ball" over a filter that disagrees
 * is the drift one definition prevents.
 */
export function isBestBall(league: ManagerLeague): boolean {
  return settingNumber(league, "best_ball") === 1;
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
  // First because it is the cheapest read here — a string compare against a
  // column — and because it is the population the rest are narrowing *within*.
  if (filters.season !== "all" && league.season !== filters.season) return false;
  if (filters.type !== "all") {
    if (leagueType(league) !== Number(filters.type)) return false;
  }
  if (filters.bestBall !== "all") {
    const bestBall = isBestBall(league);
    if (filters.bestBall === "yes" ? !bestBall : bestBall) return false;
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
  //
  // Settings lead the two blob-walking rules for the reason the fixed filters
  // lead all three: a settings rule is one property read, where the others walk
  // `roster_positions` and `scoring_settings`. Over a whole season's leagues —
  // which is what the trades board and the ADP board both run this over — a
  // league rejected on its size never touches its lineup.
  for (const rule of filters.settings) {
    if (!matchesSettingRule(league, rule)) return false;
  }
  for (const rule of filters.slots) {
    if (!matchesSlotRule(league, rule)) return false;
  }
  for (const rule of filters.scoring) {
    if (!matchesScoringRule(league, rule)) return false;
  }
  return true;
}

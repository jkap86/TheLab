import type { ManagerLeague } from "@/shared/manager";

import {
  COMMON_SCORING_KEYS,
  NON_SETTING_KEYS,
  SETTING_KEYS,
  TEAMS_KEY,
} from "./defaults.ts";

/**
 * What the three data-driven menus offer, read off the leagues in hand: the
 * seasons on the band, the keys a settings rule can name, and the keys a
 * scoring rule can.
 *
 * Read off the data for the reason the trades page's own menus are: what a
 * league pays for and how it is configured are house rules, and a fixed list
 * would offer keys nobody sets while hiding the one someone actually wants to
 * filter on. The tables in `./defaults` only *rank and name* what turns up.
 */

/**
 * The seasons the band offers — every distinct season on the leagues in hand,
 * newest first.
 *
 * **Empty is a real answer and the band reads it as one.** Every caller but the
 * ADP board's widest setting hands this dialog a single season, so this comes
 * back with one entry and the band is not drawn at all: a control with one
 * option, permanently lit, reports a fact rather than offering a choice, which
 * is what every other row in this panel was shortened to stop doing. It turns on
 * by itself the day a caller widens its fetch.
 *
 * Sorted as strings, descending, which is the same order as numerically for the
 * four-digit years Sleeper stores — and does something sane rather than throwing
 * for anything else.
 */
export function seasonOptions(leagues: readonly ManagerLeague[]): string[] {
  const present = new Set<string>();
  for (const league of leagues) if (league.season) present.add(league.season);
  return [...present].sort((a, b) => b.localeCompare(a));
}

/**
 * The settings keys a rule can name, taken off the leagues in hand and ranked by
 * {@link SETTING_KEYS}.
 *
 * `teams` is always offered, because it is the one key that is not in the blob —
 * it reads `total_rosters` off the league row, so no amount of looking through
 * `settings` would turn it up. Everything else has to actually be stored by
 * some league on screen.
 *
 * Only numbers are offered: a rule is a comparison against one, so a key holding
 * a string or an object is a key no rule could evaluate. `type` and `best_ball`
 * are dropped for a different reason — see {@link NON_SETTING_KEYS}.
 */
export function settingKeyOptions(leagues: readonly ManagerLeague[]): string[] {
  const present = new Set<string>([TEAMS_KEY]);
  for (const league of leagues) {
    for (const [key, value] of Object.entries(league.settings ?? {})) {
      if (typeof value === "number" && !NON_SETTING_KEYS.has(key)) {
        present.add(key);
      }
    }
  }
  return rankKeys([...present], SETTING_KEYS.map((setting) => setting.key));
}

/**
 * Keys in a ranking table's order, with everything it doesn't name after them,
 * alphabetically.
 *
 * The two menus below and above both end this way, and the league detail panel's
 * Settings tab is a third reader — a list of one league's own keys rather than of
 * the keys a menu may offer, but ordered by the same tables for the same reason.
 * Written once so a key promoted up `SETTING_KEYS` moves in the list a reader
 * *reads* as well as in the menu they pick from.
 *
 * Ranked into a map rather than through `indexOf` inside the comparator: a
 * season's leagues carry ~60 distinct keys, so the sort makes a few hundred
 * comparisons and each would otherwise be two linear scans of the table.
 *
 * Sorts a copy; the argument is left alone.
 */
export function rankKeys(
  keys: readonly string[],
  order: readonly string[],
): string[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  const at = (key: string) => rank.get(key) ?? order.length;
  return [...keys].sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}

/**
 * The scoring keys a rule can name, taken off the leagues in hand.
 *
 * `COMMON_SCORING_KEYS` only *ranks* them; the fallback matters on a cold load,
 * where with no leagues yet the dialog still has to offer something.
 */
export function scoringKeyOptions(leagues: readonly ManagerLeague[]): string[] {
  const present = new Set<string>();
  for (const league of leagues) {
    for (const key of Object.keys(league.scoring_settings ?? {})) {
      present.add(key);
    }
  }
  const keys = present.size ? [...present] : [...COMMON_SCORING_KEYS];
  return rankKeys(keys, COMMON_SCORING_KEYS);
}

/**
 * A scoring key as a person reads it. Sleeper's keys are already the vocabulary
 * a league's own settings page uses, so they're shown as they are with the
 * underscores opened out — inventing display names for ~60 keys would be a table
 * to maintain and a second thing to look a key up under.
 */
export function scoringKeyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

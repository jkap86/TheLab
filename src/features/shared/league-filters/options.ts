import type { ManagerLeague } from "@/shared/manager";

import { COMMON_SCORING_KEYS } from "./defaults.ts";

/**
 * What the scoring rules' key menu offers, read off the leagues in hand.
 *
 * Read off the data for the reason the trades page's own menus are: what a
 * league pays for is a house rule, and a fixed list would offer keys nobody
 * scores while hiding the one someone actually wants to filter on.
 */

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
  // Ranked once into a map rather than through `indexOf` inside the comparator:
  // a season's leagues carry ~60 distinct keys, so the sort makes a few hundred
  // comparisons and each was two linear scans of a fifteen-element array.
  const rank = new Map(COMMON_SCORING_KEYS.map((key, i) => [key, i]));
  const at = (key: string) => rank.get(key) ?? COMMON_SCORING_KEYS.length;
  return keys.sort((a, b) => at(a) - at(b) || a.localeCompare(b));
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

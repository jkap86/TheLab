import { DEFAULT_SEASON, getNflState } from "@/shared/sleeper";

import { createSeasonResolver } from "./resolve";

export {
  createSeasonResolver,
  isPlausibleSeason,
  SEASON_TTL_MS,
} from "./resolve";
export type {
  SeasonResolver,
  SeasonResolverOptions,
  SeasonState,
} from "./resolve";

/**
 * The app's season resolver, wired to Sleeper.
 *
 * Cached on `globalThis` for the same reason the pg pool is: Next's dev/HMR
 * reloads would otherwise build a fresh resolver — and a fresh empty cache — on
 * every edit, turning one state call per six hours into one per reload.
 */
const globalForSeason = globalThis as unknown as {
  seasonResolver?: ReturnType<typeof createSeasonResolver>;
};

const resolver = (globalForSeason.seasonResolver ??= createSeasonResolver({
  fetchState: getNflState,
  fallback: DEFAULT_SEASON,
  // Read per call rather than captured, so setting it on a running process (a
  // platform config change plus a restart of one dyno) takes effect.
  override: () => process.env.NFL_SEASON_OVERRIDE,
}));

/**
 * The season the app operates in right now: `NFL_SEASON_OVERRIDE`, else
 * Sleeper's `state/nfl`, else {@link DEFAULT_SEASON}. Never throws.
 *
 * Call it where a season would otherwise be *defaulted* — a route with no
 * `?season`, a background tick — not deep inside a module. An explicitly
 * requested season must not come through here; see `./resolve`.
 */
export function getActiveSeason(): Promise<string> {
  return resolver.resolve();
}

/** Drop the cached season, forcing the next call to re-read Sleeper. */
export function resetActiveSeason(): void {
  resolver.reset();
}

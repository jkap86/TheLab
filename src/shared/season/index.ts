import { DEFAULT_SEASON, getNflState } from "@/shared/sleeper";

import { createSeasonResolver } from "./resolve";

export {
  createSeasonResolver,
  isPlausibleSeason,
  SEASON_FAILURE_BACKOFF_MS,
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
 * Cached on `globalThis` for the same reason the Sleeper limiter is: Next's
 * dev/HMR reloads would otherwise build a fresh resolver — and a fresh empty
 * cache — on every edit, turning one state call per six hours into one per
 * reload.
 */
const globalForSeason = globalThis as unknown as {
  seasonResolver?: ReturnType<typeof createSeasonResolver>;
};

const resolver = (globalForSeason.seasonResolver ??= createSeasonResolver({
  fetchState: getNflState,
  fallback: DEFAULT_SEASON,
  // Read per call rather than captured, so setting it on a running process
  // takes effect.
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

/**
 * The season this process already knows, or `undefined` — **without touching
 * Sleeper**: `NFL_SEASON_OVERRIDE`, else whatever {@link getActiveSeason} last
 * resolved. Never fetches, never returns a promise, never throws.
 *
 * For a caller whose *answer* does not depend on the season and whose
 * *bookkeeping* does — a read cache deciding how long to hold a season's entry.
 * Blocking such a read on Sleeper is the failure this exists to prevent, and
 * `undefined` is a legitimate answer there (the caller falls back to its
 * shortest, most conservative policy) where it never is for
 * {@link getActiveSeason}.
 *
 * **It is not a cheaper `getActiveSeason`.** A caller that needs *the* season —
 * a route defaulting `?season`, a background tick choosing what to read — must
 * still await that one, because `undefined` means "not yet resolved", not "no
 * season".
 */
export function peekActiveSeason(): string | undefined {
  return resolver.peekSeason();
}

/** Drop the cached season, forcing the next call to re-read Sleeper. */
export function resetActiveSeason(): void {
  resolver.reset();
}

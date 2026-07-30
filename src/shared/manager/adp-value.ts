/**
 * Turning ADP into a roster's draft-capital value.
 *
 * ADP is an *ordinal* rank — a draft position, where lower is better — so it
 * can't be summed as it stands: a deeper roster would only pile up a larger
 * (worse) number and a stud would *lower* the total. Two moves make it
 * summable. {@link adpValue} inverts it and puts it on a cardinal scale, and
 * {@link rosterAdpValue} adds those up across a roster the way `rosterKtcValue`
 * adds KeepTradeCut values. The curve is the whole point: the gap between pick 1
 * and pick 2 is worth far more than the gap between pick 100 and 101, so a plain
 * inversion (`maxPick − adp`) would overvalue bench depth and undervalue the
 * players a season is actually won with.
 *
 * Pure and free of runtime imports beyond the slot vocabulary and the ADP
 * filter defaults, so it unit-tests without a fetch — the same bar `rank.ts`,
 * `shares` and `filters` hold. Its cross-module value imports reach `ktc/roster`
 * and `projections/slots` relatively with a `.ts` extension, the mechanism those
 * files use between themselves: Node's test runner strips types but doesn't know
 * the `@/*` aliases.
 */

import { isSuperflexLineup } from "../ktc/roster.ts";
import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "../projections/slots.ts";
import { ADP_FILTER_DEFAULTS } from "./adp-filters.ts";
import type { AdpFilters, LeagueType, ScoringFormat } from "./adp-filters.ts";

/**
 * A pick-1 player is worth this; every later pick is worth a fraction of it.
 * The scale is arbitrary — these are relative "draft capital" points, not
 * fantasy points — but ten thousand keeps the numbers legible next to the KTC
 * board they sit beside in the card's picker.
 */
export const ADP_PEAK = 10_000;

/**
 * The steepness of the value curve, as three presets the reader picks from the
 * ADP bar — the number of times value halves across a league's whole *startable
 * pool* (see {@link adpValue}). `balanced` (4) makes a league's last startable
 * pick worth ~1/16 of the 1.01; `flat` keeps depth worth more, `steep`
 * concentrates value at the very top. A `Steepness` is the only knob on the
 * curve, and it is expressed in halvings-per-pool rather than picks so it means
 * the same thing in a shallow league and a deep one.
 *
 * The client writes these same three strings into its own `AdpControls` with no
 * compiler link — a matched pair, like the ADP board filters — so
 * {@link parseSteepness} tolerates anything unknown by falling back to the
 * default rather than trusting the query string.
 */
export const STEEPNESS_HALVINGS = { flat: 3, balanced: 4, steep: 5 } as const;
export type Steepness = keyof typeof STEEPNESS_HALVINGS;
export const DEFAULT_STEEPNESS: Steepness = "balanced";

/** Read a `steepness` query value, falling back to the default for anything unknown. */
export function parseSteepness(value: string | null | undefined): Steepness {
  return value != null && value in STEEPNESS_HALVINGS
    ? (value as Steepness)
    : DEFAULT_STEEPNESS;
}

/**
 * A league's startable pool: how many players get *started* across it — the
 * count of starting slots per team times the number of teams. Value should be
 * near zero by the edge of this pool, because everything past it is replacement
 * level, so it is what the curve is anchored to rather than raw pick count.
 *
 * {@link startingSlotCount} reuses the slot vocabulary so a new flex counts the
 * moment the solver learns it, the way {@link isSuperflexLineup} does.
 */
export function startingSlotCount(
  rosterPositions: readonly string[] | null,
): number {
  if (!rosterPositions) return 0;
  return rosterPositions.filter(
    (slot) => !NON_STARTING_SLOTS.has(slot) && SLOT_POSITIONS[slot] !== undefined,
  ).length;
}

/**
 * One player's value from their average draft position, anchored to a league's
 * startable pool rather than to a fixed pick count.
 *
 * `pool` is the league-wide count of starting slots (teams × starters per team);
 * `halvings` is how many times value halves across it (a {@link Steepness}). So
 * `(adp − 1) / pool` is how deep into the startable pool the pick sits, and the
 * curve is `PEAK · 2^(−halvings · that)`. Anchoring to the pool is what makes a
 * late first-rounder worth the same in a 10-team and a 14-team league, and a
 * deeper-starting league (superflex, extra flex, IDP) extend value further down
 * the board — because it starts more players. Rounded whole, and monotonically
 * decreasing in ADP.
 */
export function adpValue(adp: number, pool: number, halvings: number): number {
  // ADP is an average of 1-based pick numbers, so it is always ≥ 1 in practice;
  // the guard is only so a junk value can't hand back NaN or something above the
  // peak. `pool` is floored at 1 so a league with no slots on file can't divide
  // by zero — the caller supplies a fallback pool for that case.
  if (!Number.isFinite(adp) || adp <= 1) return ADP_PEAK;
  const p = pool > 0 ? pool : 1;
  return Math.round(ADP_PEAK * 2 ** ((-halvings * (adp - 1)) / p));
}

/** One roster's ADP-derived value, whole and split across its lineup. */
export type AdpRosterValue = {
  /** Every rostered player with an ADP value, summed. */
  total: number;
  /**
   * How many of `rostered` carried an ADP value. A player taken in too few of
   * the crawled drafts to have an average, or off the board entirely, has none —
   * so a shortfall here is normal, and it is the difference between a total that
   * covers a roster and one that covers half of it.
   */
  priced: number;
  /** Distinct players held, valued or not. */
  rostered: number;
  /**
   * `total` divided into what the best lineup starts and what it doesn't. Null
   * when there is no lineup to divide it by — a league with nothing left to
   * project. The total survives that; only the split needs a lineup.
   */
  split: { starters: number; bench: number } | null;
};

/**
 * A roster's ADP value, and how much of it is in the starting lineup.
 *
 * Deliberately the same shape and the same rules as `rosterKtcValue`: dedup the
 * roster (Sleeper pads unfilled slots with `""` or `"0"`), skip an id with no
 * value rather than count it as zero, and take `bench` as `total − starters` so
 * the three numbers reconcile and a lineup naming someone the roster doesn't
 * hold can't overdraw the bench. It is a parallel function rather than a reuse
 * of the KTC one so `shared/manager` needn't import `shared/ktc` for a non-KTC
 * purpose — the same call `leaguemate-shares` makes beside `shares`.
 */
export function rosterAdpValue({
  players,
  starters,
  values,
}: {
  /** Every rostered player id, reserve and taxi included. */
  players: readonly string[];
  /** The ids the best lineup starts, or null when there is no lineup to split by. */
  starters: readonly string[] | null;
  /** Player id → ADP value; ids with no value absent. */
  values: ReadonlyMap<string, number>;
}): AdpRosterValue {
  const rostered = [...new Set(players.filter((id) => id && id !== "0"))];

  let total = 0;
  let priced = 0;
  for (const id of rostered) {
    const value = values.get(id);
    if (value === undefined) continue;
    total += value;
    priced++;
  }

  if (!starters) {
    return { total, priced, rostered: rostered.length, split: null };
  }

  const starting = new Set(starters.filter((id) => id && id !== "0"));
  let startersValue = 0;
  for (const id of rostered) {
    if (!starting.has(id)) continue;
    startersValue += values.get(id) ?? 0;
  }

  return {
    total,
    priced,
    rostered: rostered.length,
    split: { starters: startersValue, bench: total - startersValue },
  };
}

/**
 * Scoring bucket from a league's `scoring_settings.rec`, mirroring the endpoint's
 * `SCORING_SQL` exactly (≥1 ppr, ≥0.5 half, else std). Seeding a board from a
 * league has to land it in the bucket that league would actually be counted in,
 * the same reason `adp-controls.deriveScoring` mirrors the same rule on the
 * client — otherwise "value this roster off boards like it" quietly reads off a
 * board the league isn't in.
 */
function scoringBucket(scoring: Record<string, number> | null): ScoringFormat {
  const rec = scoring?.rec;
  if (typeof rec !== "number" || Number.isNaN(rec)) return "std";
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "std";
}

/**
 * The ADP board that prices a given league: the crawled drafts most like it.
 *
 * ADP pooled across different games is meaningless (see `adp.ts`), so a roster is
 * valued against drafts that share the axes that move a player's price. Three
 * matter and are matched here: superflex (a quarterback is a first-round asset in
 * one and a bench piece in the other — the same board mistake `rosterKtcValue`
 * guards against), scoring, and the league type (a dynasty startup drafts rookies
 * where a redraft never sees them). Teams and rounds are left broad on purpose:
 * matching them too would shrink the sample to a handful of drafts and trade a
 * little pick-scale smearing for a lot of noise.
 */
export function adpBoardFor({
  season,
  rosterPositions,
  scoringSettings,
  leagueType,
}: {
  season: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  leagueType: LeagueType;
}): AdpFilters {
  return {
    seasons: [season],
    draft_types: [...ADP_FILTER_DEFAULTS.draft_types],
    draft_statuses: [...ADP_FILTER_DEFAULTS.draft_statuses],
    league_ids: null,
    league_types: [leagueType],
    scoring: [scoringBucket(scoringSettings)],
    best_ball: null,
    superflex: isSuperflexLineup(rosterPositions),
    rounds_min: null,
    rounds_max: null,
    teams_min: null,
    teams_max: null,
    min_picks: ADP_FILTER_DEFAULTS.min_picks,
    limit: ADP_FILTER_DEFAULTS.limit,
    offset: ADP_FILTER_DEFAULTS.offset,
  };
}

/**
 * A stable key for the board {@link adpBoardFor} produced, so leagues that share
 * one are priced by a single query rather than one apiece. Reads only the axes
 * that function varies — season, scoring, superflex and league type.
 */
export function boardSignature(filters: AdpFilters): string {
  return [
    filters.seasons?.[0] ?? "all",
    filters.scoring?.[0] ?? "any",
    filters.superflex,
    filters.league_types?.[0] ?? "any",
  ].join("|");
}

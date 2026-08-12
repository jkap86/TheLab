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
import { NO_LEAGUE_SCOPE_BODY } from "../query/parse.ts";
import type { LeagueScopeBody } from "../query/parse.ts";
import { ADP_FILTER_DEFAULTS, parseAdpFilters } from "./adp-filters.ts";
import type { AdpFilters, ScoringFormat } from "./adp-filters.ts";

/**
 * A pick-1 player is worth this; every later pick is worth a fraction of it.
 * The scale is arbitrary — these are relative "draft capital" points, not
 * fantasy points — but ten thousand keeps the numbers legible next to the KTC
 * board they sit beside in the card's picker.
 */
export const ADP_PEAK = 10_000;

/**
 * The steepness of the value curve: the number of times value halves across a
 * league's whole *startable pool* (see {@link adpValue}). The default, 4, makes
 * a league's last startable pick worth ~1/16 of the 1.01; a smaller number keeps
 * depth worth more, a larger one concentrates value at the very top. It is the
 * only knob on the curve, and it is expressed in halvings-per-pool rather than
 * picks so it means the same thing in a shallow league and a deep one.
 *
 * **It is a continuous number, not a set of presets.** It was three named
 * strings (`flat`/`balanced`/`steep`) that the client re-typed into its own
 * `AdpControls` with no compiler link — a matched pair like the ADP board
 * filters, and the one that didn't need to be: this is a single scalar with an
 * obvious ordering, so the client drives it with a slider and sends the number
 * itself. The bounds live here because the *curve* owns what a sane halving
 * count is; the client reads them (relatively, the way it already reads
 * `isSuperflexLineup`) rather than spelling its own.
 *
 * {@link parseSteepness} still tolerates junk by clamping to the range and
 * falling back to the default — a query string is never trusted.
 */
export const STEEPNESS_RANGE = { min: 2, max: 8, step: 0.25 } as const;

/**
 * **Measured against the trade market rather than guessed.** It was 4 — a
 * reasonable-sounding number of halvings and nothing more — and
 * `scripts/fit-adp-curve.ts` is what replaced it with a number: every completed
 * trade is a revealed near-indifference between two hauls, so the curve that
 * makes the fewest of them look lopsided is the curve the market is using.
 * Over 14,082 two-sided player-for-player trades of the 2026 season, scored on a
 * time-held-out fifth, the median `|log(ΣA / ΣB)|` bottoms out at **2.70** —
 * rounded here to the slider's own quarter-notch, since an off-grid default is
 * one the slider snaps away from the moment it is touched.
 *
 * Three things make it a reading rather than a number off a chart:
 *
 * - **It comes from the count-asymmetric trades, which are the only ones that
 *   carry the answer.** A 1-for-1 balances under *every* curve, so the even
 *   subset simply prefers the flattest one on offer and its argmin runs to
 *   whatever floor the search has (0.25, at the widest we looked). The
 *   asymmetric subset has a genuine interior minimum with the loss rising on
 *   both sides of it — 0.344 at the old default of 4, 0.269 at 2.5, 0.265 at
 *   2.70, 0.271 at 3, 0.290 at 3.5.
 * - **It replicates.** The fit lands at 2.70 pricing players at their mean and
 *   2.65 pricing them as an expectation over their pick distribution, which are
 *   two quite different valuations of the same hauls.
 * - **The one bias we know about points the other way**, so this is a ceiling
 *   rather than a midpoint. A 3-for-1 favours the consolidating side, because
 *   roster spots are scarce and nothing in this curve prices one; to balance
 *   fewer-but-better against many-lesser you need the top of the board worth
 *   *more*, so an uncorrected fit reads some of the price of a roster spot as
 *   steepness. The true figure is at most this.
 *
 * The knob stays a knob — it is a modeling choice and a reader may want a
 * steeper board — but its default is now a measurement, and re-running that
 * script is how to challenge it.
 */
export const DEFAULT_STEEPNESS = 2.75;

/**
 * Read a `steepness` query value: a number of halvings, clamped to
 * {@link STEEPNESS_RANGE}, with anything unparseable falling back to the
 * default. Clamping rather than rejecting is deliberate — an out-of-range curve
 * is a caller asking for more of something real, and the nearest curve on the
 * scale is a better answer than silently pricing every roster on the default.
 */
export function parseSteepness(value: string | null | undefined): number {
  // An empty parameter is an absent one, not zero — `Number("")` is 0, which
  // would clamp to the flattest curve on the scale rather than the default.
  const parsed = value == null || value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STEEPNESS;
  return Math.min(STEEPNESS_RANGE.max, Math.max(STEEPNESS_RANGE.min, parsed));
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
 * Starting slots assumed for a league with no lineup on file — a typical
 * 1QB/2RB/2WR/TE/2FLEX/K/DEF-ish depth. Only the fallback inside
 * {@link leagueAdpPool}; named so the number isn't retyped per caller.
 */
export const TYPICAL_STARTING_SLOTS = 9;

/**
 * The startable pool a league's value curve is anchored to: teams × starting
 * slots, falling back to a typical lineup depth so a league with no slots on
 * file can't collapse the curve to a pool of zero.
 *
 * This is the one place that composition lives — the league detail route and
 * the batched adp-value route both price rosters on it, and a fallback changed
 * in one and not the other would make the roster panel's ADP column and the
 * collapsed card's value quietly disagree for the same league.
 */
export function leagueAdpPool(
  teams: number,
  rosterPositions: readonly string[] | null,
): number {
  return teams * (startingSlotCount(rosterPositions) || TYPICAL_STARTING_SLOTS);
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
 * of the KTC one because the split rules belong to this module's own lens —
 * this file already reaches into `ktc/roster` for `isSuperflexLineup`, so the
 * boundary being kept is conceptual (ADP value is not a KTC number), not an
 * import restriction.
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
 * The axes of an ADP board a *reader* may set, as opposed to the ones a league
 * answers for itself.
 *
 * The split is the whole design of {@link adpBoardFor}, so it is a type rather
 * than a convention: everything here is a choice about which market to read, and
 * everything omitted — `scoring`, `superflex` — is a fact about the league being
 * priced, which the reader must not be able to override. A superflex roster
 * valued off 1QB drafts is wrong at every position, and the drawer's default for
 * both is "don't narrow", so accepting them would pool the two boards for every
 * reader who never touched the control.
 *
 * **The two league-id lists are the largest of the reader's choices and the last
 * to arrive**, and they are why a request carrying one comes in as a POST. The
 * drawer's own scoring, superflex, best-ball and size chips are league rules
 * now — the shared dialog the manager tabs and the trades board already use —
 * and those rules are a browser-side engine, so what reaches here is their
 * answer. It composes with the two axes above rather than competing with them: a
 * rule set narrows *which leagues' drafts* are on the board, and each league is
 * still priced against the scoring and superflex population it belongs to.
 *
 * The rest of `AdpFilters` is omitted for a duller reason: the draft types, the
 * statuses, `min_picks` and the paging are this route's own constants.
 */
/**
 * The two parameter names `/api/user/[username]/adp-value` reads that aren't
 * part of `/api/adp`'s own vocabulary — spelled once, here, because both ends of
 * them live in different packages and a query string is invisible to the
 * compiler. Renaming one and not the other is not a type error, it is a filter
 * that silently stops applying: the route falls back to the unnarrowed board and
 * every card goes on answering, just with the wrong number.
 *
 * `board_season` is not `season` on purpose. `?season` belongs to
 * `resolveManagerRequest` on all six routes under that prefix, where it means
 * *which season's leagues are on screen* and chooses the rosters to price — so a
 * board reusing the name would swap the card list out from under itself. Two
 * questions, two names.
 */
export const ADP_VALUE_PARAMS = {
  boardSeason: "board_season",
  steepness: "steepness",
} as const;

export type AdpBoardChoices = Pick<
  AdpFilters,
  | "seasons"
  | "start_after"
  | "start_before"
  | "league_ids"
  | "exclude_league_ids"
  | "best_ball"
  | "rounds_min"
  | "rounds_max"
  | "teams_min"
  | "teams_max"
>;

/**
 * The board a reader has chosen nothing about: this season, whole, every kind of
 * draft. What {@link adpBoardFor} falls back to when no board is supplied, and
 * what {@link parseAdpBoardChoices} answers for an empty query string.
 */
export function defaultBoardChoices(season: string): AdpBoardChoices {
  return {
    seasons: [season],
    start_after: null,
    start_before: null,
    league_ids: null,
    exclude_league_ids: null,
    best_ball: null,
    rounds_min: null,
    rounds_max: null,
    teams_min: null,
    teams_max: null,
  };
}

/**
 * The reader's board off a query string, for the two routes the ADP drawer
 * prices things on: the collapsed card's team value and the expanded panel's own
 * two value columns.
 *
 * It validates through {@link parseAdpFilters} rather than reading the eight
 * parameters itself, so `/api/adp` and these two share one definition of what a
 * board *is* — a second parser is the drift the contract rule exists to stop, and
 * it would show up as a filter that quietly stops narrowing rather than as a type
 * error.
 *
 * **The season is renamed on the way in**, which is the only awkward part and is
 * load-bearing. `?season` belongs to `resolveManagerRequest` on every route under
 * `/api/user/[username]`, where it means *which season's leagues are on screen*
 * and picks the rosters being priced; a board reusing that name would make moving
 * the drawer to 2024 swap the card list out from under itself. So the drawer
 * sends {@link ADP_VALUE_PARAMS.boardSeason} and this maps it back. The league
 * detail route has no `?season` of its own to collide with, and still reads the
 * same name — one spelling for one question beats a second that is only
 * accidentally free.
 *
 * `defaultSeason` is what an empty query string resolves to: the page's season
 * for the batch route, the league's own for the panel. `parseAdpFilters` reads it
 * only when the caller bounded the board neither by season nor by date, which a
 * live drawer never does.
 *
 * `scope` is the league ids off a POST body, on the same terms `/api/adp` takes
 * them — see {@link AdpBoardChoices}. Both routes reading this answer a POST for
 * that reason alone: the drawer's league rules resolve to a list that a request
 * line cannot carry, and a board the cards are priced on has to be the board the
 * drawer is showing.
 */
export function parseAdpBoardChoices(
  params: URLSearchParams,
  defaultSeason: string,
  scope: LeagueScopeBody = NO_LEAGUE_SCOPE_BODY,
): { ok: true; board: AdpBoardChoices } | { ok: false; error: string } {
  const boardParams = new URLSearchParams(params);
  boardParams.delete("season");
  const boardSeason = boardParams.get(ADP_VALUE_PARAMS.boardSeason);
  if (boardSeason) boardParams.set("season", boardSeason);

  const parsed = parseAdpFilters(boardParams, defaultSeason, scope);
  if (!parsed.ok) return parsed;

  const {
    seasons,
    start_after,
    start_before,
    league_ids,
    exclude_league_ids,
    best_ball,
    rounds_min,
    rounds_max,
    teams_min,
    teams_max,
  } = parsed.filters;
  return {
    ok: true,
    board: {
      seasons,
      start_after,
      start_before,
      league_ids,
      exclude_league_ids,
      best_ball,
      rounds_min,
      rounds_max,
      teams_min,
      teams_max,
    },
  };
}

/**
 * The ADP board that prices a given league: the crawled drafts most like it,
 * inside whatever population the reader asked for.
 *
 * ADP pooled across different games is meaningless (see `adp.ts`), so a roster is
 * valued against drafts that share the axes that move a player's price. Two are
 * matched here and **only** here, from the league itself: superflex (a
 * quarterback is a first-round asset in one and a bench piece in the other — the
 * same board mistake `rosterKtcValue` guards against) and scoring. The league
 * type is not one of the filters, because every ADP read now answers the redraft
 * and dynasty markets side by side — the caller reads the half matching the
 * league (`getLeagueAdpBoards`), so leagues of both types share one fetch.
 *
 * Everything else is the reader's, and that is the change worth knowing about.
 * The window, the kind of draft, the league size and the format used to be
 * hard-nulled here on the reasoning that matching them *to the league* would
 * shrink the sample to a handful of drafts and trade a little pick-scale
 * smearing for a lot of noise. That reasoning still holds and this doesn't
 * contradict it: a board narrowed by the ADP drawer is narrowed the *same way
 * for every league*, so the sample it leaves is a population the reader can see
 * the size of, not one silently cut per card. It is how the drawer's startup-only
 * default reaches these numbers, which is the point — a panel narrowed to
 * startups beside cards priced off rookie drafts was two answers to one question.
 */
export function adpBoardFor({
  season,
  rosterPositions,
  scoringSettings,
  board,
}: {
  season: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  /** The reader's board; omitted where there is no drawer behind the call. */
  board?: AdpBoardChoices | null;
}): AdpFilters {
  const chosen = board ?? defaultBoardChoices(season);
  return {
    ...chosen,
    draft_types: [...ADP_FILTER_DEFAULTS.draft_types],
    draft_statuses: [...ADP_FILTER_DEFAULTS.draft_statuses],
    // The two the reader may not set — see {@link AdpBoardChoices}.
    scoring: [scoringBucket(scoringSettings)],
    superflex: isSuperflexLineup(rosterPositions),
    min_picks: ADP_FILTER_DEFAULTS.min_picks,
    limit: ADP_FILTER_DEFAULTS.limit,
    offset: ADP_FILTER_DEFAULTS.offset,
  };
}

/**
 * A stable key for the board {@link adpBoardFor} produced, so leagues that share
 * one are priced by a single query rather than one apiece.
 *
 * It covers every axis the board carries, not only the two that vary *within* a
 * request. The reader's choices are constant across one call of the route, so
 * folding them in changes no grouping today — but a signature that named less
 * than the board it stands for is a collision waiting for the caller that starts
 * varying one, and the failure would be silent: leagues priced off somebody
 * else's window with nothing in the payload to say so.
 */
export function boardSignature(filters: AdpFilters): string {
  return [
    filters.seasons?.join(",") ?? "all",
    filters.scoring?.[0] ?? "any",
    filters.superflex,
    filters.start_after ?? "",
    filters.start_before ?? "",
    leagueScopePart(filters.league_ids),
    leagueScopePart(filters.exclude_league_ids),
    filters.best_ball,
    filters.rounds_min ?? "",
    filters.rounds_max ?? "",
    filters.teams_min ?? "",
    filters.teams_max ?? "",
  ].join("|");
}

/**
 * A league-id list as a signature segment: its length and its contents, joined
 * once per array rather than once per league.
 *
 * The contents and not a digest, because the whole point of the signature is
 * that it stands for the board *exactly* — a hash would trade a silent collision
 * for a shorter string, and a collision here is leagues priced off somebody
 * else's board with nothing in the payload to say so. What makes that
 * affordable is the memo: the reader's scope is one array shared by every league
 * in a request, so this joins a few thousand ids once and hands the same string
 * back for each of the hundred-odd leagues that read it. Without it the join ran
 * per league, which for a narrowed board is megabytes of identical string.
 *
 * A `WeakMap` rather than a cache with a policy: the key is the array the
 * request is holding, so the entry dies with the request.
 */
const joinedLeagueScopes = new WeakMap<readonly string[], string>();

function leagueScopePart(ids: readonly string[] | null): string {
  if (ids === null) return "";
  const memo = joinedLeagueScopes.get(ids);
  if (memo !== undefined) return memo;
  // The length leads so an empty list is still a segment — "the rules matched
  // nothing" is a board, and it must not read as the absent one above.
  const joined = `${ids.length}:${ids.join(",")}`;
  joinedLeagueScopes.set(ids, joined);
  return joined;
}

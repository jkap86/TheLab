/**
 * The NFL week vocabulary: how many weeks a regular season has, and how to read
 * one a caller asked for.
 *
 * Pure and free of runtime imports, so both the sync's week windows
 * (`manager/graph-weeks`) and the routes' query parsing can read it under
 * Node's test runner.
 *
 * `LAST_REGULAR_WEEK` lived in `manager/graph-weeks.ts` until the week-scoped
 * projections landed, and that file said why: it belongs beside the module that
 * also decides which weeks of projections to read, and "it moves back beside
 * projections when they arrive". This is that arrival. `manager` still
 * re-exports it, so nothing that imported it from there had to change.
 */

/**
 * Last week of the NFL regular season, and so the ceiling for a season that has
 * finished — and for any week a caller may ask about. The playoffs are a
 * different bracket per league and Sleeper keys them past this; nothing here
 * reads them.
 */
export const LAST_REGULAR_WEEK = 18;

/** Whether a number names a week of the regular season. */
export function isPlausibleWeek(week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= LAST_REGULAR_WEEK;
}

/**
 * What a `?week=` parameter resolved to: the week, or why it was refused.
 *
 * Shaped like `season/parseRequestedWeek`'s sibling `RequestedSeason` on
 * purpose — a route reading both should read them the same way.
 */
export type RequestedWeek =
  | { ok: true; week: number }
  | { ok: false; error: string };

/**
 * A `?week=` query parameter, in **three states rather than two**.
 *
 * `null` means *not asked*, and it is the only one a caller may fill from a
 * resolver. An invalid value is an error, never a silent fallback: collapsing
 * absent and invalid is how `?week=abc` quietly becomes the current week and a
 * reader is shown one week's lineup under another week's heading. It is the
 * same rule, for the same reason, that `parseRequestedSeason` documents at
 * length for `?season=`.
 *
 * Whitespace-only is treated as absent — a blank `?week=` is a URL builder's
 * artefact rather than anybody's question.
 */
export function parseRequestedWeek(raw: string | null): RequestedWeek | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const week = Number(trimmed);
  if (!isPlausibleWeek(week)) {
    return {
      ok: false,
      error: `Invalid week: expected 1-${LAST_REGULAR_WEEK}`,
    };
  }
  return { ok: true, week };
}

/**
 * A week clamped into the regular season.
 *
 * The preseason answers week 0 and the postseason counts past 18, and both are
 * weeks this app has no projections or matchups for — so each is folded to the
 * nearest week that exists rather than being refused, since the caller asking
 * is a *default* (see the route's resolve) and a default that fails is a page
 * that fails.
 */
export function clampWeek(week: number): number {
  if (!Number.isFinite(week)) return 1;
  return Math.min(Math.max(Math.trunc(week), 1), LAST_REGULAR_WEEK);
}

/**
 * The regular-season week Sleeper's state names — one field, read once.
 *
 * **`leg` rather than `week` or `display_week`, and the three are not
 * interchangeable.** `week` is the week within whatever `season_type` is
 * running, so in the preseason it counts preseason games under a number that
 * reads like a regular-season week. `display_week` is Sleeper's own hint about
 * what a UI should show, and it *lags the roll-over*: on the Tuesday after week
 * 1's last game it still read 1 while the week being prepared for was 2, which
 * is the whole of the bug this replaced — a page confidently headed `Week 1`
 * with nothing in it wrong except the number. `leg` is the week of the regular
 * season and nothing else: 0 before it starts, and the week being played or
 * prepared for once it has.
 *
 * **A `leg` of 0 is an answer rather than an absence**, so the fall-through is
 * on the field being *missing* and never on it being falsy. The offseason's 0
 * says "the season ahead is whole", which every caller here clamps to week 1;
 * read as absent it would fall through to `week` and answer a preseason game's
 * number. `week` is the fallback because it is the field `leg` agrees with all
 * regular season, so a state that somehow carries no `leg` degrades to what
 * this module read before. `display_week` is deliberately not in the ladder at
 * all: it is the reading that was wrong, and it stays on the type and in
 * `week:doctor`'s output so the difference can still be *seen*.
 *
 * Unclamped, deliberately. The callers want different ceilings — a page is
 * bounded by the regular season, a sync's fetch window is bounded by what
 * Sleeper will answer for — so the field is resolved here once and the bound is
 * each caller's own.
 */
export function stateWeek(state: NflStateLike): number {
  const { leg } = state;
  return typeof leg === "number" && Number.isFinite(leg) ? leg : state.week;
}

/**
 * The first week "rest of season" means for a page, or null where the season
 * has none left to project.
 *
 * Deliberately conservative about claiming a week, in three cases:
 *
 * - the page's season and Sleeper's current season agree → from the current
 *   week (floored at 1: preseason is `leg` 0, and the season ahead is whole);
 * - the page is on an *older* season → there is no rest-of-season, and no
 *   projections are read at all;
 * - the state call failed or named some other future — week 1, the widest
 *   honest window. A failed state call must not fail a page, and the
 *   projections span has its own fallback behind it.
 *
 * **It takes the state reader rather than calling one**, which is what keeps
 * this module free of the network and testable beside its neighbours — and what
 * lets the two routes that ask this question (the lineups route and the league
 * timeline, which must price a past roster on the same span the card in front
 * of it reads) share one answer rather than two spellings of it.
 */
export async function restOfSeasonStart(
  season: string,
  readState: () => Promise<NflStateLike | null>,
): Promise<number | null> {
  const state = await readState().catch(() => null);
  if (!state) return 1;

  if (state.season === season) {
    return clampWeek(stateWeek(state));
  }
  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested < current) {
    return null;
  }
  return 1;
}

/**
 * The last week "season to date" means for a page, or null where the season has
 * had none played.
 *
 * {@link restOfSeasonStart}'s mirror — that one answers where the projections
 * span *starts* and this answers where the stat span *ends*, so between them
 * the two cover the season and meet at the week being played. It takes its
 * state reader as an argument for that function's reason, and the two are
 * deliberately asked of the same state.
 *
 * Three arms, and **only one of them is the same call its mirror makes**:
 *
 * - the page's season is the one being played → through the current week,
 *   which is the week already partly in the books. A week nobody has finished
 *   contributes what has been scored in it so far, which is what "so far this
 *   season" means on a Sunday afternoon;
 * - the page is on an *older* season → the whole regular season. **This is the
 *   inversion, and it is the point**: a finished season has no rest to project
 *   and `restOfSeasonStart` correctly reads nothing, where the very same season
 *   has a complete and perfectly meaningful total. The one lens that answers
 *   for a past page is this one;
 * - the page names a season ahead of the one being played → null. Nothing has
 *   been scored in it, and reading the span anyway would be eighteen empty
 *   round trips to fold to the same nothing.
 *
 * **A state nobody could read answers the whole regular season, where its
 * mirror answers week 1** — and both are the same instinct rather than
 * opposite ones. Each names the widest window its span can honestly claim: an
 * unplayed week carries no stat line, so a span reaching past the present folds
 * to exactly what has been played and costs only the round trips. Its mirror
 * has the same property in the other direction.
 *
 * **A `leg` of 0 takes that widest window too**, which is the one arm that is
 * about the calendar rather than about the request. Zero is the week Sleeper
 * reports both *before* a regular season starts and in the months after one
 * ends (see {@link stateWeek}), and the two are not distinguishable from the
 * field. Read as week 1 the second would answer a finished season's total with
 * its opening Sunday, which is a wrong number where the first is only a set of
 * empty reads.
 */
export async function seasonToDateThrough(
  season: string,
  readState: () => Promise<NflStateLike | null>,
): Promise<number | null> {
  const state = await readState().catch(() => null);
  if (!state) return LAST_REGULAR_WEEK;

  if (state.season === season) {
    const week = stateWeek(state);
    // Never `clampWeek`, which folds 0 up to 1 — see the note above for why
    // this one case has to widen instead.
    return Number.isFinite(week) && week >= 1
      ? Math.min(Math.trunc(week), LAST_REGULAR_WEEK)
      : LAST_REGULAR_WEEK;
  }

  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested > current) {
    return null;
  }
  return LAST_REGULAR_WEEK;
}

/**
 * The week a live or lineup tool reads when the caller named none, or null
 * when the season has none left to read.
 *
 * The field it reads — and why it is no longer `display_week` — is
 * {@link stateWeek}'s own note. A season Sleeper has moved past has no week
 * left, and a state call that fails answers week 1: the widest honest window,
 * the fallback the lineups route takes too, and the one this module's own
 * history is a warning about — see `sleeper/memoize-nfl-state`'s `holdLastGood`,
 * which is what stops a *busy minute* reaching this branch at all.
 *
 * Takes its state reader as an argument on `restOfSeasonStart`'s terms: two
 * routes and a streaming room all ask this, and the module stays free of the
 * network so the rule can be pinned under Node's runner.
 */
export async function currentWeek(
  season: string,
  readState: () => Promise<NflStateLike | null>,
): Promise<number | null> {
  const state = await readState().catch(() => null);
  if (!state) return 1;

  if (state.season === season) {
    return clampWeek(stateWeek(state));
  }
  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested < current) {
    return null;
  }
  return 1;
}

/**
 * The fields of Sleeper's NFL state this module reads.
 *
 * `leg` is optional because a hand-built stub — the verification scripts', a
 * fixture's — may carry only the two fields that existed before it was read,
 * and {@link stateWeek}'s ladder is what makes that degrade rather than throw.
 * A real `SleeperNflState` always carries it.
 */
type NflStateLike = { season: string; week: number; leg?: number | null };

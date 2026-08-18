/**
 * Which drafts an ADP read matches, as SQL.
 *
 * **Pure, and split out from `./adp` for exactly the reason `shared/trades/sql`
 * is its own module: a mistake here is not an error, it is the wrong rows.**
 * Every fragment below is a string interpolated into a statement, so nothing
 * about it is visible to the compiler — a guard dropped from a cast fails one
 * league's whole query, a fragment that stops being parenthesised chains an `=`,
 * and a selection that quietly keeps the board's draft-type list where it must
 * not is a column of em dashes that looks like an empty corpus. Beside
 * `pool.query` none of that could be asserted at all.
 *
 * The slot vocabulary comes in relatively with a `.ts` extension, the mechanism
 * the pure modules already use between themselves — Node's test runner strips
 * types but does not know the `@/*` aliases. `AdpFilters` is an erased
 * `import type`, so this module has exactly one runtime dependency and it is
 * itself pure.
 */

import { QB_ELIGIBLE_STARTING_SLOTS } from "../ktc/roster.ts";
import type { AdpFilters } from "./adp-filters.ts";

/**
 * Sleeper's settings blobs are loosely typed and its defaults are omitted
 * entirely, so every numeric read is regex-guarded before the cast: a league
 * with `"type": "abc"` must not fail the whole query. Missing reads fall back
 * the same way the client-side league filters do (absent type = redraft).
 */
// Each fragment is parenthesised because callers append their own comparison.
// Written against a league table aliased `l`. Exported to `./queries`'
// `getLeagueTypes` so the code grouping leagues into ADP boards and the filter
// narrowing `/api/adp` can't classify the same league differently.
export const LEAGUE_TYPE_SQL = `
  (CASE WHEN l.settings->>'type' ~ '^[0-9]+$'
        THEN (l.settings->>'type')::int ELSE 0 END)`;

/**
 * Sleeper's `settings.type` for a dynasty league (0 redraft, 1 keeper, 3 its
 * native guillotine). Exported because `getLeagueDetail` asks the same question
 * of a league it has already read, and the fragment below is written from this
 * constant so the SQL and the TypeScript reading cannot drift apart.
 */
export const DYNASTY_LEAGUE_TYPE = 2;

/**
 * Which of the two ADP boards a league's drafts count into: dynasty is
 * Sleeper's `settings.type` 2, and everything else — redraft and keeper — is
 * the redraft board. See `ADP_BOARDS` in `./adp-filters` for why keeper folds
 * into redraft rather than into a bucket of its own.
 */
export const DYNASTY_BOARD_SQL = `(${LEAGUE_TYPE_SQL} = ${DYNASTY_LEAGUE_TYPE})`;

/**
 * Whether Sleeper seats this league's lineup for the manager.
 *
 * Exported for the two roster reads that have to *solve* such a league — where a
 * best-ball team's `starters` array is not what it is starting — for the reason
 * {@link LEAGUE_TYPE_SQL} is: the board's filter, the client's `isBestBall` and
 * the lineup solver all answer one question, and a league priced as best ball
 * here and solved as an ordinary one there is a difference no type can catch.
 * Absent or unparseable reads false, which is what Sleeper's omitted default
 * means and what the client's own predicate says.
 */
export const BEST_BALL_SQL = `
  (CASE WHEN l.settings->>'best_ball' ~ '^[0-9]+$'
        THEN (l.settings->>'best_ball')::int ELSE 0 END = 1)`;

const ROUNDS_SQL = `
  (CASE WHEN d.settings->>'rounds' ~ '^[0-9]+$'
        THEN (d.settings->>'rounds')::int END)`;

/**
 * Superflex means the lineup starts more than one quarterback — the same
 * question `isSuperflexLineup` answers in TypeScript, asked of the stored
 * blob. Counting QB-eligible slots rather than testing for `SUPER_FLEX` by
 * name keeps the two classifiers agreeing: a two-QB league with no literal
 * `SUPER_FLEX` slot is priced against the superflex board by `adpBoardFor`,
 * so its draft has to be counted into that same population here, or it is
 * averaged with (and pollutes) the 1QB drafts. The slot names interpolated
 * below come from our own closed vocabulary in `projections/slots`, not from
 * user input.
 */
const QB_SLOT_LIST = QB_ELIGIBLE_STARTING_SLOTS.map((s) => `'${s}'`).join(", ");
const SUPERFLEX_SQL = `
  (CASE WHEN jsonb_typeof(l.roster_positions) = 'array'
        THEN (SELECT count(*)
                FROM jsonb_array_elements_text(l.roster_positions) AS s(slot)
               WHERE s.slot IN (${QB_SLOT_LIST})) > 1
        ELSE false END)`;

/**
 * Scoring format from the per-reception value: Sleeper stores the rule, not the
 * label. Anything unparseable (or absent, which is standard scoring) reads std.
 */
const SCORING_SQL = `
  (CASE
     WHEN l.scoring_settings->>'rec' !~ '^-?[0-9]+(\\.[0-9]+)?$' THEN 'std'
     WHEN (l.scoring_settings->>'rec')::numeric >= 1 THEN 'ppr'
     WHEN (l.scoring_settings->>'rec')::numeric >= 0.5 THEN 'half_ppr'
     ELSE 'std'
   END)`;

/**
 * A bare `YYYY-MM-DD` against `drafts.start_time`, which Sleeper gives as epoch
 * milliseconds. The date is read in ET — the zone the rest of this app dates
 * things in (`TODAY_ET` in the projections reads) — rather than in whatever zone
 * the Node process happens to run in, which is why the conversion is here and
 * not in the parser. `offsetDays` shifts the boundary, so an inclusive end bound
 * is midnight of the following day.
 */
const startTimeMs = (placeholder: string, offsetDays = 0) =>
  `(extract(epoch from ((${placeholder}::date + ${offsetDays})::timestamp
     AT TIME ZONE 'America/New_York')) * 1000)`;

/**
 * Which drafts the selection matches on `type`.
 *
 * `"filters"` is the board's own `draft_types`, which is the answer for every
 * read of a *draft position*. `"auction"` overrides it with the one type that
 * list deliberately excludes — see {@link getDraftAuctionSpend}, which reads a
 * population the board is never averaged over and therefore cannot inherit the
 * board's type filter without answering nothing at all.
 */
export type DraftTypeScope = "filters" | "auction";

/**
 * The `WHERE` for the draft/league side of the query, plus the parameters it
 * binds. Returned together because the fragment's `$n` placeholders are
 * positions in this exact array — the caller appends its own params after.
 *
 * Exported for `./adp-auction`, which narrows the *same* population on the same
 * league and window rules and differs in exactly one clause. Two spellings of
 * this selection would be two boards a reader could not tell apart: the auction
 * share sits in a column beside the ADP, so the drafts behind the two numbers
 * have to be cut by the same rules or the row is comparing two markets.
 */
export function draftSelection(
  filters: AdpFilters,
  types: DraftTypeScope = "filters",
): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;
  const clauses: string[] = [];

  if (filters.seasons) clauses.push(`d.season = ANY(${bind(filters.seasons)}::varchar[])`);

  // A date bound drops drafts Sleeper never gave a `start_time` — they can't be
  // placed in time at all, so there is no honest side of the boundary for them.
  // An unbounded board still counts them, which is why "all time" can match more
  // drafts than a range covering every date on file.
  if (filters.start_after !== null) {
    clauses.push(`d.start_time >= ${startTimeMs(bind(filters.start_after))}`);
  }
  if (filters.start_before !== null) {
    // Exclusive against the next midnight, so the named end day is included whole.
    clauses.push(`d.start_time < ${startTimeMs(bind(filters.start_before), 1)}`);
  }
  // The literal is our own closed vocabulary (`DRAFT_TYPES` in `./adp-filters`),
  // not input; the caller chose the *scope*, never the string.
  if (types === "auction") {
    clauses.push(`d.type = 'auction'`);
  } else if (filters.draft_types.length > 0) {
    clauses.push(`d.type = ANY(${bind(filters.draft_types)}::varchar[])`);
  }
  if (filters.draft_statuses.length > 0) {
    clauses.push(`d.status = ANY(${bind(filters.draft_statuses)}::varchar[])`);
  }
  if (filters.rounds_min !== null) clauses.push(`${ROUNDS_SQL} >= ${bind(filters.rounds_min)}`);
  if (filters.rounds_max !== null) clauses.push(`${ROUNDS_SQL} <= ${bind(filters.rounds_max)}`);

  // The league rules' answer, in whichever of its two spellings was shorter on
  // the wire (see `AdpFilters.league_ids`). An empty include list is left as an
  // empty `ANY`, which matches nothing — the honest board for rules that matched
  // no league, and the reason this is not guarded on `length`.
  if (filters.league_ids) {
    clauses.push(`l.league_id = ANY(${bind(filters.league_ids)}::varchar[])`);
  }
  if (filters.exclude_league_ids && filters.exclude_league_ids.length > 0) {
    clauses.push(`l.league_id <> ALL(${bind(filters.exclude_league_ids)}::varchar[])`);
  }
  if (filters.scoring) clauses.push(`${SCORING_SQL} = ANY(${bind(filters.scoring)}::varchar[])`);
  if (filters.best_ball !== null) clauses.push(`${BEST_BALL_SQL} = ${bind(filters.best_ball)}`);
  if (filters.superflex !== null) clauses.push(`${SUPERFLEX_SQL} = ${bind(filters.superflex)}`);
  if (filters.teams_min !== null) clauses.push(`l.total_rosters >= ${bind(filters.teams_min)}`);
  if (filters.teams_max !== null) clauses.push(`l.total_rosters <= ${bind(filters.teams_max)}`);

  return { where: clauses.length > 0 ? clauses.join("\n       AND ") : "true", params };
}

/**
 * The draft/league join every read matches over, carrying which board each
 * draft counts into. The `$n` placeholders in `where` are positions in the
 * params array `draftSelection` returned alongside it.
 *
 * **Both aggregate readers spell it `AS MATERIALIZED`, and that keyword is the
 * single largest thing separating this board from a statement timeout.**
 * Postgres 12+ inlines a CTE referenced once, which is normally what you want
 * and is exactly wrong here: `dynasty` is a JSONB extraction, a regex match and
 * a cast, and inlining pushes that expression into every `FILTER` of every
 * aggregate above it — ten of them on the board read. So a fact about a *draft*
 * (6,963 of them) was being recomputed once per pick per aggregate: ~11M jsonb
 * lookups and ~11M regex matches, none of which appear in the query as written.
 * Materialized, it is computed 6,963 times and each `FILTER` is a boolean test.
 * Measured over 1.5M picks in 8,000 leagues, the board read went 2,872ms →
 * 590ms at the query and ~2.2s → ~0.5s end to end; pricing one roster's board
 * went from 573/1,094/13,978ms across three runs to a flat ~400ms.
 *
 * The rule generalises past this query: **a CTE column derived from JSONB, and
 * read by an aggregate `FILTER` or a `CASE`, has to be materialized.** The cost
 * is invisible in the SQL and shows up only in a plan, where the expression is
 * written out once per aggregate.
 *
 * `countMatchedDrafts` needs no such thing — it reads the join as a plain
 * subquery and evaluates the expression once per draft either way.
 */
export const matchedDraftsSql = (where: string) => `
    SELECT d.draft_id, ${DYNASTY_BOARD_SQL} AS dynasty
      FROM drafts d
      JOIN leagues l ON l.league_id = d.league_id
     WHERE ${where}`;

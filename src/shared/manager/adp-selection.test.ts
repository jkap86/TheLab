import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AdpFilters, DraftStatus, ScoringFormat } from "./adp-filters.ts";
import {
  BEST_BALL_SQL,
  DYNASTY_BOARD_SQL,
  DYNASTY_LEAGUE_TYPE,
  LEAGUE_TYPE_SQL,
  draftSelection,
  matchedDraftsSql,
} from "./adp-selection.ts";

/**
 * The board's selection, which is a string builder — so its regressions are
 * silent.
 *
 * These are **properties rather than snapshots**, the shape `shared/trades/sql`
 * settled on: every caller value arrives as a bound parameter and none is
 * spliced, every `$n` resolves to something actually pushed, a filter left out
 * emits no clause at all, and the fragments stay parenthesised so a call site
 * appending its own comparison does not chain an `=`. A snapshot would fail on
 * whitespace and pass on the one change that matters.
 */

const FILTERS: AdpFilters = {
  seasons: null,
  start_after: null,
  start_before: null,
  draft_types: [],
  draft_statuses: [],
  league_ids: null,
  exclude_league_ids: null,
  scoring: null,
  best_ball: null,
  superflex: null,
  rounds_min: null,
  rounds_max: null,
  teams_min: null,
  teams_max: null,
  min_picks: 2,
  limit: 200,
  offset: 0,
};

const filters = (over: Partial<AdpFilters> = {}): AdpFilters => ({
  ...FILTERS,
  ...over,
});

/** Every `$n` a fragment binds, as numbers. */
const placeholders = (sql: string): number[] =>
  [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

describe("the draft selection", () => {
  test("an empty filter set narrows nothing and binds nothing", () => {
    const { where, params } = draftSelection(filters());
    assert.equal(where, "true");
    assert.deepEqual(params, []);
  });

  test("every value arrives as a bound parameter, never spliced", () => {
    const { where, params } = draftSelection(
      filters({
        seasons: ["2026"],
        start_after: "2026-05-01",
        start_before: "2026-08-31",
        draft_types: ["snake"],
        draft_statuses: ["complete"],
        league_ids: ["l1", "l2"],
        exclude_league_ids: ["l3"],
        scoring: ["ppr"],
        best_ball: false,
        superflex: true,
        rounds_min: 12,
        rounds_max: 30,
        teams_min: 10,
        teams_max: 14,
      }),
    );

    for (const value of ["2026", "2026-05-01", "snake", "l1", "l3"]) {
      assert.ok(
        !where.includes(value),
        `${value} was spliced into the SQL instead of bound`,
      );
    }
    // `scoring` is checked by its comparison rather than by its value, because
    // the bucket names are also `SCORING_SQL`'s own output literals — a
    // substring probe cannot tell the fragment's `'ppr'` from a spliced one.
    assert.ok(where.includes("END) = $"));
    assert.ok(params.some((p) => Array.isArray(p) && p.includes("ppr")));
    // Every placeholder resolves to a value that was actually pushed, and every
    // pushed value is referenced — an off-by-one in the `params.push` idiom is
    // otherwise a query that binds the wrong column to the wrong filter.
    const used = new Set(placeholders(where));
    assert.equal(used.size, params.length);
    for (const n of used) assert.ok(n >= 1 && n <= params.length);
  });

  test("a filter left out emits no clause of its own", () => {
    const only = draftSelection(filters({ teams_min: 10 }));
    assert.equal(placeholders(only.where).length, 1);
    assert.deepEqual(only.params, [10]);
    assert.ok(!only.where.includes("d.type"));
    assert.ok(!only.where.includes("d.season"));
  });

  test("an empty include list is a clause, and an empty exclude list is not", () => {
    // The two are not symmetrical on purpose: rules that matched no league are a
    // real answer and an empty board, where nothing to exclude is no narrowing.
    const include = draftSelection(filters({ league_ids: [] }));
    assert.ok(include.where.includes("l.league_id = ANY"));
    const exclude = draftSelection(filters({ exclude_league_ids: [] }));
    assert.equal(exclude.where, "true");
  });
});

describe("the auction scope", () => {
  test("it pins the one draft type the board never averages", () => {
    const { where } = draftSelection(filters(), "auction");
    assert.ok(where.includes("d.type = 'auction'"));
  });

  test("it overrides the board's own draft types rather than intersecting them", () => {
    // The whole reason the scope exists. The board is always read with
    // `snake,linear` — so a selection that kept that list and added auction
    // would match nothing, and every auction share would be an em dash on every
    // board, which is indistinguishable from a corpus with no auctions in it.
    const { where, params } = draftSelection(
      filters({ draft_types: ["snake", "linear"] }),
      "auction",
    );
    assert.equal(where.match(/d\.type/g)?.length, 1);
    assert.ok(!params.some((p) => Array.isArray(p) && p.includes("snake")));
  });

  test("it narrows on everything else exactly as the board does", () => {
    // The other half of that rule: the two populations differ in the draft type
    // and in nothing else, or a row's ADP and its bid describe different markets.
    const over = {
      seasons: ["2026"],
      start_after: "2026-05-01",
      league_ids: ["l1"],
      scoring: ["ppr"] as ScoringFormat[],
      teams_min: 12,
      rounds_min: 12,
      best_ball: false,
      superflex: true,
      draft_statuses: ["complete"] as DraftStatus[],
    };
    const board = draftSelection(filters({ ...over, draft_types: ["snake"] }));
    const auction = draftSelection(filters({ ...over, draft_types: ["snake"] }), "auction");

    // Placeholders are renumbered on the auction side — the type clause it drops
    // bound one — so the comparison is of the clauses, not of their indices.
    const strip = (sql: string) => sql.replace(/\s+/g, " ").replace(/\$\d+/g, "$?");
    const boardClauses = strip(board.where).split(" AND ");
    const auctionClauses = strip(auction.where).split(" AND ");
    const dropType = (clauses: string[]) =>
      clauses.filter((c) => !c.includes("d.type"));
    assert.deepEqual(dropType(auctionClauses), dropType(boardClauses));
    // The type clause binds nothing, so the auction side is one parameter short
    // and every remaining `$n` still resolves.
    assert.equal(auction.params.length, board.params.length - 1);
  });
});

describe("the fragments the call sites append to", () => {
  test("each is parenthesised, so `${FRAG} = $1` is not a chained comparison", () => {
    for (const fragment of [LEAGUE_TYPE_SQL, BEST_BALL_SQL, DYNASTY_BOARD_SQL]) {
      const trimmed = fragment.trim();
      assert.ok(trimmed.startsWith("("), `${trimmed.slice(0, 40)}… is unparenthesised`);
      assert.ok(trimmed.endsWith(")"));
    }
  });

  test("the dynasty board is written from the constant, not from a second 2", () => {
    // The SQL grouping a draft into a board and the TypeScript asking the same
    // question of a read league have to stay one rule.
    assert.ok(DYNASTY_BOARD_SQL.includes(`= ${DYNASTY_LEAGUE_TYPE}`));
  });

  test("the matched-drafts join carries the board flag and the caller's where", () => {
    const sql = matchedDraftsSql("d.season = $1");
    assert.ok(sql.includes("FROM drafts d"));
    assert.ok(sql.includes("JOIN leagues l ON l.league_id = d.league_id"));
    assert.ok(sql.includes("AS dynasty"));
    assert.ok(sql.includes("WHERE d.season = $1"));
  });
});

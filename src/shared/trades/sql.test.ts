import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { TradeCircleScope } from "./circle.ts";
import type { TradeQuery } from "./params.ts";
import {
  PICK_TOKEN_SQL,
  STARTUP_DRAFT_CTE,
  STARTUP_DRAFT_SQL,
  TRADES_POPULATION_SQL,
  TRADE_COLUMNS_SQL,
  TRADE_ORDER_SQL,
  TRADE_SORT_SQL,
  jsonbArraySql,
  tradeCursorSql,
  tradeFilterSql,
  tradeNarrowingSql,
  tradeScopeSql,
} from "./sql.ts";

/**
 * The `WHERE` builder is the one place a reader's selection becomes SQL, and the
 * way it fails is the way this codebase most guards against elsewhere: not an
 * error, but *silently the wrong rows*. So these test the properties the module
 * rests on rather than the strings it emits — that every caller value is bound
 * and none is spliced, that the placeholders it writes resolve to the values it
 * pushed, that `all` and `any` are two different questions in all three
 * categories, and that a bound is never one of the alternatives.
 *
 * The population and ordering constants are pinned against the migration that
 * indexes them, which is the agreement no type can carry.
 */

/** A neutral query: every filter off, which is the board's opening state. */
const query = (overrides: Partial<TradeQuery> = {}): TradeQuery => ({
  season: "2026",
  leagues: null,
  excludeLeagues: null,
  user: null,
  circle: "all",
  from: null,
  to: null,
  players: [],
  picks: [],
  managers: [],
  match: "all",
  limit: 200,
  cursor: null,
  ...overrides,
});

/**
 * Build a fragment the way a route does — `params` already holding the season as
 * `$1`, so the indices this writes start at 2 and the alignment being asserted is
 * the real one.
 */
function build(q: TradeQuery, circle: TradeCircleScope | null = null) {
  const params: unknown[] = [q.season];
  const sql = tradeFilterSql(q, params, circle);
  return { sql, params, bound: params.slice(1) };
}

/** Every `$n` the fragment references. */
const placeholders = (sql: string): number[] =>
  [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

describe("tradeFilterSql", () => {
  test("an unnarrowed board adds nothing at all", () => {
    // The state the page opens in: the fragment has to be empty, or the
    // unnarrowed read stops being the plain population query with a LIMIT.
    const { sql, bound } = build(query());
    assert.equal(sql, "");
    assert.deepEqual(bound, []);
  });

  test("every caller value is bound, and none is spliced into the SQL", () => {
    // The property the module exists to keep. The values are shaped like an
    // injection so a splice is unmistakable rather than merely wrong.
    const hostile = "x'; DROP TABLE transactions; --";
    const { sql, bound } = build(
      query({
        leagues: [hostile],
        excludeLeagues: [`${hostile}/exclude`],
        players: [`${hostile}/player`],
        picks: [`${hostile}/pick`],
        managers: [`${hostile}/manager`],
        from: 1_700_000_000_000,
        to: 1_800_000_000_000,
      }),
      { kind: "traders", ids: [`${hostile}/circle`] },
    );

    assert.ok(!sql.includes("DROP TABLE"), "no caller value reached the SQL");
    assert.ok(!sql.includes("1700000000000"), "not even the numeric bounds");
    // Every one of them arrived as a parameter instead.
    const flat = bound.flatMap((v) => (Array.isArray(v) ? v : [v]));
    for (const suffix of ["", "/exclude", "/player", "/pick", "/manager", "/circle"]) {
      assert.ok(
        flat.includes(`${hostile}${suffix}`),
        `${suffix || "leagues"} was not bound`,
      );
    }
    assert.ok(flat.includes(1_700_000_000_000) && flat.includes(1_800_000_000_000));
  });

  test("every placeholder it writes resolves to a value it pushed", () => {
    // The `$${params.push(v)}` idiom is only correct while the array it pushes
    // onto is the one the query is run with; an off-by-one here binds a filter
    // to the wrong value rather than failing.
    const { sql, params } = build(
      query({
        leagues: ["l1"],
        excludeLeagues: ["l2"],
        from: 1,
        to: 2,
        players: ["p1"],
        picks: ["2026-1", "2027-2"],
        managers: ["u1"],
      }),
      { kind: "leagues", ids: ["l3"] },
    );

    const used = placeholders(sql);
    assert.ok(used.length > 0);
    for (const n of used) {
      assert.ok(n >= 2, `$${n} would collide with the season at $1`);
      assert.ok(n <= params.length, `$${n} has no value pushed for it`);
    }
    // The counts a distinct-match compares against are bound too, not written in.
    assert.ok(params.includes(2), "the pick token count is a parameter");
  });

  test("a selection of one is not wrapped, and several are", () => {
    // The fragments are `AND`-joined by the caller, so an `OR` between selections
    // has to carry its own parentheses or it would bind looser than the joins
    // around it and quietly widen the board.
    const one = build(query({ players: ["p1"], match: "any" })).sql;
    assert.ok(!one.includes("("), "a lone selection needs no grouping");

    const many = build(
      query({ players: ["p1"], picks: ["2026-1"], match: "any" }),
    ).sql;
    const selection = many.slice(many.indexOf("AND ") + 4).trim();
    assert.ok(
      selection.startsWith("(") && selection.endsWith(")"),
      "an OR of selections is parenthesised",
    );
  });

  describe("all and any are two different questions", () => {
    test("players: every key present, or any of them", () => {
      // jsonb key existence: `?&` is all, `?|` is any.
      assert.match(build(query({ players: ["a", "b"] })).sql, /\?&/);
      assert.match(
        build(query({ players: ["a", "b"], match: "any" })).sql,
        /\?\|/,
      );
    });

    test("picks: all counts distinctly, any merely exists", () => {
      // The documented rule: a trade carrying two 2026 firsts must not satisfy a
      // two-token selection on its own, so the match is counted DISTINCT and
      // compared to the number of tokens asked for.
      const all = build(query({ picks: ["2026-1", "2027-1"] }));
      assert.match(all.sql, /count\(DISTINCT/);
      assert.ok(all.bound.includes(2), "compared against the token count");

      const any = build(query({ picks: ["2026-1", "2027-1"], match: "any" }));
      assert.match(any.sql, /EXISTS/);
      assert.doesNotMatch(any.sql, /count\(DISTINCT/);
    });

    test("managers: all counts distinct owners, any merely exists", () => {
      const all = build(query({ managers: ["u1", "u2"] }));
      assert.match(all.sql, /count\(DISTINCT r\.owner_id\)/);
      assert.ok(all.bound.includes(2));

      const any = build(query({ managers: ["u1", "u2"], match: "any" }));
      assert.match(any.sql, /EXISTS/);
      assert.doesNotMatch(any.sql, /count\(DISTINCT/);
    });

    test("the mode joins the categories, not just the values inside one", () => {
      // Probed with players and picks, which emit no `OR` of their own, so the
      // one being asserted can only have come from the mode.
      const all = build(query({ players: ["p"], picks: ["2026-1"] })).sql;
      const any = build(
        query({ players: ["p"], picks: ["2026-1"], match: "any" }),
      ).sql;
      assert.ok(all.includes(" AND ") && !all.includes(" OR "));
      assert.ok(any.includes(" OR "));
    });

    test("a manager is matched whether Sleeper wrote the roster id as a number or a string", () => {
      // `assembleTrade` carries the same defensiveness, and a filter that only
      // read one spelling would silently miss half the trades in a league stored
      // under the other. It is `jsonb_array_elements_text` that provides it here
      // — it flattens a number and a string to the same text — which is also
      // what keeps the subquery a function of `t`; see `tradedByOwnersSql`.
      for (const q of [query({ managers: ["u"] }), query({ managers: ["u"], match: "any" })]) {
        const sql = build(q).sql;
        assert.match(sql, /jsonb_array_elements_text\(CASE WHEN jsonb_typeof\(t\.roster_ids\)/);
        assert.match(sql, /CASE WHEN ri ~ '\^\[0-9\]\+\$' THEN ri::int END/);
      }
    });

    test("the managers filter and the traders circle are one fragment", () => {
      // They ask the identical question of different id lists, and two
      // spellings of it is exactly the drift this module exists to prevent —
      // the managers filter was the copy that stayed decorrelatable, which made
      // it the slowest narrowing on the board. Compared with the bound index
      // normalised away, since that is the only thing that legitimately differs.
      const strip = (s: string) => s.replace(/\$\d+/g, "$n").replace(/\s+/g, " ").trim();
      const filter = strip(build(query({ managers: ["u"], match: "any" })).sql);
      const circle = strip(build(query(), { kind: "traders", ids: ["u"] }).sql);
      assert.ok(
        filter.includes(circle.replace(/^AND /, "")),
        "the managers filter no longer reads the traders circle's fragment",
      );
    });
  });

  describe("the window is a bound, never one of the alternatives", () => {
    test("an absent bound narrows nothing", () => {
      assert.equal(build(query({ from: null, to: null })).sql, "");
    });

    test("a bound still ANDs under `any`", () => {
      // "Any of these players" widens the selection; the window it happened in
      // is not one of the things being chosen between. Inside the OR group it
      // would stop bounding anything the moment a selection matched.
      const { sql } = build(
        query({ players: ["a"], picks: ["2026-1"], match: "any", from: 1 }),
      );
      // Selections are pushed last, so the trailing group is that OR.
      const group = sql.slice(sql.lastIndexOf(" AND (") + " AND ".length);
      assert.ok(group.includes(" OR "), "the selection is an OR group");
      assert.ok(
        !group.includes("IS NOT NULL"),
        "and the window is not inside it",
      );
      assert.ok(
        sql.indexOf("IS NOT NULL") < sql.lastIndexOf(" AND ("),
        "the window is its own conjunct, ahead of the group",
      );
    });

    test("an undated trade is dropped by either bound", () => {
      // Deliberate, and the reason the guard is spelled rather than left to
      // comparison semantics: there is no honest side of the boundary for a
      // trade Sleeper filed with no timestamp. `coalesce(…, 0)` would put it in
      // 1970 and let an upper bound keep it.
      for (const q of [query({ from: 1 }), query({ to: 2 })]) {
        assert.match(build(q).sql, /IS NOT NULL AND/);
      }
      assert.doesNotMatch(build(query({ from: 1, to: 2 })).sql, /coalesce\([^)]*, 0\)/);
    });

    test("the bounds are the halves they claim to be", () => {
      assert.match(build(query({ from: 1 })).sql, />=/);
      assert.match(build(query({ to: 2 })).sql, /</);
    });
  });

  describe("the league lists", () => {
    test("include and exclude are complements, both bound as arrays", () => {
      const inc = build(query({ leagues: ["a"] }));
      assert.match(inc.sql, /t\.league_id = ANY\(\$2::varchar\[\]\)/);
      assert.deepEqual(inc.bound, [["a"]]);

      const exc = build(query({ excludeLeagues: ["a"] }));
      assert.match(exc.sql, /NOT \(t\.league_id = ANY/);
    });

    test("an empty include list is an empty board, not an unnarrowed one", () => {
      // Null and [] mean different things upstream: [] is "the reader's league
      // rules matched nothing", and answering that with every trade in the
      // season would be the opposite of what was asked.
      const { sql, bound } = build(query({ leagues: [] }));
      assert.match(sql, /= ANY\(/);
      assert.deepEqual(bound, [[]]);
    });
  });

  describe("the circle", () => {
    const forKind = (kind: TradeCircleScope["kind"]) =>
      build(query(), { kind, ids: ["u1"] } as TradeCircleScope).sql;

    test("its three shapes are three different reads", () => {
      const [leagues, members, traders] = (
        ["leagues", "members", "traders"] as const
      ).map(forKind);
      assert.notEqual(leagues, members);
      assert.notEqual(members, traders);
      // Leagues is a plain column test; the other two have to reach a table.
      assert.doesNotMatch(leagues, /EXISTS/);
      assert.match(members, /league_users/);
      assert.match(traders, /rosters/);
    });

    test("the traders circle unnests roster_ids, which is a planner decision", () => {
      // Written as `FROM rosters WHERE r.league_id = t.league_id` the subquery is
      // decorrelatable and the planner hash-joins the whole population — 205ms
      // against 9ms, and flat with depth only this way. Unnesting makes it a
      // function of `t` so it cannot be pulled up.
      const traders = forKind("traders");
      assert.match(traders, /jsonb_array_elements_text/);
      assert.match(traders, /r\.league_id = t\.league_id/);
      assert.doesNotMatch(
        traders,
        /FROM rosters r\s+WHERE/,
        "rosters must not be the driving relation, or the subquery decorrelates",
      );
    });

    test("a junk roster id yields null rather than failing the board", () => {
      // The house rule about regex-guarding a cast, and it sits *inside* the join
      // condition: the cast is what the index lookup is built from, so it is
      // evaluated whatever the planner does with a filter one level up.
      const traders = forKind("traders");
      assert.match(traders, /CASE WHEN ri ~ '\^\[0-9\]\+\$' THEN ri::int END/);
    });

    test("it ANDs with the selection rather than joining it", () => {
      // "Any of these two players, in my leagues" is the only reading of a circle
      // and a selection together — the circle is where the reader is standing,
      // not one of the things they picked.
      const { sql } = build(
        query({ players: ["a"], picks: ["2026-1"], match: "any" }),
        { kind: "leagues", ids: ["l1"] },
      );
      const circleAt = sql.indexOf("t.league_id = ANY");
      const orAt = sql.indexOf(" OR ");
      assert.ok(circleAt >= 0 && orAt > circleAt, "the circle is outside the OR");
    });
  });
});

describe("the scope and narrowing halves", () => {
  /**
   * The board reads `tradeFilterSql` and the two denominators read the halves,
   * so if the halves are not *exactly* the whole the count stops describing the
   * rows — silently, since both still answer. These pin the identity itself
   * rather than either half's contents.
   */
  const shapes: [string, Partial<TradeQuery>, TradeCircleScope | null][] = [
    ["nothing", {}, null],
    ["leagues only", { leagues: ["a", "b"] }, null],
    ["circle only", {}, { kind: "traders", ids: ["u1"] }],
    ["window only", { from: 1, to: 2 }, null],
    [
      "everything, all",
      { leagues: ["a"], excludeLeagues: ["b"], from: 1, to: 2, players: ["p"], picks: ["2026-1"], managers: ["u"] },
      { kind: "members", ids: ["u2"] },
    ],
    [
      "everything, any",
      { leagues: ["a"], from: 1, players: ["p", "q"], picks: ["2026-1"], managers: ["u"], match: "any" as const },
      { kind: "leagues", ids: ["l1"] },
    ],
  ];

  for (const [label, overrides, circle] of shapes) {
    test(`${label}: the halves concatenate to the whole, params and all`, () => {
      const whole: unknown[] = ["2026"];
      const combined = tradeFilterSql(query(overrides), whole, circle);

      const split: unknown[] = ["2026"];
      const scope = tradeScopeSql(query(overrides), split, circle);
      const narrowing = tradeNarrowingSql(query(overrides), split);

      // The narrowing half is bare so it can sit inside a `FILTER (WHERE …)`;
      // joined back on, it has to reproduce the board's own `WHERE` byte for
      // byte, and the values have to land on the same `$n`.
      assert.equal(scope + (narrowing ? ` AND ${narrowing}` : ""), combined);
      assert.deepEqual(split, whole);
    });
  }

  test("a bare narrowing is a legal FILTER predicate", () => {
    // Not merely non-empty: a leading `AND` here is a syntax error rather than
    // a wrong answer, which is the one failure mode this shape adds.
    const sql = tradeNarrowingSql(query({ from: 1, players: ["p"] }), ["2026"]);
    assert.ok(sql.length > 0);
    assert.ok(!sql.trimStart().startsWith("AND"));
  });
});

describe("the startup-draft CTE", () => {
  test("the header names the relation the population reads", () => {
    // Four reads open with this and every one of them refers to `startup_draft`
    // in the population fragment; naming them apart is a syntax error in only
    // one direction, so the agreement is asserted rather than trusted.
    assert.ok(STARTUP_DRAFT_CTE.startsWith("WITH startup_draft AS ("));
    assert.ok(STARTUP_DRAFT_CTE.includes(STARTUP_DRAFT_SQL));
    assert.match(TRADES_POPULATION_SQL, /FROM startup_draft sd/);
  });
});

describe("tradeCursorSql", () => {
  test("resumes with a row comparison, both halves bound", () => {
    // A row comparison is the form the planner recognises as an index-ordered
    // start position; the expanded `a < x OR (a = x AND b < y)` costs a filter
    // over the whole index range instead.
    const params: unknown[] = ["2026"];
    const sql = tradeCursorSql({ at: 42, transaction_id: "t9" }, params);
    assert.match(sql, /\(coalesce\(t\.status_updated, t\.created, 0\), t\.transaction_id\) </);
    assert.deepEqual(params.slice(1), [42, "t9"]);
    assert.ok(!sql.includes("t9"), "the id is a parameter, not spliced");
  });

  test("it resumes on the same expression the board is ordered by", () => {
    // Two spellings of the sort key would resume from a position the ordering
    // never produced — rows dropped and duplicated across the page seam.
    assert.ok(
      tradeCursorSql({ at: 1, transaction_id: "x" }, ["2026"]).includes(
        TRADE_SORT_SQL,
      ),
    );
    assert.ok(TRADE_ORDER_SQL.includes(TRADE_SORT_SQL));
  });
});

describe("the ordering agrees with the index built for it", () => {
  test("the sort expression is the one transactions_trade_keyset_idx holds", () => {
    // No type can carry this agreement, and breaking it is silent: the ordering
    // still answers, it just stops being an index walk and becomes a sort of the
    // season. The index is the source of truth, so the constant is checked
    // against the migration that creates it.
    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) => n.includes("trade_keyset_index"));
    assert.ok(file, "the keyset index migration is still there");
    const migration = readFileSync(join(dir, file), "utf8");

    const normalise = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    assert.ok(
      normalise(migration).includes(normalise(TRADE_SORT_SQL.replace(/t\./g, ""))),
      "TRADE_SORT_SQL no longer matches the indexed expression",
    );
    assert.ok(
      normalise(migration).includes("transaction_iddesc"),
      "the tiebreaker the order is total by is still indexed",
    );
  });

  test("the population is the partial index's own predicate", () => {
    // The index is partial on exactly these two, so a read that widened past
    // them would silently fall off it.
    assert.match(TRADES_POPULATION_SQL, /t\.type = 'trade' AND t\.status = 'complete'/);
  });
});

describe("STARTUP_DRAFT_SQL", () => {
  // Three decisions are packed into one statement, and each is a way of getting
  // the startup boundary wrong. None of them is visible to a type.

  test("it takes the league's *first* draft, not its latest", () => {
    // An inaugural dynasty league runs a rookie draft after its startup in the
    // same league year; bounding on the later draft's last pick hides months of
    // real trades between the two.
    assert.match(STARTUP_DRAFT_SQL, /DISTINCT ON \(d\.league_id\)/);
    assert.match(STARTUP_DRAFT_SQL, /ORDER BY d\.league_id, d\.start_time ASC NULLS LAST/);
  });

  test("an undated draft is the fallback rather than the answer", () => {
    // `NULLS LAST` on an ascending order is what makes a stray draft with no
    // start time lose to any dated one — and the `draft_id` behind it is what
    // keeps the pick deterministic when two drafts tie.
    assert.match(STARTUP_DRAFT_SQL, /NULLS LAST, d\.draft_id/);
  });

  test("no previous league is what makes a draft a startup, in all three spellings", () => {
    // A continuing dynasty's draft is a rookie draft — additive to rosters that
    // already exist — so it bounds nothing and the league is simply absent here.
    // Sleeper spells the empty case as null, '' and '0' depending on vintage.
    assert.match(STARTUP_DRAFT_SQL, /coalesce\(l\.previous_league_id, ''\) IN \('', '0'\)/);
  });

  test("it selects the two columns the boundary is read from, and filters on neither", () => {
    // `last_picked` alone can't say whether the startup is over, so the status
    // travels with it; filtering the unusable rows out *here* is what left an
    // unfinished startup looking like a league with no boundary at all.
    assert.match(STARTUP_DRAFT_SQL, /d\.last_picked/);
    assert.match(STARTUP_DRAFT_SQL, /d\.status/);
    assert.doesNotMatch(STARTUP_DRAFT_SQL, /d\.status\s*=\s*'complete'/);
    assert.doesNotMatch(STARTUP_DRAFT_SQL, /d\.last_picked IS NOT NULL/);
  });

  test("it is scoped to the season the board is reading, as $1", () => {
    // The same parameter the population binds, so the two cannot describe
    // different seasons within one read.
    assert.match(STARTUP_DRAFT_SQL, /l\.season = \$1/);
    assert.deepEqual([...STARTUP_DRAFT_SQL.matchAll(/\$(\d+)/g)].map((m) => m[1]), ["1"]);
  });
});

describe("the startup boundary in the population", () => {
  test("it is a NOT EXISTS, so a league with no startup row is never rejected", () => {
    // The exact rewrite of the join form it replaced: a trade was kept when
    // there was no startup row *or* the row permitted it, so it is dropped
    // exactly when a row exists and rejects it.
    assert.match(TRADES_POPULATION_SQL, /AND NOT EXISTS \(\s*SELECT 1 FROM startup_draft sd/);
    assert.match(TRADES_POPULATION_SQL, /sd\.league_id = t\.league_id/);
  });

  test("a status Sleeper didn't send is inert, not evidence of a running draft", () => {
    // Hiding a whole league's trades on a missing field is the louder failure,
    // so unknown reads as finished.
    assert.match(TRADES_POPULATION_SQL, /sd\.status IS NOT NULL AND sd\.status <> 'complete'/);
  });

  test("an unfinished startup rejects the league's trades outright", () => {
    // The running edge is not a boundary: a trade made in the draft room lands
    // *after* the pick before it, so a moving cutoff lets through the entire
    // population it exists to drop. Until the startup ends there is no
    // post-startup market to be reading, and that clause stands alone — not
    // `AND`ed with a last-pick test that would neutralise it.
    const clause = TRADES_POPULATION_SQL.slice(TRADES_POPULATION_SQL.indexOf("sd.status IS NOT NULL"));
    assert.match(clause, /^sd\.status IS NOT NULL AND sd\.status <> 'complete'\)?\s*\n?\s*(--[^\n]*\n\s*)*OR /);
  });

  test("an absent or zero last pick is no cutoff", () => {
    // A draft nobody has picked in, or one stored before the column existed,
    // keeps every trade — which is what makes this inert until the crawler has
    // re-visited a league, rather than wrong in the meantime. Comparing above
    // zero reads a zero as the absent value Sleeper means by it, not as 1970.
    assert.match(TRADES_POPULATION_SQL, /sd\.last_picked IS NOT NULL AND sd\.last_picked > 0/);
  });

  test("an undated trade is dropped only in a league that has a boundary", () => {
    // There is no honest side of the cutoff to put it on — the same rule the
    // date filters and /api/adp follow for an undated draft. It sits *inside*
    // the last-pick branch, so a league with no boundary keeps it.
    const branch = TRADES_POPULATION_SQL.slice(
      TRADES_POPULATION_SQL.indexOf("sd.last_picked > 0"),
    );
    assert.match(branch, /coalesce\(t\.status_updated, t\.created\) IS NULL\s*\n?\s*OR/);
  });

  test("the season is bound, not spliced, and both halves read the same $1", () => {
    assert.match(TRADES_POPULATION_SQL, /l\.season = \$1/);
    const used = new Set([...TRADES_POPULATION_SQL.matchAll(/\$(\d+)/g)].map((m) => m[1]));
    assert.deepEqual([...used], ["1"], "the population binds nothing but the season");
  });
});

describe("TRADE_COLUMNS_SQL", () => {
  test("the epoch columns are cast out of BIGINT's string form", () => {
    // `pg` hands a bigint back as a *string* to avoid overflowing a JS number,
    // and `assembleTrade` compares and sorts these — cast in the query rather
    // than converted in TypeScript, the house rule for a numeric column.
    assert.match(TRADE_COLUMNS_SQL, /t\.created::float8\s+AS created/);
    assert.match(TRADE_COLUMNS_SQL, /t\.status_updated::float8\s+AS status_updated/);
  });

  test("it carries every column a trade is assembled from", () => {
    // Sleeper's flat maps: `adds` is player → roster, the picks and the budget
    // carry their own owners, and `roster_ids` is what the sides come from —
    // dropping any one of them leaves a card with a side it cannot draw.
    for (const column of [
      "t.transaction_id",
      "t.league_id",
      "t.week",
      "t.roster_ids",
      "t.adds",
      "t.draft_picks",
      "t.waiver_budget",
    ]) {
      assert.ok(TRADE_COLUMNS_SQL.includes(column), `${column} is missing`);
    }
  });

  test("it is a column list and nothing else, so any read can interpolate it", () => {
    assert.ok(!TRADE_COLUMNS_SQL.includes("FROM"));
    assert.ok(!TRADE_COLUMNS_SQL.includes("$"), "it binds nothing of its own");
  });
});

describe("the jsonb reads", () => {
  test("a column that isn't an array reads as an empty one rather than failing", () => {
    // `jsonb_array_elements` errors on a scalar, which would fail the whole
    // board for one league whose column Sleeper wrote as something else.
    const guarded = jsonbArraySql("t.draft_picks");
    assert.match(guarded, /jsonb_typeof\(t\.draft_picks\) = 'array'/);
    assert.match(guarded, /ELSE '\[\]'::jsonb END/);
  });

  test("a pick token is the season and the round, joined by a hyphen", () => {
    // The spelling the client's `pickToken` writes; the two ends are a matched
    // pair with no compiler link, so a filter built one way and read the other
    // matches nothing rather than erroring.
    assert.equal(PICK_TOKEN_SQL, `((p->>'season') || '-' || (p->>'round'))`);
  });
});

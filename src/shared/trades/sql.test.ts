import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { TradeCircleScope } from "./circle.ts";
import type { TradeQuery } from "./params.ts";
import {
  STARTUP_DRAFT_CTE,
  STARTUP_DRAFT_SQL,
  TRADES_POPULATION_SQL,
  TRADE_ORDER_SQL,
  TRADE_SORT_SQL,
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

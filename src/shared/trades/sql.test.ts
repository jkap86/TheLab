import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { TradeCircleScope } from "./circle.ts";
import type { TradeQuery, TradeSideQuery } from "./params.ts";
import {
  PICK_TOKEN_SQL,
  TRADE_FACET_SQL,
  STARTUP_DRAFT_CTE,
  STARTUP_DRAFT_SQL,
  TRADES_POPULATION_SQL,
  TRADE_COLUMNS_SQL,
  TRADE_ORDER_SQL,
  TRADE_SORT_SQL,
  jsonbArraySql,
  rosterIdIntSql,
  tradeCursorSql,
  tradeFilterSql,
  tradeNarrowingSql,
  tradeParticipantsSql,
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
  sides: [],
  match: "all",
  limit: 200,
  cursor: null,
  ...overrides,
});

/** A bay, with only what the case under test cares about spelled out. */
const side = (overrides: Partial<TradeSideQuery> = {}): TradeSideQuery => ({
  manager: null,
  players: [],
  picks: [],
  only: false,
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
        sides: [
          side({ players: [`${hostile}/player`], picks: [`${hostile}/pick`] }),
          side({ manager: `${hostile}/manager` }),
        ],
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
        sides: [
          side({ manager: "u1", players: ["p1"], picks: ["2026-1"] }),
          side({ picks: ["2027-2"] }),
        ],
      }),
      { kind: "leagues", ids: ["l3"] },
    );

    const used = placeholders(sql);
    assert.ok(used.length > 0);
    for (const n of used) {
      assert.ok(n >= 2, `$${n} would collide with the season at $1`);
      assert.ok(n <= params.length, `$${n} has no value pushed for it`);
    }
    // Including every pick token, which is compared one at a time against the
    // side's own roster rather than counted.
    assert.ok(params.some((v) => Array.isArray(v) === false && v === "2027-2"));
  });

  test("a bay of one is not wrapped, and several are", () => {
    // The assets in a bay are joined by the mode and the bays are `AND`ed
    // around them, so a group of alternatives has to carry its own parentheses
    // or an `OR` would bind looser than the joins outside it and quietly widen
    // the board.
    const one = build(query({ sides: [side({ players: ["p1"] })], match: "any" })).sql;
    const lone = one.slice(one.indexOf("EXISTS"));
    assert.ok(
      !lone.includes(" OR "),
      "a bay holding one asset needs no alternation",
    );

    const many = build(
      query({
        sides: [side({ players: ["p1"], picks: ["2026-1"] })],
        match: "any",
      }),
    ).sql;
    assert.ok(many.includes("("), "an OR of assets is parenthesised");
    assert.ok(many.includes(" OR "));
  });

  describe("a bay is a side, and two bays are two sides", () => {
    test("everything in a bay is checked against that bay's roster", () => {
      // The whole model in one assertion: a bay binds one of the trade's own
      // rosters and asks everything it holds against *that* id, which is what
      // makes "same bay, same side" true rather than a convention.
      const { sql } = build(
        query({ sides: [side({ players: ["p1"], picks: ["2026-1"] })] }),
      );
      assert.match(sql, /jsonb_array_elements_text\(CASE WHEN jsonb_typeof\(t\.roster_ids\)/);
      assert.match(sql, /t\.adds->>\$\d+ = ri1/);
      assert.match(sql, /p->>'owner_id' = ri1/);
    });

    test("two bays are different sides, and a third differs from both", () => {
      // Nested rather than `AND`ed, because two independent EXISTS cannot
      // compare their rosters — without this, "jkap ⇄ Nabers" would happily
      // match the trade where jkap *received* him.
      const two = build(
        query({ sides: [side({ players: ["p1"] }), side({ players: ["p2"] })] }),
      ).sql;
      assert.match(two, /ri2 <> ri1/);

      const three = build(
        query({
          sides: [
            side({ players: ["p1"] }),
            side({ players: ["p2"] }),
            side({ players: ["p3"] }),
          ],
        }),
      ).sql;
      assert.match(three, /ri3 <> ri1/);
      assert.match(three, /ri3 <> ri2/);
    });

    test("one bay claims nothing about any other side", () => {
      // An empty bay is "don't care", so a lone side must emit no distinctness
      // at all — otherwise the board would quietly require a second party to
      // have taken something.
      const { sql } = build(query({ sides: [side({ players: ["p1"] })] }));
      assert.doesNotMatch(sql, /<>/);
    });

    test("a named manager is a primary-key lookup correlated to the trade", () => {
      // `rosters` is keyed `(league_id, roster_id)` and both come from `t`, so
      // the subquery is a function of the trade and cannot be pulled up, where
      // the decorrelatable spelling measured 205ms against 9ms. It is also the
      // one owner lookup still made against `rosters` rather than against
      // `trade_participants` — deliberately, since it is on the board's
      // measured hot path and the switch buys nothing a plan could show.
      const { sql } = build(query({ sides: [side({ manager: "u1" })] }));
      assert.match(sql, /FROM rosters r\s+WHERE r\.league_id = t\.league_id/);
      assert.match(sql, /r\.roster_id = \(CASE WHEN ri1 ~ '\^\[0-9\]\+\$' THEN ri1::int END\)/);
      assert.match(sql, /r\.owner_id = \$\d+/);
    });

    test("the players are pre-filtered through the index they have one for", () => {
      // The side check is a per-row expression the GIN index cannot serve, so
      // on its own it would take the whole population and filter it. This is
      // the selective half, and it follows the mode for the same reason the
      // bays do: under `all` every named player must be present, under `any`
      // only one across the whole selection is guaranteed.
      assert.match(
        build(query({ sides: [side({ players: ["a"] }), side({ players: ["b"] })] })).sql,
        /t\.adds \?& \$\d+::text\[\]/,
      );
      assert.match(
        build(
          query({
            sides: [side({ players: ["a"] }), side({ players: ["b"] })],
            match: "any",
          }),
        ).sql,
        /t\.adds \?\| \$\d+::text\[\]/,
      );
      // Nothing to pre-filter on where no bay named a player: `?& '{}'` is a
      // tautology with a cost.
      assert.doesNotMatch(
        build(query({ sides: [side({ picks: ["2026-1"] })] })).sql,
        /\?&|\?\|/,
      );
    });

    test("under `any`, a bay naming a pick claims nothing about `adds`", () => {
      // The one shape where pooling the players made this a *wrong* condition
      // rather than a loose one: under `any` that bay is satisfied by the pick
      // alone, so requiring one of its players present dropped every trade
      // whose side took the pick and not the player — silently, with the board
      // still answering.
      assert.doesNotMatch(
        build(
          query({
            sides: [side({ players: ["a"], picks: ["2026-1"] })],
            match: "any",
          }),
        ).sql,
        /\?&|\?\|/,
      );
      // A pick-less bay beside it still contributes its own, which is what
      // keeps the index in play for the half that can honestly use it.
      const mixed = build(
        query({
          sides: [side({ players: ["a"], picks: ["2026-1"] }), side({ players: ["b"] })],
          match: "any",
        }),
      );
      assert.equal(mixed.sql.match(/t\.adds \?\|/g)?.length, 1);
      assert.ok(
        mixed.bound.some((v) => Array.isArray(v) && v.length === 1 && v.includes("b")),
      );
      assert.ok(!mixed.bound.some((v) => Array.isArray(v) && v.includes("a")));
    });

    test("under `any`, two pick-less bays are one clause each", () => {
      // The bays are conjunctive, so each one's own `?|` has to hold — which is
      // both correct and strictly more selective than one pooled `?|` over the
      // two, where a trade naming `a` twice satisfied the bay wanting `b`.
      const { sql } = build(
        query({
          sides: [side({ players: ["a"] }), side({ players: ["b"] })],
          match: "any",
        }),
      );
      assert.equal(sql.match(/t\.adds \?\|/g)?.length, 2);
    });

    test("the mode joins the assets inside a bay", () => {
      const all = build(
        query({ sides: [side({ players: ["p"], picks: ["2026-1"] })] }),
      ).sql;
      const any = build(
        query({
          sides: [side({ players: ["p"], picks: ["2026-1"] })],
          match: "any",
        }),
      ).sql;
      assert.ok(!all.includes(" OR "));
      assert.ok(any.includes(" OR "));
    });

    test("a roster id is matched whether Sleeper wrote it as a number or a string", () => {
      // `assembleTrade` carries the same defensiveness, and a filter that only
      // read one spelling would silently miss half the trades in a league stored
      // under the other. `jsonb_array_elements_text` provides it — it flattens a
      // number and a string to the same text — which is also what keeps the
      // subquery a function of `t`.
      const { sql } = build(query({ sides: [side({ manager: "u" })] }));
      assert.match(sql, /jsonb_array_elements_text\(CASE WHEN jsonb_typeof\(t\.roster_ids\)/);
    });
  });

  describe("a bay that claims it took nothing else", () => {
    test("it is off by default, so the board it opens on is untouched", () => {
      // The flag is the whole of the difference: without it the emitted SQL has
      // to be exactly what it was before this existed, or every board on the
      // page pays for a filter nobody asked for.
      const plain = build(query({ sides: [side({ players: ["p1"] })] })).sql;
      assert.doesNotMatch(plain, /NOT EXISTS/);
    });

    test("three clauses, one per kind of thing a roster can receive", () => {
      const { sql } = build(
        query({ sides: [side({ players: ["p1"], only: true })] }),
      );
      // Players: any add pointing at this roster whose key wasn't named.
      assert.match(
        sql,
        /NOT EXISTS \(\s+SELECT 1 FROM jsonb_each_text\(CASE WHEN jsonb_typeof\(t\.adds\) = 'object'[\s\S]*?a\.value = ri1\s+AND NOT \(a\.key = ANY\(\$\d+::text\[\]\)\)\)/,
      );
      // Picks: any pick landing on this roster whose token wasn't named.
      assert.match(
        sql,
        /NOT EXISTS \([\s\S]*?p->>'owner_id' = ri1\s+AND NOT \(\(\(p->>'season'\) \|\| '-' \|\| \(p->>'round'\)\) = ANY\(\$\d+::text\[\]\)\)\)/,
      );
      // FAAB: the card draws it, so it is something else — see `sideOnlySql`.
      assert.match(sql, /w->>'receiver' = ri1/);
      assert.match(
        sql,
        /CASE WHEN w->>'amount' ~ '\^-\?\[0-9\]\+\$'\s+THEN \(w->>'amount'\)::int ELSE 0 END\) <> 0/,
      );
    });

    test("it is asked of the bay's own roster, never of another's", () => {
      // The claim is "*this* side took nothing else". Correlated to the wrong
      // alias it would be a claim about the counterparty, which is a different
      // and much rarer trade — and it would still answer.
      const { sql } = build(
        query({
          sides: [
            side({ players: ["p1"] }),
            side({ players: ["p2"], only: true }),
          ],
        }),
      );
      // Each clause runs from its own `NOT EXISTS (` to the next one's, so a
      // stray reference to the first bay's roster would land inside one of them.
      const clauses = sql.split("NOT EXISTS (").slice(1);
      assert.equal(clauses.length, 3);
      for (const clause of clauses) {
        assert.ok(clause.includes("ri2"), `correlated to the second bay: ${clause}`);
        assert.ok(!clause.includes("ri1"), `and to nothing else: ${clause}`);
      }
    });

    test("the named ids are bound as arrays and nothing is spliced", () => {
      const { sql, bound } = build(
        query({
          sides: [side({ players: ["p1", "p2"], picks: ["2026-1"], only: true })],
        }),
      );
      assert.ok(!sql.includes("p1"), "no id reaches the SQL as text");
      assert.ok(!sql.includes("2026-1"));
      assert.ok(
        bound.some(
          (v) => Array.isArray(v) && v.length === 2 && v.includes("p1") && v.includes("p2"),
        ),
        "the players go in as one array",
      );
      assert.ok(
        bound.some((v) => Array.isArray(v) && v.length === 1 && v.includes("2026-1")),
        "and the picks as another",
      );
    });

    test("a bay naming one kind still excludes the other", () => {
      // "Only these picks" means no players at all, which is what the empty
      // bound array says: `NOT (a.key = ANY('{}'))` is true of every add. A
      // reading that made an empty list a tautology would quietly answer a
      // weaker question than the one asked.
      const { sql, bound } = build(
        query({ sides: [side({ picks: ["2026-1"], only: true })] }),
      );
      assert.match(sql, /a\.value = ri1/);
      assert.ok(
        bound.some((v) => Array.isArray(v) && v.length === 0),
        "the players list is bound empty rather than the clause being dropped",
      );
    });

    test("a bay with no asset makes no claim, whatever the flag says", () => {
      // The parser drops it, and the builder repeats the guard: emitted from a
      // bay holding one manager this reads "and he received nothing", which is
      // an empty board with nothing on screen saying why.
      const { sql } = build(
        query({ sides: [side({ manager: "u1", only: true })] }),
      );
      assert.doesNotMatch(sql, /NOT EXISTS/);
    });

    test("it still narrows under `any`", () => {
      // The mode says how a bay's assets combine; this says what the bay leaves
      // out, so "received one of these and nothing else" is a question the two
      // compose into rather than a contradiction.
      const { sql } = build(
        query({
          sides: [side({ players: ["p1"], picks: ["2026-1"], only: true })],
          match: "any",
        }),
      );
      assert.ok(sql.includes(" OR "), "the assets are still alternatives");
      assert.match(sql, /a\.value = ri1/);
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
        query({
          sides: [side({ players: ["a"], picks: ["2026-1"] })],
          match: "any",
          from: 1,
        }),
      );
      // The sides are pushed last, so the trailing EXISTS is the selection.
      const selection = sql.slice(sql.indexOf("EXISTS"));
      assert.ok(selection.includes(" OR "), "the bay's assets are an OR group");
      assert.ok(
        !selection.includes("IS NOT NULL"),
        "and the window is not inside it",
      );
      assert.ok(
        sql.indexOf("IS NOT NULL") < sql.indexOf("EXISTS"),
        "the window is its own conjunct, ahead of the sides",
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
      // Leagues is a plain column test; the other two have to reach a table, and
      // they reach two different ones — a membership question and a dealing one.
      assert.doesNotMatch(leagues, /EXISTS/);
      assert.match(members, /league_users/);
      assert.match(traders, /trade_participants/);
    });

    test("the traders circle reads the stored mapping, not the jsonb array", () => {
      // The whole point of `trade_participants`: this predicate runs over the
      // *season* on the reads that have no `LIMIT` — the facets and both
      // denominators — so re-deriving "which people were in this trade" per
      // candidate row was the dominant cost even with the covering index on
      // `rosters` under it.
      const traders = forKind("traders");
      assert.match(traders, /FROM trade_participants tp/);
      assert.doesNotMatch(traders, /jsonb_array_elements_text/);
      assert.doesNotMatch(traders, /JOIN rosters/);
    });

    test("it stays correlated to the trade, which is a planner decision", () => {
      // A stored mapping makes decorrelating *easier*, not harder: the table is
      // finally joinable. But the board's `ORDER BY` is only satisfied from
      // `transactions_trade_keyset_idx` while this subquery is a function of
      // `t` — pulled up, the planner hash-joins the season and top-N heapsorts
      // it, which measured 347ms against 30ms for one page.
      const traders = forKind("traders");
      assert.match(traders, /tp\.transaction_id = t\.transaction_id/);
    });

    test("it ANDs with the selection rather than joining it", () => {
      // "Any of these two players, in my leagues" is the only reading of a circle
      // and a selection together — the circle is where the reader is standing,
      // not one of the things they picked.
      const { sql } = build(
        query({
          sides: [side({ players: ["a"], picks: ["2026-1"] })],
          match: "any",
        }),
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
      {
        leagues: ["a"],
        excludeLeagues: ["b"],
        from: 1,
        to: 2,
        sides: [side({ manager: "u", players: ["p"] }), side({ picks: ["2026-1"] })],
      },
      { kind: "members", ids: ["u2"] },
    ],
    [
      "everything, any",
      {
        leagues: ["a"],
        from: 1,
        sides: [side({ manager: "u", players: ["p", "q"], picks: ["2026-1"] })],
        match: "any" as const,
      },
      { kind: "leagues", ids: ["l1"] },
    ],
    [
      "a bay that took nothing else",
      {
        from: 1,
        sides: [
          side({ manager: "u", players: ["p"], only: true }),
          side({ picks: ["2026-1"], only: true }),
        ],
      },
      null,
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
    const sql = tradeNarrowingSql(
      query({ from: 1, sides: [side({ players: ["p"] })] }),
      ["2026"],
    );
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
    const file = readdirSync(dir).find((n) => n.includes("trades_read"));
    assert.ok(file, "the trades read migration is still there");
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

  test("the date window agrees with the index that still serves it", () => {
    // `transactions_trade_recency_idx` predates the keyset one and is *not*
    // redundant: it is ordered on `coalesce(status_updated, created)`, which is
    // a different expression from the keyset index's
    // `coalesce(status_updated, created, 0)` as far as the planner is concerned.
    // The board's own read never needs it (its `ORDER BY` pins it to the keyset
    // walk), but `countTradeTotals` and the facet aggregates have no `ORDER BY`,
    // so a windowed board's denominators can take this as an index range instead
    // of a filter over the season. Dropping the index means changing the
    // spelling below first.
    const params: unknown[] = [];
    const windowed = tradeNarrowingSql(query({ from: 1, to: 2 }), params);
    assert.ok(windowed.includes("coalesce(t.status_updated, t.created)"));
    assert.ok(
      !windowed.includes(TRADE_SORT_SQL),
      "the window must not be spelled as the sort key, or the old index is dead",
    );

    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) => n.includes("trades_read"));
    assert.ok(file, "the trades read migration is still there");
    const migration = readFileSync(join(dir, file), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    assert.ok(
      normalise(migration).includes("coalesce(status_updated,created)"),
      "the window expression no longer matches the indexed one",
    );
  });

  test("the backfill derives participants exactly as the sync rebuilds them", () => {
    // The one agreement in this module with a *copy* on the other side of it:
    // `trade_participants` is populated once by a migration and then rebuilt per
    // league by `rebuildTradeParticipants`, and the migration is plain SQL that
    // cannot import this fragment. Two spellings would mean the backfill and
    // every refresh after it disagreeing about who was in a trade — silent in
    // both directions, and visible only as trades quietly missing from a
    // leaguemates board.
    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) => n.includes("trades_read"));
    assert.ok(file, "the trades read migration is still there");
    const migration = readFileSync(join(dir, file), "utf8");

    const normalise = (sql: string) => sql.replace(/\s+/g, "").toLowerCase();
    assert.ok(
      normalise(migration).includes(normalise(tradeParticipantsSql())),
      "the migration's backfill is no longer the derivation the sync uses",
    );
  });

  test("the participants table is keyed for the lookup every read makes", () => {
    // Every reader arrives holding a `transaction_id` and asking about the
    // owner, so the key has to carry it — otherwise the lookup is a heap fetch
    // per candidate trade, which is the cost `rosters_league_roster_owner_idx`
    // was created to remove from exactly this question.
    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) => n.includes("trades_read"));
    assert.ok(file, "the trades read migration is still there");
    const migration = readFileSync(join(dir, file), "utf8")
      .replace(/\s+/g, " ")
      .toLowerCase();

    assert.ok(
      migration.includes("primary key (transaction_id, roster_id) include (owner_id)"),
      "the read's lookup is no longer index-only",
    );
    // And the other direction, for the reads with no `ORDER BY` to protect.
    assert.ok(migration.includes("(owner_id, transaction_id)"));
    // Creating a table collects no statistics, and the planner's default guess
    // for a semi-join it knows nothing about is how the ADP board became a
    // nested loop over the season.
    assert.ok(migration.includes("analyze trade_participants"));
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

  test("a completed startup's cutoff drops everything at or before its last pick", () => {
    // The other half of the boundary: once the startup is over, its last pick is
    // the cutoff, and a trade filed at exactly that instant is still a trade made
    // in the draft room. `<=`, not `<`.
    assert.match(
      TRADES_POPULATION_SQL,
      /coalesce\(t\.status_updated, t\.created\) <= sd\.last_picked/,
    );
  });

  test("the cutoff reads the coalesce, never `status_updated` alone", () => {
    // Sleeper leaves `created` as the only timestamp on some valid rows, so a
    // bare `t.status_updated` would compare null against the cutoff, drop the
    // predicate to unknown and keep every one of those trades regardless of when
    // it happened. This is the same fold `TRADE_SORT_SQL` orders on.
    const boundary = TRADES_POPULATION_SQL.slice(
      TRADES_POPULATION_SQL.indexOf("startup_draft sd"),
    );
    const bare = [...boundary.matchAll(/t\.status_updated(?!,)/g)];
    assert.deepEqual(bare, [], "every mention of it is inside a coalesce");
    assert.equal(
      [...boundary.matchAll(/coalesce\(t\.status_updated, t\.created\)/g)].length,
      2,
      "both the undated test and the cutoff comparison read it",
    );
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

/**
 * Every place a jsonb roster id becomes an integer.
 *
 * The failure being guarded against is not subtle once it happens and is
 * invisible until it does: `r.roster_id = ri::int WHERE ri ~ '^[0-9]+$'` reads
 * as safe and isn't, because Postgres does not promise to apply the `WHERE`
 * before the cast — so one league whose `roster_ids` holds a non-numeric entry
 * fails the *whole* read with `invalid input syntax for type integer`, for
 * everybody. The regex has to be inside a `CASE` that short-circuits, and it has
 * to be there in all three places, which is what makes this a scan rather than
 * three assertions.
 */
describe("roster id casts", () => {
  /** Every SQL string this module can emit that could contain one. */
  const emitted = (): [string, string][] => {
    const params: unknown[] = [];
    return [
      ["facets: players", TRADE_FACET_SQL.players.aggregate],
      ["facets: picks", TRADE_FACET_SQL.picks.aggregate],
      ["facets: managers", TRADE_FACET_SQL.managers.aggregate],
      [
        "sides with a manager",
        tradeFilterSql(
          query({ sides: [side({ manager: "u1", players: ["p1"] })] }),
          params,
        ),
      ],
      [
        "the leaguemate circle",
        tradeFilterSql(query(), params, {
          kind: "traders",
          ids: ["u1"],
        } as TradeCircleScope),
      ],
      ["the population", TRADES_POPULATION_SQL],
      ["the columns", TRADE_COLUMNS_SQL],
      ["the participants derivation", tradeParticipantsSql()],
    ];
  };

  test("the guard short-circuits rather than relying on a WHERE", () => {
    const guarded = rosterIdIntSql("ri");
    assert.match(guarded, /CASE WHEN ri ~ '\^\[0-9\]\+\$' THEN ri::int END/);
    // Parenthesised, since every call site appends its own comparison.
    assert.ok(guarded.startsWith("(") && guarded.endsWith(")"));
  });

  test("no emitted SQL casts to int outside that guard", () => {
    for (const [name, sql] of emitted()) {
      for (const match of sql.matchAll(/(\w+)::int\b/g)) {
        const before = sql.slice(0, match.index);
        assert.match(
          before.slice(-80),
          new RegExp(`CASE WHEN ${match[1]} ~ '\\^\\[0-9\\]\\+\\$' THEN $`),
          `${name}: \`${match[0]}\` is cast without a CASE guard in front of it`,
        );
      }
    }
  });

  test("the cast happens once, on write, and no read makes it", () => {
    // **This is what `trade_participants` bought beyond an index.** The jsonb
    // roster id had to be unnested and cast by three separate reads — the
    // leaguemates circle, the managers facet and the sides filter — each per
    // candidate trade, and two spellings of the guard is how the facets branch
    // came to be the one missing it. The derivation is now made once when the
    // league is written, so only the sides filter (which asks about a *named*
    // roster of the trade, and is correlated to it) still casts at read time.
    assert.ok(tradeParticipantsSql().includes(rosterIdIntSql("ri")));

    const params: unknown[] = [];
    const circle = tradeFilterSql(query(), params, {
      kind: "traders",
      ids: ["u1"],
    } as TradeCircleScope);
    assert.doesNotMatch(circle, /::int/);
    assert.doesNotMatch(TRADE_FACET_SQL.managers.aggregate, /::int/);
  });

  test("a malformed roster id yields null, so it joins to nothing", () => {
    // The whole reason `CASE` without an `ELSE` is right here: the miss is a
    // null, which matches no `roster_id`, so the trade loses its manager rather
    // than the request losing its board.
    assert.ok(!rosterIdIntSql("ri").includes("ELSE"));
  });

  test("the two multi-asset facets count trades, not rows", () => {
    // A manager can hold two rosters in one league and a three-way can name
    // both; a trade can carry two 2027 firsts. So the menu's number is distinct
    // *trades* — which is now spelled as a `DISTINCT` on the way in and a plain
    // `count(*)` over it, rather than as `count(DISTINCT …)` per group, because
    // that is the one aggregate Postgres cannot hash. The rule is what is
    // asserted, so the spelling can move again: the trade id has to be
    // deduplicated before anything is counted.
    for (const branch of [TRADE_FACET_SQL.picks, TRADE_FACET_SQL.managers]) {
      assert.match(branch.aggregate, /SELECT DISTINCT\s+pop\.transaction_id/);
      assert.match(branch.aggregate, /count\(\*\)::bigint AS count/);
    }
    // The managers branch used to spell "a roster with no owner names nobody"
    // here; the stored mapping holds that rule once, on the write side, and its
    // `owner_id` is NOT NULL.
    assert.match(tradeParticipantsSql(), /r\.owner_id IS NOT NULL/);
  });

  test("the players facet is the one that may count rows", () => {
    // And the reason is a fact about jsonb rather than about the data: keys are
    // unique within an object, so one key of `adds` is already one trade. A
    // `DISTINCT` here would be a sort bought for nothing.
    assert.doesNotMatch(TRADE_FACET_SQL.players.aggregate, /DISTINCT/);
  });

  test("the facet aggregates read the population as `pop`", () => {
    // They are interpolated under a CTE of that name; a branch naming it
    // differently is a syntax error in only one direction.
    for (const { aggregate } of Object.values(TRADE_FACET_SQL)) {
      assert.match(aggregate, /\bpop\b/);
      // No `$n` placeholders: the branch is appended to a `pop` CTE the caller
      // has already bound, so a parameter of its own would land on an index the
      // builder never pushed. (`$` appears inside the guard's regex, which is
      // why this asks about placeholders rather than the character.)
      assert.equal(
        aggregate.match(/\$\d/g),
        null,
        "a facet branch binds nothing of its own",
      );
    }
  });

  test("a branch only reads columns its own projection selects", () => {
    // `pop` is `MATERIALIZED`, so its `SELECT` list is what gets written to a
    // tuplestore — and the two jsonb blobs on a trade are most of a season's
    // bytes. The three branches used to share one projection carrying all of
    // them, so each was materialising the whole season to read one column of
    // it. This is the agreement that keeps them apart: a branch that grows a
    // reference to a column its projection dropped is not a wrong answer, it is
    // a `column pop.x does not exist` at runtime, on a route nothing here
    // exercises.
    for (const [name, branch] of Object.entries(TRADE_FACET_SQL)) {
      const selected = new Set(
        branch.columns.split(",").map((c) => c.trim().replace(/^t\./, "")),
      );
      for (const match of branch.aggregate.matchAll(/\bpop\.(\w+)/g)) {
        assert.ok(
          selected.has(match[1]),
          `${name}: reads pop.${match[1]}, which its projection (${branch.columns}) does not select`,
        );
      }
    }
  });

  test("no projection carries a blob its branch never reads", () => {
    // The other direction, and the one that is silent: a column selected and
    // unread costs the tuplestore and nothing catches it. Asserted for the two
    // jsonb columns that are the whole of the cost.
    for (const [name, branch] of Object.entries(TRADE_FACET_SQL)) {
      for (const blob of ["adds", "draft_picks", "roster_ids"]) {
        if (!branch.columns.includes(blob)) continue;
        assert.ok(
          branch.aggregate.includes(`pop.${blob}`),
          `${name}: materialises ${blob} and never reads it`,
        );
      }
    }
  });

  test("the jsonb columns they unnest are array-guarded", () => {
    assert.ok(
      TRADE_FACET_SQL.picks.aggregate.includes(jsonbArraySql("pop.draft_picks")),
    );
    // The managers branch unnests nothing any more — it joins the stored
    // mapping — so the guard it used to need is on the write side instead.
    assert.ok(tradeParticipantsSql().includes(jsonbArraySql("t.roster_ids")));
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { column } from "./lineup-columns.ts";
import { teamsColumnQuery } from "./teams-column-query.ts";

/**
 * What a per-league read is asked so the standings pane's column can be
 * answered.
 *
 * Every rule here is silent when it goes wrong: a column priced on one board
 * and read back under another's key is a table of em dashes, and a narrowing
 * left off the request is a column totalled over players it does not count.
 */
describe("teamsColumnQuery", () => {
  test("an un-narrowed column asks for its own boards and its bare key", () => {
    assert.deepEqual(teamsColumnQuery(column("ros_starters")), {
      ktc_board: "auto",
      qb_board: "auto",
      // `auto` folds out of the key, so this names a total the ten already
      // carry — which is what makes a reader who never opens the picker cost
      // the route nothing.
      team_totals: "ros_starters",
    });
  });

  test("a forced pricing rides both board parameters and the key", () => {
    assert.deepEqual(teamsColumnQuery(column("ktc_total", "dynasty", "sf")), {
      ktc_board: "dynasty",
      qb_board: "sf",
      team_totals: "ktc_total:dynasty:sf",
    });
  });

  test("a capital column's QB board rides `qb_board`, and its key alone", () => {
    // A capital column has no market to name — `lineupColumnKey` gives it the
    // QB suffix and nothing else — where the *request* still has to say which
    // board, because the route resolves one for both valuations.
    assert.deepEqual(teamsColumnQuery(column("capital_total", "auto", "sf")), {
      ktc_board: "auto",
      qb_board: "sf",
      team_totals: "capital_total:sf",
    });
  });

  test("both narrowings ride their own parameters", () => {
    const query = teamsColumnQuery(
      column("ros_starters", "auto", "auto", ["WR", "TE"], ["FLEX"]),
    );
    assert.equal(query.positions, "wr+te");
    assert.equal(query.slots, "flex");
    assert.equal(query.team_totals, "ros_starters:@flex:wr+te");
  });

  test("an absent narrowing is omitted rather than sent blank", () => {
    const query = teamsColumnQuery(column("ros_bench"));
    assert.ok(!("positions" in query));
    assert.ok(!("slots" in query));
  });

  test("the key is the one the column will read its total back by", () => {
    // The whole contract in one line: this is what the route files a
    // per-roster total under and what the pane looks one up by, and a second
    // spelling of either is a column of dashes with nothing saying why.
    const col = column("ktc_starters", "redraft", "oneqb", ["QB"], ["SUPER_FLEX"]);
    assert.equal(
      teamsColumnQuery(col).team_totals,
      "ktc_starters:redraft:oneqb:@super_flex:qb",
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PROJECTION_FILTER_DEFAULTS,
  PROJECTIONS_LIMIT_MAX,
  parseProjectionFilters,
  usesDefaultSeason,
} from "./filters.ts";
import type { ProjectionFilters } from "./filters.ts";

/**
 * The parser is the only thing between a query string and SQL that interpolates a
 * column name (`scoring` picks the `ORDER BY`), so the rejection cases matter as
 * much as the accepted ones.
 */

const parse = (query: string, season = "2026"): ProjectionFilters => {
  const result = parseProjectionFilters(new URLSearchParams(query), season);
  assert.equal(result.ok, true, `expected "${query}" to parse`);
  return (result as { ok: true; filters: ProjectionFilters }).filters;
};

const error = (query: string): string => {
  const result = parseProjectionFilters(new URLSearchParams(query), "2026");
  assert.equal(result.ok, false, `expected "${query}" to be rejected`);
  return (result as { ok: false; error: string }).error;
};

describe("parseProjectionFilters", () => {
  test("an empty query takes every default", () => {
    assert.deepEqual(parse(""), {
      season: "2026",
      week: null,
      scoring: PROJECTION_FILTER_DEFAULTS.scoring,
      positions: null,
      player_ids: null,
      include_stats: false,
      limit: PROJECTION_FILTER_DEFAULTS.limit,
      offset: PROJECTION_FILTER_DEFAULTS.offset,
    });
  });

  test("week left out stays null for the route to resolve", () => {
    // The route fills it from the newest stored week; defaulting to 1 here would
    // quietly answer with the wrong week all season.
    assert.equal(parse("").week, null);
    assert.equal(parse("week=7").week, 7);
  });

  test("takes the season it is given, or the default", () => {
    assert.equal(parse("season=2025").season, "2025");
    assert.equal(parse("", "2030").season, "2030");
  });

  test("accepts the three scorings, case-insensitively", () => {
    assert.equal(parse("scoring=std").scoring, "std");
    assert.equal(parse("scoring=half_ppr").scoring, "half_ppr");
    assert.equal(parse("scoring=PPR").scoring, "ppr");
  });

  test("rejects an unknown scoring rather than falling back", () => {
    // This value picks a column name, so an unrecognised one must never reach SQL
    // — not even as a silently ignored param.
    assert.match(error("scoring=pts_ppr"), /Invalid scoring/);
    assert.match(error("scoring=; DROP TABLE projections"), /Invalid scoring/);
  });

  test("positions are upper-cased and deduped", () => {
    assert.deepEqual(parse("position=wr,TE,wr").positions, ["WR", "TE"]);
    assert.deepEqual(parse("position=def").positions, ["DEF"]);
  });

  test("lists accept repeated params or commas", () => {
    assert.deepEqual(parse("player_id=1&player_id=2").player_ids, ["1", "2"]);
    assert.deepEqual(parse("player_id=1,2").player_ids, ["1", "2"]);
    assert.deepEqual(parse("position=WR&position=TE").positions, ["WR", "TE"]);
  });

  test("an absent list is null, not empty", () => {
    // The queries read an empty list as "nothing matched"; null is "no filter".
    assert.equal(parse("").positions, null);
    assert.equal(parse("position=").positions, null);
    assert.equal(parse("player_id=").player_ids, null);
  });

  test("stats is opt-in and takes the usual boolean spellings", () => {
    assert.equal(parse("").include_stats, false);
    assert.equal(parse("stats=1").include_stats, true);
    assert.equal(parse("stats=true").include_stats, true);
    assert.equal(parse("stats=0").include_stats, false);
    assert.match(error("stats=maybe"), /Invalid stats/);
  });

  test("paging is bounded", () => {
    assert.equal(parse(`limit=${PROJECTIONS_LIMIT_MAX}`).limit, PROJECTIONS_LIMIT_MAX);
    assert.equal(parse("offset=50").offset, 50);
    assert.match(error(`limit=${PROJECTIONS_LIMIT_MAX + 1}`), /Invalid limit/);
    assert.match(error("limit=0"), /Invalid limit/);
    assert.match(error("offset=-1"), /Invalid offset/);
  });

  test("rejects out-of-range and non-integer weeks", () => {
    for (const bad of ["0", "19", "-3", "1.5", "one"]) {
      assert.match(error(`week=${bad}`), /Invalid week/);
    }
  });

  test("rejects a season that isn't a 4-digit year", () => {
    assert.match(error("season=20x5"), /Invalid season/);
    assert.match(error("season=all"), /Invalid season/);
  });
});

/**
 * The predicate `/api/projections` gates its season resolution on — the ADP
 * filters' of the same name, and tested the same way: what it claims has to
 * match what the parser actually reads.
 */
describe("usesDefaultSeason", () => {
  const uses = (query: string) => usesDefaultSeason(new URLSearchParams(query));

  test("only an unnamed season takes the default", () => {
    assert.equal(uses(""), true);
    assert.equal(uses("week=3&scoring=ppr"), true);
    assert.equal(uses("season=2024"), false);
  });

  test("a blank season is no season, as the parser reads it", () => {
    assert.equal(uses("season="), true);
    assert.equal(uses("season=%20"), true);
  });

  test("the predicate agrees with what the parser actually reads", () => {
    for (const query of ["", "week=3", "season=2024", "season=2024&week=3", "season="]) {
      const withDefault = parseProjectionFilters(new URLSearchParams(query), "2026");
      const withNone = parseProjectionFilters(new URLSearchParams(query), null);
      assert.equal(withDefault.ok, true);
      if (uses(query)) {
        assert.equal(withNone.ok, false, `${query} should need a default`);
      } else {
        assert.equal(withNone.ok, true, `${query} should not need a default`);
      }
    }
  });
});

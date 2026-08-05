import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_FILTER_DEFAULTS,
  ADP_LIMIT_MAX,
  parseAdpFilters,
  usesDefaultSeason,
} from "./adp-filters.ts";
import type { AdpFilters } from "./adp-filters.ts";

/**
 * The parser is the only thing standing between a query string and SQL, so the
 * cases that matter are the malformed ones and the defaults that apply when a
 * filter is simply absent.
 */
const parse = (query: string): AdpFilters => {
  const result = parseAdpFilters(new URLSearchParams(query), "2026");
  assert.equal(result.ok, true, `expected ${query} to parse`);
  assert(result.ok);
  return result.filters;
};

const errorFor = (query: string): string => {
  const result = parseAdpFilters(new URLSearchParams(query), "2026");
  assert.equal(result.ok, false, `expected ${query} to be rejected`);
  assert(!result.ok);
  return result.error;
};

describe("parseAdpFilters", () => {
  test("an empty query falls back to the default season and defaults", () => {
    const filters = parse("");
    assert.deepEqual(filters.seasons, ["2026"]);
    assert.deepEqual(filters.draft_types, ADP_FILTER_DEFAULTS.draft_types);
    assert.deepEqual(filters.draft_statuses, ADP_FILTER_DEFAULTS.draft_statuses);
    assert.equal(filters.limit, ADP_FILTER_DEFAULTS.limit);
    assert.equal(filters.offset, 0);
    assert.equal(filters.min_picks, ADP_FILTER_DEFAULTS.min_picks);
  });

  test("filters left out are null, i.e. not applied at all", () => {
    const filters = parse("");
    assert.equal(filters.start_after, null);
    assert.equal(filters.start_before, null);
    assert.equal(filters.league_ids, null);
    assert.equal(filters.scoring, null);
    assert.equal(filters.best_ball, null);
    assert.equal(filters.superflex, null);
    assert.equal(filters.rounds_min, null);
    assert.equal(filters.teams_max, null);
  });

  test("the league type is not a filter — the boards ride on every answer", () => {
    // The redraft/dynasty split stopped being a narrowing: a fetch averages
    // both markets and the display chooses. A leftover `league_type` parameter
    // is simply unknown to the parser and ignored, not an error — the old
    // vocabulary must not fail a stored link.
    const filters = parse("league_type=dynasty");
    assert.equal("league_types" in filters, false);
  });

  test("a date range is kept as given, either half open", () => {
    const both = parse("start_after=2026-06-01&start_before=2026-07-31");
    assert.deepEqual(
      { after: both.start_after, before: both.start_before },
      { after: "2026-06-01", before: "2026-07-31" },
    );
    assert.equal(parse("start_after=2026-06-01").start_before, null);
    assert.equal(parse("start_before=2026-07-31").start_after, null);
  });

  test("a date range replaces the default season rather than intersecting it", () => {
    // "Drafts since June" must mean that and not "June drafts of this season" —
    // a silent intersection would return a range the caller didn't ask for.
    assert.equal(parse("start_after=2026-06-01").seasons, null);
    // Asked for explicitly, both still apply.
    assert.deepEqual(parse("season=2025&start_after=2026-06-01").seasons, ["2025"]);
  });

  test("rejects a date that isn't a real YYYY-MM-DD", () => {
    assert.match(errorFor("start_after=06-01-2026"), /Expected a date as YYYY-MM-DD/);
    assert.match(errorFor("start_after=2026-6-1"), /Expected a date as YYYY-MM-DD/);
    // Right shape, no such day.
    assert.match(errorFor("start_before=2026-02-31"), /Expected a date as YYYY-MM-DD/);
  });

  test("rejects an inverted range instead of matching nothing", () => {
    assert.match(
      errorFor("start_after=2026-07-31&start_before=2026-06-01"),
      /later than start_before/,
    );
    // The two ends may meet — a single day is a legitimate range.
    assert.equal(parse("start_after=2026-06-01&start_before=2026-06-01").start_after, "2026-06-01");
  });

  test("season=all drops the season filter rather than emptying it", () => {
    assert.equal(parse("season=all").seasons, null);
    assert.equal(parse("season=2025,all").seasons, null);
  });

  test("accepts repeated and comma-separated lists alike", () => {
    assert.deepEqual(parse("season=2025&season=2026").seasons, ["2025", "2026"]);
    assert.deepEqual(parse("season=2025,2026").seasons, ["2025", "2026"]);
    assert.deepEqual(parse("scoring=ppr,half_ppr").scoring, ["ppr", "half_ppr"]);
  });

  test("de-duplicates and ignores blanks in a list", () => {
    assert.deepEqual(parse("season=2025,,2025, 2026 ").seasons, ["2025", "2026"]);
  });

  test("rejects a season that isn't a year", () => {
    assert.match(errorFor("season=next"), /Invalid season/);
    assert.match(errorFor("season=26"), /Invalid season/);
  });

  test("rejects a value outside an enum, naming the alternatives", () => {
    assert.match(errorFor("draft_type=auto"), /Invalid draft_type[\s\S]*snake/);
    assert.match(errorFor("scoring=full_ppr"), /Invalid scoring/);
    assert.match(errorFor("draft_status=done"), /Invalid draft_status/);
  });

  test("reads the several spellings of a boolean", () => {
    for (const yes of ["1", "true", "TRUE", "yes"]) {
      assert.equal(parse(`superflex=${yes}`).superflex, true);
    }
    for (const no of ["0", "false", "no"]) {
      assert.equal(parse(`best_ball=${no}`).best_ball, false);
    }
    assert.match(errorFor("superflex=maybe"), /Invalid superflex/);
  });

  test("bounds integers and rejects non-integers", () => {
    assert.equal(parse("teams_min=12").teams_min, 12);
    assert.equal(parse("rounds_max=20").rounds_max, 20);
    assert.match(errorFor("teams_min=0"), /Invalid teams_min/);
    assert.match(errorFor("rounds_min=2.5"), /Invalid rounds_min/);
    assert.match(errorFor("min_picks=abc"), /Invalid min_picks/);
    assert.match(errorFor("offset=-1"), /Invalid offset/);
    assert.equal(parse("offset=0").offset, 0);
  });

  test("caps the page size so one query can't ask for the whole table", () => {
    assert.equal(parse(`limit=${ADP_LIMIT_MAX}`).limit, ADP_LIMIT_MAX);
    assert.match(errorFor(`limit=${ADP_LIMIT_MAX + 1}`), /Invalid limit/);
  });

  test("combines draft and league filters into one query", () => {
    const filters = parse(
      "season=2026&draft_type=snake&draft_status=complete&rounds_min=15" +
        "&scoring=ppr&superflex=true&teams_min=12&teams_max=12",
    );
    assert.deepEqual(filters, {
      seasons: ["2026"],
      start_after: null,
      start_before: null,
      draft_types: ["snake"],
      draft_statuses: ["complete"],
      league_ids: null,
      scoring: ["ppr"],
      best_ball: null,
      superflex: true,
      rounds_min: 15,
      rounds_max: null,
      teams_min: 12,
      teams_max: 12,
      min_picks: ADP_FILTER_DEFAULTS.min_picks,
      limit: ADP_FILTER_DEFAULTS.limit,
      offset: 0,
    });
  });
});

/**
 * The predicate the route gates its season resolution on.
 *
 * It is exported so `/api/adp` can skip `getActiveSeason()` — a fetched value —
 * for a board the caller already bounded, and the parser branches on the same
 * function so the two cannot disagree. These tests are that agreement: for every
 * shape, whether the predicate says the default is read has to match whether
 * omitting it changes the answer.
 */
describe("usesDefaultSeason", () => {
  const uses = (query: string) => usesDefaultSeason(new URLSearchParams(query));

  test("an unbounded board is the one shape that needs a default", () => {
    assert.equal(uses(""), true);
    assert.equal(uses("scoring=ppr&teams_min=12"), true);
  });

  test("a season or a date bound is the caller's own answer", () => {
    assert.equal(uses("season=2024"), false);
    assert.equal(uses("season=all"), false);
    assert.equal(uses("start_after=2026-05-01"), false);
    assert.equal(uses("start_before=2026-05-01"), false);
    assert.equal(uses("season=2024&start_after=2026-05-01"), false);
  });

  test("a blank bound is no bound, as the parser reads it", () => {
    // `list` drops empty values and `isoDate` reads a blank as absent, so a
    // predicate keying on mere presence would send `?start_after=` to the
    // unbounded board — every season on file — instead of this one.
    assert.equal(uses("season="), true);
    assert.equal(uses("start_after=&start_before="), true);
    assert.equal(uses("start_after=%20"), true);
  });

  test("the predicate agrees with what the parser actually reads", () => {
    for (const query of [
      "",
      "scoring=ppr",
      "season=2024",
      "season=all",
      "start_after=2026-05-01",
      "season=2024&start_after=2026-05-01",
      "season=",
      "start_after=",
    ]) {
      const withDefault = parseAdpFilters(new URLSearchParams(query), "2026");
      const withNone = parseAdpFilters(new URLSearchParams(query), null);
      assert(withDefault.ok);
      if (uses(query)) {
        assert.equal(withNone.ok, false, `${query} should need a default`);
        assert.deepEqual(withDefault.filters.seasons, ["2026"]);
      } else {
        assert(withNone.ok, `${query} should not need a default`);
        assert.deepEqual(
          withNone.filters,
          withDefault.filters,
          `${query} must parse the same either way`,
        );
      }
    }
  });
});

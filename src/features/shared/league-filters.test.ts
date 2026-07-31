import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_LEAGUE_FILTERS,
  type FilterRule,
  type LeagueFilters,
  activeFilterCount,
  compare,
  filterSummary,
  matchesFilters,
  scoringKeyOptions,
  scoringValue,
  slotCount,
} from "./league-filters.ts";
import type { ManagerLeague } from "@/shared/manager";

/**
 * The filters read Sleeper's `settings` blob, which is loosely typed and omits
 * defaults — so the interesting cases are the missing and wrong-typed fields.
 *
 * The rule lists read the other loosely-typed halves of a league —
 * `roster_positions` and `scoring_settings` — so the helper takes those as
 * overrides rather than growing a second fixture.
 */
const league = (
  settings: Record<string, unknown> | null,
  rest: Partial<ManagerLeague> = {},
): ManagerLeague => ({
  league_id: "1",
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings,
  roster_positions: null,
  scoring_settings: null,
  ...rest,
});

/** The defaults with one axis narrowed — what nearly every case below wants. */
const only = (filters: Partial<LeagueFilters>): LeagueFilters => ({
  ...DEFAULT_LEAGUE_FILTERS,
  ...filters,
});

/** A slot rule and a scoring rule, spelled the way the dialog writes them. */
const slots = (...rules: FilterRule[]) => only({ slots: rules });
const scoring = (...rules: FilterRule[]) => only({ scoring: rules });

/** A one-QB lineup, the base the roster-position cases vary from. */
const ONE_QB = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"];

describe("matchesFilters", () => {
  test("the default filters admit everything", () => {
    for (const l of [league(null), league({}), league({ type: 2, best_ball: 1 })]) {
      assert.equal(matchesFilters(l, DEFAULT_LEAGUE_FILTERS), true);
    }
  });

  test("matches an explicit league type", () => {
    const dynasty = league({ type: 2 });
    assert.equal(matchesFilters(dynasty, only({ type: "2" })), true);
    assert.equal(matchesFilters(dynasty, only({ type: "1" })), false);
  });

  test("matches a chopped league on its own code, not as a redraft", () => {
    // Sleeper's native guillotine format. It has to be selectable in its own
    // right: `getManagerLeagues` keeps a rosterless chopped league in the list
    // and drops every other rosterless one, so these are the leagues a reader
    // most needs to isolate — and a type visible in the total and in none of
    // the buckets reads as a filter losing leagues.
    const chopped = league({ type: 3 });
    assert.equal(matchesFilters(chopped, only({ type: "3" })), true);
    assert.equal(matchesFilters(chopped, only({ type: "0" })), false);
    assert.equal(matchesFilters(chopped, only({ type: "2" })), false);
    assert.equal(matchesFilters(league({ type: 2 }), only({ type: "3" })), false);
  });

  test("treats a missing type as redraft, which Sleeper omits", () => {
    for (const l of [league({}), league(null)]) {
      assert.equal(matchesFilters(l, only({ type: "0" })), true);
      assert.equal(matchesFilters(l, only({ type: "2" })), false);
    }
  });

  test("ignores a non-numeric type rather than trusting it", () => {
    // Falls back to the missing-field default (redraft), not a coerced match.
    const odd = league({ type: "2" });
    assert.equal(matchesFilters(odd, only({ type: "2" })), false);
    assert.equal(matchesFilters(odd, only({ type: "0" })), true);
  });

  test("splits best ball from lineup leagues", () => {
    const bestBall = league({ best_ball: 1 });
    const lineup = league({ best_ball: 0 });

    assert.equal(matchesFilters(bestBall, only({ bestBall: "yes" })), true);
    assert.equal(matchesFilters(bestBall, only({ bestBall: "no" })), false);
    assert.equal(matchesFilters(lineup, only({ bestBall: "yes" })), false);
    assert.equal(matchesFilters(lineup, only({ bestBall: "no" })), true);
  });

  test("treats a missing best_ball as a lineup league", () => {
    assert.equal(matchesFilters(league({}), only({ bestBall: "no" })), true);
    assert.equal(matchesFilters(league({}), only({ bestBall: "yes" })), false);
  });

  test("matches a league's status exactly, for the live ones", () => {
    const drafting = league(null, { status: "drafting" });
    assert.equal(matchesFilters(drafting, only({ status: "drafting" })), true);
    assert.equal(matchesFilters(drafting, only({ status: "pre_draft" })), false);
    assert.equal(matchesFilters(drafting, only({ status: "in_season" })), false);
    assert.equal(matchesFilters(drafting, only({ status: "done" })), false);
  });

  test("reads any status outside the live ones as complete", () => {
    // The complement, not a match on `"complete"`: a season-end spelling this
    // code doesn't know still lands in a bucket rather than only in the total.
    for (const status of ["complete", "post_season", "whatever_comes_next"]) {
      const over = league(null, { status });
      assert.equal(matchesFilters(over, only({ status: "done" })), true);
      assert.equal(matchesFilters(over, only({ status: "in_season" })), false);
    }
  });

  test("a QB+SF rule is the superflex question, and counts a second bare QB", () => {
    const superflex = league(null, {
      roster_positions: [...ONE_QB, "SUPER_FLEX"],
    });
    const oneQb = league(null, { roster_positions: ONE_QB });
    const twoQb = league(null, { roster_positions: ["QB", "QB", "RB", "BN"] });
    const rule: FilterRule = { key: "QB+SF", op: "gte", value: 2 };

    assert.equal(matchesFilters(superflex, slots(rule)), true);
    assert.equal(matchesFilters(twoQb, slots(rule)), true);
    assert.equal(matchesFilters(oneQb, slots(rule)), false);
    assert.equal(
      matchesFilters(oneQb, slots({ key: "QB+SF", op: "eq", value: 1 })),
      true,
    );
  });

  test("an IDP rule reads the slot vocabulary, DEF alone not counting", () => {
    const idp = league(null, { roster_positions: [...ONE_QB, "LB", "DB"] });
    const flexIdp = league(null, { roster_positions: [...ONE_QB, "IDP_FLEX"] });
    const teamDef = league(null, { roster_positions: [...ONE_QB, "DEF"] });
    const any: FilterRule = { key: "IDP", op: "gt", value: 0 };

    for (const l of [idp, flexIdp]) {
      assert.equal(matchesFilters(l, slots(any)), true);
      assert.equal(matchesFilters(l, slots({ ...any, op: "eq", value: 0 })), false);
    }
    // Nearly every league starts a team defence, so it says nothing about the
    // game being played — only an individual defender does.
    assert.equal(matchesFilters(teamDef, slots(any)), false);
    assert.equal(
      matchesFilters(teamDef, slots({ ...any, op: "eq", value: 0 })),
      true,
    );
  });

  test("counts every offensive flex as one group, whatever a league calls it", () => {
    const threeFlex = league(null, {
      roster_positions: [...ONE_QB, "WRRB_FLEX", "REC_FLEX"],
    });
    assert.equal(
      matchesFilters(threeFlex, slots({ key: "FLEX", op: "eq", value: 3 })),
      true,
    );
    // SUPER_FLEX takes a quarterback, so it is not one of them.
    const superflex = league(null, {
      roster_positions: [...ONE_QB, "SUPER_FLEX"],
    });
    assert.equal(
      matchesFilters(superflex, slots({ key: "FLEX", op: "eq", value: 1 })),
      true,
    );
  });

  test("counts starters as everything that isn't a bench slot", () => {
    const l = league(null, {
      roster_positions: [...ONE_QB, "IR", "TAXI", "TAXI"],
    });
    assert.equal(matchesFilters(l, slots({ key: "STARTERS", op: "eq", value: 7 })), true);
    assert.equal(matchesFilters(l, slots({ key: "BN", op: "eq", value: 2 })), true);
    assert.equal(matchesFilters(l, slots({ key: "TAXI", op: "eq", value: 2 })), true);
  });

  test("a league with no stored slots fails a slot rule rather than reading as zero", () => {
    // The trap the whole null/zero split exists for: `k = 0` means "leagues
    // without a kicker", and an unsynced lineup is not evidence of one.
    const unknown = league(null);
    assert.equal(matchesFilters(unknown, slots({ key: "K", op: "eq", value: 0 })), false);
    assert.equal(matchesFilters(unknown, slots({ key: "K", op: "gte", value: 1 })), false);
  });

  test("a scoring rule asks the rate directly rather than a bucket", () => {
    const ppr = league(null, { scoring_settings: { rec: 1 } });
    const half = league(null, { scoring_settings: { rec: 0.5 } });
    const std = league(null, { scoring_settings: { rec: 0 } });

    assert.equal(matchesFilters(ppr, scoring({ key: "rec", op: "gte", value: 1 })), true);
    assert.equal(matchesFilters(half, scoring({ key: "rec", op: "eq", value: 0.5 })), true);
    assert.equal(matchesFilters(half, scoring({ key: "rec", op: "gte", value: 1 })), false);
    assert.equal(matchesFilters(std, scoring({ key: "rec", op: "lt", value: 0.5 })), true);
    // The bucket boundaries the old filter rounded to are now expressible either
    // side of: a 0.4-point league is neither standard nor half in one word.
    const odd = league(null, { scoring_settings: { rec: 0.4 } });
    assert.equal(matchesFilters(odd, scoring({ key: "rec", op: "gt", value: 0.25 })), true);
  });

  test("an unpaid stat is zero, which is how TE premium is asked", () => {
    const premium = league(null, {
      scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
    });
    const plain = league(null, { scoring_settings: { rec: 1 } });
    const rule: FilterRule = { key: "bonus_rec_te", op: "gt", value: 0 };

    assert.equal(matchesFilters(premium, scoring(rule)), true);
    assert.equal(matchesFilters(plain, scoring(rule)), false);
    assert.equal(
      matchesFilters(plain, scoring({ ...rule, op: "eq", value: 0 })),
      true,
    );
  });

  test("a league with no stored scoring fails a scoring rule", () => {
    // Unlike an absent key inside a stored blob, an absent blob is not a claim
    // that the league pays nothing.
    const unknown = league(null);
    const rule: FilterRule = { key: "bonus_rec_te", op: "eq", value: 0 };
    assert.equal(matchesFilters(unknown, scoring(rule)), false);
  });

  test("requires every rule to pass, alongside the fixed filters", () => {
    const superflexIdp = league({ type: 2 }, {
      roster_positions: [...ONE_QB, "SUPER_FLEX", "LB"],
      scoring_settings: { rec: 1, bonus_rec_te: 1 },
    });
    assert.equal(
      matchesFilters(superflexIdp, {
        ...only({ type: "2" }),
        slots: [
          { key: "QB+SF", op: "gte", value: 2 },
          { key: "IDP", op: "gt", value: 0 },
        ],
        scoring: [
          { key: "rec", op: "gte", value: 1 },
          { key: "bonus_rec_te", op: "gt", value: 0 },
        ],
      }),
      true,
    );
    assert.equal(
      matchesFilters(
        superflexIdp,
        slots(
          { key: "QB+SF", op: "gte", value: 2 },
          { key: "IDP", op: "eq", value: 0 },
        ),
      ),
      false,
    );
    assert.equal(
      matchesFilters(superflexIdp, { ...slots({ key: "IDP", op: "gt", value: 0 }), type: "1" }),
      false,
    );
  });

  test("a rule naming a slot group this build doesn't know fails rather than passes", () => {
    const l = league(null, { roster_positions: ONE_QB });
    assert.equal(matchesFilters(l, slots({ key: "OL", op: "eq", value: 0 })), false);
  });
});

/**
 * Rates are floats Sleeper stores as fractions — a passing yard is 0.04 — so the
 * comparisons carry a tolerance rather than trusting binary equality.
 */
describe("compare", () => {
  test("equality survives a float that isn't exactly the number typed", () => {
    assert.equal(compare(0.1 + 0.2, "eq", 0.3), true);
    assert.equal(compare(0.1 + 0.2, "ne", 0.3), false);
    assert.equal(compare(0.5, "eq", 1), false);
  });

  test("the bounds are inclusive where they say they are", () => {
    assert.equal(compare(1, "gte", 1), true);
    assert.equal(compare(1, "lte", 1), true);
    assert.equal(compare(1, "gt", 1), false);
    assert.equal(compare(1, "lt", 1), false);
    assert.equal(compare(2, "gt", 1), true);
    assert.equal(compare(0, "lt", 1), true);
  });
});

describe("slotCount and scoringValue", () => {
  test("null is unknown and 0 is an answer", () => {
    const lineup = league(null, { roster_positions: ONE_QB });
    assert.equal(slotCount(lineup, "K"), 0);
    assert.equal(slotCount(league(null), "K"), null);

    const scored = league(null, { scoring_settings: { rec: 1 } });
    assert.equal(scoringValue(scored, "bonus_rec_te"), 0);
    assert.equal(scoringValue(league(null), "rec"), null);
  });
});

describe("scoringKeyOptions", () => {
  test("offers the keys the leagues in hand actually score", () => {
    const keys = scoringKeyOptions([
      league(null, { scoring_settings: { pass_td: 4, rec: 1 } }),
      league(null, { scoring_settings: { rec: 0.5, house_rule: 3 } }),
    ]);
    assert.deepEqual(keys, ["rec", "pass_td", "house_rule"]);
  });

  test("falls back to the common keys on a cold load", () => {
    // With no leagues streamed yet the dialog still has to offer something.
    assert.equal(scoringKeyOptions([])[0], "rec");
  });
});

/**
 * The two readouts the modal's trigger and the header's scope line are built
 * from — with the controls hidden, they are all the page says about what is
 * selected, so they have to agree with `matchesFilters` about what "all" means.
 */
describe("activeFilterCount", () => {
  test("the defaults narrow nothing", () => {
    assert.equal(activeFilterCount(DEFAULT_LEAGUE_FILTERS), 0);
  });

  test("counts each fixed filter that is not 'all'", () => {
    assert.equal(activeFilterCount(only({ type: "2" })), 1);
    assert.equal(activeFilterCount(only({ bestBall: "no" })), 1);
    assert.equal(activeFilterCount(only({ type: "2", bestBall: "no" })), 2);
  });

  test("counts each rule on its own, since each narrows on its own", () => {
    assert.equal(activeFilterCount(slots({ key: "QB+SF", op: "gte", value: 2 })), 1);
    assert.equal(
      activeFilterCount({
        ...only({ status: "in_season", type: "2" }),
        slots: [
          { key: "QB+SF", op: "gte", value: 2 },
          { key: "IDP", op: "eq", value: 0 },
        ],
        scoring: [{ key: "rec", op: "gte", value: 1 }],
      }),
      5,
    );
  });
});

describe("filterSummary", () => {
  test("names the unfiltered list rather than reading as empty", () => {
    assert.equal(filterSummary(DEFAULT_LEAGUE_FILTERS), "all leagues");
  });

  test("joins the active filters, lower case for mid-sentence use", () => {
    assert.equal(filterSummary(only({ type: "2" })), "dynasty");
    assert.equal(filterSummary(only({ bestBall: "yes" })), "best ball");
    assert.equal(filterSummary(only({ type: "0", bestBall: "no" })), "redraft · lineup");
  });

  test("spells a rule out with its symbol, fixed filters first", () => {
    assert.equal(
      filterSummary({
        ...only({ status: "in_season" }),
        slots: [{ key: "QB+SF", op: "gte", value: 2 }],
        scoring: [{ key: "bonus_rec_te", op: "gt", value: 0.5 }],
      }),
      "in season · qb+sf ≥ 2 · bonus rec te > 0.5",
    );
  });
});

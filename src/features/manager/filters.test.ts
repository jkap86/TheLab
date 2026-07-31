import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_LEAGUE_FILTERS,
  type LeagueFilters,
  activeFilterCount,
  filterSummary,
  hasIdpSlots,
  hasTePremium,
  matchesFilters,
} from "./filters.ts";
import type { ManagerLeague } from "./types.ts";

/**
 * The filters read Sleeper's `settings` blob, which is loosely typed and omits
 * defaults — so the interesting cases are the missing and wrong-typed fields.
 *
 * The later filters read the other loosely-typed halves of a league — `status`,
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

  test("splits superflex from one-QB lineups off the slots", () => {
    const superflex = league(null, {
      roster_positions: [...ONE_QB, "SUPER_FLEX"],
    });
    const oneQb = league(null, { roster_positions: ONE_QB });

    assert.equal(matchesFilters(superflex, only({ superflex: "yes" })), true);
    assert.equal(matchesFilters(superflex, only({ superflex: "no" })), false);
    assert.equal(matchesFilters(oneQb, only({ superflex: "yes" })), false);
    assert.equal(matchesFilters(oneQb, only({ superflex: "no" })), true);
  });

  test("counts a second bare QB slot as superflex, not just SUPER_FLEX", () => {
    const twoQb = league(null, { roster_positions: ["QB", "QB", "RB", "BN"] });
    assert.equal(matchesFilters(twoQb, only({ superflex: "yes" })), true);
  });

  test("splits IDP leagues off the slots, DEF alone not counting", () => {
    const idp = league(null, { roster_positions: [...ONE_QB, "LB", "DB"] });
    const flexIdp = league(null, { roster_positions: [...ONE_QB, "IDP_FLEX"] });
    const teamDef = league(null, { roster_positions: [...ONE_QB, "DEF"] });

    for (const l of [idp, flexIdp]) {
      assert.equal(matchesFilters(l, only({ idp: "yes" })), true);
      assert.equal(matchesFilters(l, only({ idp: "no" })), false);
    }
    // Nearly every league starts a team defence, so it says nothing about the
    // game being played — only an individual defender does.
    assert.equal(matchesFilters(teamDef, only({ idp: "yes" })), false);
    assert.equal(matchesFilters(teamDef, only({ idp: "no" })), true);
  });

  test("puts a league with no stored slots on the 'no' side of both", () => {
    // The same answer the rest of the app gives an unknown lineup (it prices off
    // the 1QB board). What matters here is that the two sides still sum to the
    // list rather than the league vanishing from both.
    const unknown = league(null);
    assert.equal(matchesFilters(unknown, only({ superflex: "no" })), true);
    assert.equal(matchesFilters(unknown, only({ idp: "no" })), true);
  });

  test("buckets scoring by reception points", () => {
    const cases: [number | undefined, LeagueFilters["scoring"]][] = [
      [1, "ppr"],
      [0.5, "half_ppr"],
      [0, "std"],
      [undefined, "std"],
    ];
    for (const [rec, bucket] of cases) {
      const l = league(null, {
        scoring_settings: rec === undefined ? null : { rec },
      });
      assert.equal(matchesFilters(l, only({ scoring: bucket })), true);
      assert.equal(
        matchesFilters(l, only({ scoring: bucket === "ppr" ? "std" : "ppr" })),
        false,
      );
    }
  });

  test("splits TE premium leagues, whatever the reception bucket", () => {
    const premium = league(null, {
      scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
    });
    const plain = league(null, { scoring_settings: { rec: 1 } });

    assert.equal(matchesFilters(premium, only({ tePremium: "yes" })), true);
    assert.equal(matchesFilters(premium, only({ tePremium: "no" })), false);
    assert.equal(matchesFilters(plain, only({ tePremium: "yes" })), false);
    assert.equal(matchesFilters(plain, only({ tePremium: "no" })), true);
    // The two are independent axes: a premium league is still a PPR league.
    assert.equal(
      matchesFilters(premium, only({ tePremium: "yes", scoring: "ppr" })),
      true,
    );
  });

  test("requires every active filter to pass", () => {
    const dynastyBestBall = league({ type: 2, best_ball: 1 });
    assert.equal(
      matchesFilters(dynastyBestBall, only({ type: "2", bestBall: "yes" })),
      true,
    );
    assert.equal(
      matchesFilters(dynastyBestBall, only({ type: "2", bestBall: "no" })),
      false,
    );
    assert.equal(
      matchesFilters(dynastyBestBall, only({ type: "1", bestBall: "yes" })),
      false,
    );
  });

  test("requires the roster and scoring filters to pass together too", () => {
    const superflexIdp = league({ type: 2 }, {
      roster_positions: [...ONE_QB, "SUPER_FLEX", "LB"],
      scoring_settings: { rec: 1, bonus_rec_te: 1 },
    });
    assert.equal(
      matchesFilters(
        superflexIdp,
        only({ superflex: "yes", idp: "yes", scoring: "ppr", tePremium: "yes" }),
      ),
      true,
    );
    assert.equal(
      matchesFilters(superflexIdp, only({ superflex: "yes", idp: "no" })),
      false,
    );
  });
});

describe("hasIdpSlots", () => {
  test("reads the slot vocabulary rather than a list of names", () => {
    assert.equal(hasIdpSlots(league(null, { roster_positions: ["DL"] })), true);
    assert.equal(hasIdpSlots(league(null, { roster_positions: ["DEF"] })), false);
    assert.equal(hasIdpSlots(league(null, { roster_positions: [] })), false);
    assert.equal(hasIdpSlots(league(null)), false);
  });
});

describe("hasTePremium", () => {
  test("any positive bonus counts, and a missing one doesn't", () => {
    const withBonus = (bonus_rec_te: number) =>
      league(null, { scoring_settings: { rec: 1, bonus_rec_te } });
    assert.equal(hasTePremium(withBonus(0.5)), true);
    assert.equal(hasTePremium(withBonus(1)), true);
    assert.equal(hasTePremium(withBonus(0)), false);
    assert.equal(hasTePremium(league(null, { scoring_settings: { rec: 1 } })), false);
    assert.equal(hasTePremium(league(null)), false);
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

  test("counts each filter that is not 'all'", () => {
    assert.equal(activeFilterCount(only({ type: "2" })), 1);
    assert.equal(activeFilterCount(only({ bestBall: "no" })), 1);
    assert.equal(activeFilterCount(only({ type: "2", bestBall: "no" })), 2);
  });

  test("counts the roster and scoring filters too", () => {
    assert.equal(activeFilterCount(only({ status: "in_season" })), 1);
    assert.equal(activeFilterCount(only({ superflex: "yes" })), 1);
    assert.equal(activeFilterCount(only({ idp: "no" })), 1);
    assert.equal(activeFilterCount(only({ scoring: "ppr" })), 1);
    assert.equal(activeFilterCount(only({ tePremium: "yes" })), 1);
    // Every axis at once — the count has to keep up with the type.
    assert.equal(
      activeFilterCount({
        type: "2",
        bestBall: "no",
        status: "in_season",
        superflex: "yes",
        idp: "no",
        scoring: "ppr",
        tePremium: "yes",
      }),
      7,
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

  test("names the roster and scoring filters in the dialog's own order", () => {
    assert.equal(
      filterSummary(only({ scoring: "half_ppr", status: "in_season", superflex: "yes" })),
      "in season · superflex · half ppr",
    );
    assert.equal(filterSummary(only({ idp: "no", tePremium: "yes" })), "offense only · te premium");
  });
});

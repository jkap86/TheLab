import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_LEAGUE_FILTERS,
  type FilterRule,
  type LeagueFilters,
  activeFilterCount,
  activeFilters,
  clearFilter,
  compare,
  filterSummary,
  leagueBreakdown,
  matchesFilters,
  scoringKeyOptions,
  scoringValue,
  seasonOptions,
  settingIsSentinel,
  settingKeyOptions,
  settingValue,
  slotCount,
} from "./league-filters/index.ts";
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

/** The three rule lists, spelled the way the dialog writes them. */
const slots = (...rules: FilterRule[]) => only({ slots: rules });
const scoring = (...rules: FilterRule[]) => only({ scoring: rules });
const settings = (...rules: FilterRule[]) => only({ settings: rules });

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

/**
 * The settings rules. They arrived as one key — `teams`, the ADP board's own
 * `All sizes / 10 / 12` chip in the vocabulary every other league filter is
 * already written in — and widened to the rest of Sleeper's `settings` blob,
 * which is already on the wire and was being read for exactly two fields.
 *
 * The interesting cases are all about what a *number* means: an absent key, a
 * zero that is a real answer, and a zero that is not.
 */
describe("the settings rules", () => {
  test("teams reads the league's roster count, which is not in the blob", () => {
    assert.equal(settingValue(league(null, { total_rosters: 10 }), "teams"), 10);
    // Sleeper always reports `total_rosters` for a live league, so a 0 is a row
    // stored before the league answered — and `teams < 10` sweeping in every
    // such league is the `k = 0` trap `slotCount` keeps null for.
    assert.equal(settingValue(league(null, { total_rosters: 0 }), "teams"), null);
    assert.equal(
      matchesFilters(
        league(null, { total_rosters: 0 }),
        settings({ key: "teams", op: "lt", value: 10 }),
      ),
      false,
    );
  });

  test("an exact size and a bound both narrow, and a band is two rules", () => {
    const twelve = league(null, { total_rosters: 12 });
    const ten = league(null, { total_rosters: 10 });
    assert.equal(matchesFilters(twelve, settings({ key: "teams", op: "eq", value: 12 })), true);
    assert.equal(matchesFilters(ten, settings({ key: "teams", op: "eq", value: 12 })), false);
    assert.equal(matchesFilters(ten, settings({ key: "teams", op: "lte", value: 10 })), true);
    // A band is `>= 10` *and* `<= 12`, which is what the lists being an AND is
    // for — and is the thing a pair of bounds on one field could not express.
    const band = settings(
      { key: "teams", op: "gte", value: 10 },
      { key: "teams", op: "lte", value: 12 },
    );
    assert.equal(matchesFilters(ten, band), true);
    assert.equal(matchesFilters(twelve, band), true);
    assert.equal(matchesFilters(league(null, { total_rosters: 14 }), band), false);
  });

  test("reads any numeric key out of the blob, ranked or not", () => {
    const l = league({ taxi_slots: 3, house_rule: 7 });
    assert.equal(settingValue(l, "taxi_slots"), 3);
    // An unranked key is still evaluable — the table names and orders, it does
    // not gate. A rule on it narrows exactly as one on a named key does.
    assert.equal(settingValue(l, "house_rule"), 7);
    assert.equal(matchesFilters(l, settings({ key: "house_rule", op: "eq", value: 7 })), true);
  });

  test("an absent key is read per key: a count is zero, a week is unknown", () => {
    // Sleeper omits what a league doesn't set, so a count or a flag missing is a
    // real 0 — which is what makes `taxi_slots = 0` mean "no taxi squad" and
    // `disable_trades = 0` mean "trades enabled".
    const bare = league({});
    assert.equal(settingValue(bare, "taxi_slots"), 0);
    assert.equal(settingValue(bare, "disable_trades"), 0);
    assert.equal(matchesFilters(bare, settings({ key: "disable_trades", op: "eq", value: 0 })), true);
    // A week has no zero on its scale, so nothing stored is unknown rather than
    // week 0 — and an unknown fails the rule, as every unknown here does.
    assert.equal(settingValue(bare, "trade_deadline"), null);
    assert.equal(settingValue(bare, "playoff_week_start"), null);
    assert.equal(matchesFilters(bare, settings({ key: "trade_deadline", op: "lte", value: 12 })), false);
  });

  test("a whole missing blob is unknown for every key", () => {
    const l = league(null);
    assert.equal(settingValue(l, "taxi_slots"), null);
    assert.equal(settingValue(l, "disable_trades"), null);
    assert.equal(matchesFilters(l, settings({ key: "disable_trades", op: "eq", value: 0 })), false);
  });

  test("a non-numeric value is read as absent, not coerced", () => {
    const junk = league({ taxi_slots: "3", trade_deadline: null });
    assert.equal(settingValue(junk, "taxi_slots"), 0);
    assert.equal(settingValue(junk, "trade_deadline"), null);
  });

  test("it counts, names and clears itself like the other two lists", () => {
    const filters = settings({ key: "teams", op: "gte", value: 12 });
    assert.equal(activeFilterCount(filters), 1);
    assert.equal(filterSummary(filters), "teams ≥ 12");
    const [active] = activeFilters(filters);
    assert.deepEqual(active, { kind: "setting", index: 0, label: "teams ≥ 12" });
    assert.deepEqual(clearFilter(filters, active).settings, []);
  });

  test("a named value reads as a sentence rather than as a digit", () => {
    // `disable_trades = 1` is correct and unreadable: the chip is the only thing
    // outside the dialog saying what a settings rule narrowed to, so it has to
    // be the sentence the row shows.
    assert.equal(
      filterSummary(settings({ key: "disable_trades", op: "eq", value: 1 })),
      "trades is disabled",
    );
    assert.equal(
      filterSummary(settings({ key: "disable_trades", op: "ne", value: 1 })),
      "trades is not disabled",
    );
    // A comparison a name has no reading for falls back to the symbol form
    // rather than inventing one.
    assert.equal(
      filterSummary(settings({ key: "disable_trades", op: "gte", value: 1 })),
      "trades ≥ 1",
    );
  });
});

/**
 * `trade_deadline: 99` is Sleeper's spelling of "no deadline" — a name wearing a
 * number, and the reason the settings bay has a third value kind.
 *
 * Read as a week, one of the two obvious rules is right by luck and the other is
 * silently wrong. That is the whole of what these pin.
 */
describe("the trade-deadline sentinel", () => {
  const none = league({ trade_deadline: 99 });
  const week12 = league({ trade_deadline: 12 });
  const week14 = league({ trade_deadline: 14 });

  test("it does not compare as a place on the scale", () => {
    assert.equal(settingValue(none, "trade_deadline"), null);
    assert.equal(settingValue(week12, "trade_deadline"), 12);
  });

  test("a late-deadline rule excludes it — the case a raw 99 gets wrong", () => {
    const late = settings({ key: "trade_deadline", op: "gte", value: 13 });
    assert.equal(matchesFilters(week14, late), true);
    // The bug this exists to stop: `99 >= 13` is true, so "leagues that trade
    // late" would answer with every league that never stops trading.
    assert.equal(matchesFilters(none, late), false);
  });

  test("an early-deadline rule excludes it too — right, but not by luck", () => {
    const early = settings({ key: "trade_deadline", op: "lte", value: 12 });
    assert.equal(matchesFilters(week12, early), true);
    assert.equal(matchesFilters(none, early), false);
  });

  test("it is still reachable by name, which is what a plain null would cost", () => {
    const isNone = settings({ key: "trade_deadline", op: "eq", value: 99 });
    assert.equal(matchesFilters(none, isNone), true);
    assert.equal(matchesFilters(week12, isNone), false);
    const hasOne = settings({ key: "trade_deadline", op: "ne", value: 99 });
    assert.equal(matchesFilters(week12, hasOne), true);
    assert.equal(matchesFilters(none, hasOne), false);
  });

  test("an unknown fails a sentinel rule, as it fails every rule here", () => {
    for (const l of [league(null), league({})]) {
      assert.equal(settingIsSentinel(l, "trade_deadline"), null);
      assert.equal(matchesFilters(l, settings({ key: "trade_deadline", op: "eq", value: 99 })), false);
      assert.equal(matchesFilters(l, settings({ key: "trade_deadline", op: "ne", value: 99 })), false);
    }
  });

  test("only = and ≠ address it; a comparison against 99 stays a comparison", () => {
    // `trade_deadline >= 99` has no reading as a name, so it is read on the
    // scale — where the sentinel is absent and nothing matches.
    const odd = settings({ key: "trade_deadline", op: "gte", value: 99 });
    assert.equal(matchesFilters(none, odd), false);
    assert.equal(matchesFilters(week14, odd), false);
  });

  test("a key with no sentinel is never read as having one", () => {
    assert.equal(settingIsSentinel(league({ taxi_slots: 99 }), "taxi_slots"), null);
    assert.equal(settingValue(league({ taxi_slots: 99 }), "taxi_slots"), 99);
  });

  test("the chip names it rather than quoting the number", () => {
    assert.equal(
      filterSummary(settings({ key: "trade_deadline", op: "eq", value: 99 })),
      "trade deadline is no deadline",
    );
    assert.equal(
      filterSummary(settings({ key: "trade_deadline", op: "ne", value: 99 })),
      "trade deadline is not no deadline",
    );
  });
});

/**
 * The season, which is the one filter here that is not an attribute of a league
 * but the population the rest are read against.
 */
describe("the season filter", () => {
  const y2026 = league(null, { season: "2026" });
  const y2025 = league(null, { season: "2025" });

  test("narrows to one season, and `all` narrows nothing", () => {
    assert.equal(matchesFilters(y2026, only({ season: "2026" })), true);
    assert.equal(matchesFilters(y2025, only({ season: "2026" })), false);
    assert.equal(matchesFilters(y2025, only({ season: "all" })), true);
  });

  test("a season no league carries matches nothing rather than everything", () => {
    // A stored selection outlives the population that produced it, and the
    // honest answer there is an empty list rather than an ignored filter.
    assert.equal(matchesFilters(y2026, only({ season: "2019" })), false);
  });

  test("it counts, names and clears itself like the other fixed filters", () => {
    const filters = only({ season: "2026" });
    assert.equal(activeFilterCount(filters), 1);
    assert.equal(filterSummary(filters), "2026");
    const [active] = activeFilters(filters);
    assert.deepEqual(active, { kind: "fixed", field: "season", label: "2026" });
    assert.equal(clearFilter(filters, active).season, "all");
  });

  test("it leads the summary, because everything else narrows within it", () => {
    const filters = only({ season: "2026", type: "2" });
    assert.equal(filterSummary(filters), "2026 · dynasty");
  });
});

describe("seasonOptions", () => {
  test("offers the seasons in hand, newest first, deduplicated", () => {
    assert.deepEqual(
      seasonOptions([
        league(null, { season: "2025" }),
        league(null, { season: "2026" }),
        league(null, { season: "2025" }),
        league(null, { season: "2024" }),
      ]),
      ["2026", "2025", "2024"],
    );
  });

  test("one season is one option, which is what the band reads as no choice", () => {
    // Every caller but the ADP board's widest setting resolves a single season
    // server-side, so this is the ordinary answer and the band draws nothing.
    assert.deepEqual(seasonOptions([league(null), league(null)]), ["2026"]);
    assert.deepEqual(seasonOptions([]), []);
  });
});

describe("settingKeyOptions", () => {
  test("offers teams always, since it is the one key not in the blob", () => {
    assert.deepEqual(settingKeyOptions([]), ["teams"]);
  });

  test("offers the numeric keys the leagues in hand carry, ranked", () => {
    const keys = settingKeyOptions([
      league({ house_rule: 3, taxi_slots: 2 }),
      league({ trade_deadline: 12 }),
    ]);
    // Ranked ones in table order, then everything else alphabetically.
    assert.deepEqual(keys, ["teams", "trade_deadline", "taxi_slots", "house_rule"]);
  });

  test("drops type and best_ball, which the rails four inches above already ask", () => {
    const keys = settingKeyOptions([league({ type: 2, best_ball: 1, taxi_slots: 2 })]);
    assert.equal(keys.includes("type"), false);
    assert.equal(keys.includes("best_ball"), false);
    assert.deepEqual(keys, ["teams", "taxi_slots"]);
  });

  test("drops what a rule could not evaluate", () => {
    // A rule is a comparison against a number, so a key holding a string or an
    // object is a key no rule could read.
    const keys = settingKeyOptions([
      league({ division_names: ["a", "b"], name: "x", taxi_slots: 1 }),
    ]);
    assert.deepEqual(keys, ["teams", "taxi_slots"]);
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

/**
 * The dialog's readout rail restates the selection as chips that strike
 * themselves out, so each active filter has to be addressable as well as
 * nameable — and clearing one has to leave the rest exactly as they were.
 */
describe("activeFilters and clearFilter", () => {
  const built: LeagueFilters = {
    ...only({ status: "in_season", type: "2" }),
    slots: [
      { key: "QB+SF", op: "gte", value: 2 },
      { key: "IDP", op: "eq", value: 0 },
    ],
    scoring: [{ key: "rec", op: "eq", value: 0.5 }],
  };

  test("names every narrowing filter, and nothing when none are", () => {
    assert.deepEqual(activeFilters(DEFAULT_LEAGUE_FILTERS), []);
    assert.deepEqual(
      activeFilters(built).map((f) => f.label),
      ["in season", "dynasty", "qb+sf ≥ 2", "idp = 0", "rec = 0.5"],
    );
  });

  test("the count and the summary are the same walk, so they can't disagree", () => {
    assert.equal(activeFilterCount(built), activeFilters(built).length);
    assert.equal(
      filterSummary(built),
      activeFilters(built)
        .map((f) => f.label)
        .join(" · "),
    );
  });

  test("clearing a fixed filter returns it to 'all', not to nothing", () => {
    const type = activeFilters(built).find(
      (f) => f.kind === "fixed" && f.field === "type",
    )!;
    const cleared = clearFilter(built, type);
    assert.equal(cleared.type, "all");
    // Everything else survives untouched — the chip lifts one filter out.
    assert.equal(cleared.status, "in_season");
    assert.deepEqual(cleared.slots, built.slots);
    assert.deepEqual(cleared.scoring, built.scoring);
  });

  test("clearing a rule removes the one at that position, not one like it", () => {
    // Two identical rules are indistinguishable by value, which is why the
    // address is a position: removing "the matching one" would be ambiguous.
    const twice: LeagueFilters = {
      ...DEFAULT_LEAGUE_FILTERS,
      slots: [
        { key: "K", op: "eq", value: 0 },
        { key: "K", op: "eq", value: 0 },
      ],
    };
    const first = activeFilters(twice)[0];
    assert.equal(clearFilter(twice, first).slots.length, 1);

    const idp = activeFilters(built).find(
      (f) => f.kind === "slot" && f.index === 1,
    )!;
    const cleared = clearFilter(built, idp);
    assert.deepEqual(cleared.slots, [{ key: "QB+SF", op: "gte", value: 2 }]);
    assert.deepEqual(cleared.scoring, built.scoring);
    assert.equal(cleared.type, "2");
  });

  test("clearing every chip in turn lands back on the defaults", () => {
    let filters = built;
    // Backwards, because clearing by index shifts the ones after it — which is
    // what the rail does anyway, since it re-derives after every click.
    for (const entry of activeFilters(built).reverse()) {
      filters = clearFilter(filters, entry);
    }
    assert.deepEqual(filters, DEFAULT_LEAGUE_FILTERS);
  });
});

/**
 * The rail's composition list. Each row is a filter rather than a predicate of
 * its own, which is what keeps "Superflex 17" equal to what the superflex
 * quick-add would leave.
 */
describe("leagueBreakdown", () => {
  const ONE_QB_LINEUP = league(null, { roster_positions: ONE_QB });

  test("counts each axis over the leagues handed in", () => {
    const rows = leagueBreakdown([
      league({ type: 2 }, { roster_positions: [...ONE_QB, "SUPER_FLEX"] }),
      league({ type: 2, best_ball: 1 }, { roster_positions: [...ONE_QB, "LB"] }),
      league({ type: 0 }, { roster_positions: ONE_QB }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.key, r.count]),
      [
        ["dynasty", 2],
        ["superflex", 1],
        ["idp", 1],
        ["best_ball", 1],
      ],
    );
  });

  test("an unsynced lineup is not evidence of a superflex or IDP league", () => {
    // The same null rule the slot filters hold to: unknown fails the row rather
    // than reading as zero on one side or a match on the other.
    const rows = leagueBreakdown([league({ type: 2 })]);
    const count = (key: string) => rows.find((r) => r.key === key)!.count;
    assert.equal(count("dynasty"), 1);
    assert.equal(count("superflex"), 0);
    assert.equal(count("idp"), 0);
  });

  test("an empty list is four zeros rather than no rows", () => {
    // The rail draws the rows whenever anything matched, so a shape that varies
    // with the data would make the panel's height jump as filters move.
    assert.deepEqual(
      leagueBreakdown([]).map((r) => r.count),
      [0, 0, 0, 0],
    );
    assert.equal(leagueBreakdown([ONE_QB_LINEUP]).length, 4);
  });
});

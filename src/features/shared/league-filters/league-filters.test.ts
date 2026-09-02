import assert from "node:assert/strict";
import { test } from "node:test";

import type { ManagerLeague } from "@/shared/contract";

import { DEFAULT_LEAGUE_FILTERS, NO_TRADE_DEADLINE } from "./defaults.ts";
import { leagueBreakdown } from "./breakdown.ts";
import { scoringKeyOptions, settingKeyOptions } from "./options.ts";
import {
  isBestBall,
  leagueType,
  matchesFilters,
  matchesScoringRule,
  matchesSettingRule,
  matchesSlotRule,
  slotCount,
} from "./predicates.ts";
import {
  activeFilterCount,
  activeFilters,
  clearFilter,
  filterSummary,
} from "./summaries.ts";
import type { LeagueFilters } from "./types.ts";

/**
 * The filter rules, pinned at the decisions that are silent when wrong.
 *
 * Every one of these is a quirk of Sleeper's data rather than a property of the
 * comparison: an absent key that means zero in one blob and unknown in another,
 * a rate stored as a float, a week that is not a week. A rule getting one of
 * them wrong returns the wrong *rows* — no error, no wrong-looking number.
 */

/** A league with only what a test cares about; everything else is plausible. */
function league(over: Partial<ManagerLeague> = {}): ManagerLeague {
  return {
    league_id: "1",
    name: "Test League",
    season: "2026",
    status: "in_season",
    total_rosters: 12,
    avatar_url: null,
    team_name: null,
    record: null,
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
    settings: {},
    scoring_settings: {},
    ...over,
  };
}

/** `DEFAULT_LEAGUE_FILTERS` with one field replaced. */
function filters(over: Partial<LeagueFilters> = {}): LeagueFilters {
  return { ...DEFAULT_LEAGUE_FILTERS, ...over };
}

test("a stored half-PPR rate matches an eq rule despite float representation", () => {
  // 0.1 + 0.4 is 0.5000000000000001, which is what a hand-typed `===` denies.
  const half = league({ scoring_settings: { rec: 0.1 + 0.4 } });
  assert.equal(
    matchesScoringRule(half, { key: "rec", op: "eq", value: 0.5 }),
    true,
  );
  assert.equal(
    matchesScoringRule(half, { key: "rec", op: "lt", value: 0.5 }),
    false,
  );
});

test("an absent scoring key reads as zero, an absent blob as unknown", () => {
  // Sleeper omits what a league doesn't pay for, which is why TE premium is
  // asked as `bonus_rec_te > 0` rather than by presence.
  const stored = league({ scoring_settings: { rec: 1 } });
  assert.equal(
    matchesScoringRule(stored, { key: "bonus_rec_te", op: "eq", value: 0 }),
    true,
  );
  assert.equal(
    matchesScoringRule(stored, { key: "bonus_rec_te", op: "gt", value: 0 }),
    false,
  );

  // A blob that never synced is not evidence either way, so every rule fails.
  const unsynced = league({ scoring_settings: null });
  assert.equal(
    matchesScoringRule(unsynced, { key: "bonus_rec_te", op: "eq", value: 0 }),
    false,
  );
});

test("an unsynced lineup fails a slot rule rather than counting as zero", () => {
  // The `K = 0` trap: "leagues without a kicker" must not sweep in every league
  // whose lineup simply hasn't been fetched.
  const unsynced = league({ roster_positions: null });
  assert.equal(slotCount(unsynced, "K"), null);
  assert.equal(
    matchesSlotRule(unsynced, { key: "K", op: "eq", value: 0 }),
    false,
  );

  // A league that genuinely starts no kicker does match.
  assert.equal(matchesSlotRule(league(), { key: "K", op: "eq", value: 0 }), true);
});

test("QB+SF counts every QB-eligible starting slot, IDP excludes DEF", () => {
  const superflex = league({
    roster_positions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
  });
  assert.equal(slotCount(superflex, "QB+SF"), 2);
  assert.equal(
    matchesSlotRule(superflex, { key: "QB+SF", op: "gte", value: 2 }),
    true,
  );
  assert.equal(slotCount(league(), "QB+SF"), 1);

  // A team defence is not an individual defender — the whole reason `IDP_SLOTS`
  // is a narrower set than `DEFENSIVE_SLOTS`.
  const teamD = league({ roster_positions: ["QB", "DEF", "BN"] });
  assert.equal(slotCount(teamD, "IDP"), 0);
  const idp = league({ roster_positions: ["QB", "LB", "IDP_FLEX", "BN"] });
  assert.equal(slotCount(idp, "IDP"), 2);
});

test("FLEX groups the offensive flexes, STARTERS is everything but the bench", () => {
  const wide = league({
    roster_positions: ["QB", "FLEX", "WRRB_FLEX", "REC_FLEX", "BN", "IR", "TAXI"],
  });
  assert.equal(slotCount(wide, "FLEX"), 3);
  // SUPER_FLEX takes a QB, so it is not an offensive flex for this purpose.
  assert.equal(slotCount(league({ roster_positions: ["SUPER_FLEX"] }), "FLEX"), 0);
  assert.equal(slotCount(wide, "STARTERS"), 4);
});

test("teams reads total_rosters, and a zero is unknown rather than a real size", () => {
  assert.equal(
    matchesSettingRule(league(), { key: "teams", op: "eq", value: 12 }),
    true,
  );
  // A row stored before the league answered must not match `teams < 10`.
  const unanswered = league({ total_rosters: 0 });
  assert.equal(
    matchesSettingRule(unanswered, { key: "teams", op: "lt", value: 10 }),
    false,
  );
});

test("an absent setting is zero for a count and unknown for a week", () => {
  const bare = league({ settings: {} });
  // `taxi_slots` missing is no taxi squad.
  assert.equal(
    matchesSettingRule(bare, { key: "taxi_slots", op: "eq", value: 0 }),
    true,
  );
  // A week has no zero on its scale, so absent fails rather than reading week 0.
  assert.equal(
    matchesSettingRule(bare, { key: "playoff_week_start", op: "eq", value: 0 }),
    false,
  );
  // An unranked key falls to the common case, zero.
  assert.equal(
    matchesSettingRule(bare, { key: "some_new_key", op: "eq", value: 0 }),
    true,
  );
});

test("the no-deadline sentinel is unreachable by comparison and reachable by name", () => {
  const never = league({ settings: { trade_deadline: NO_TRADE_DEADLINE } });
  const week12 = league({ settings: { trade_deadline: 12 } });

  // The bug this exists to stop: "leagues that trade late" answering with every
  // league that never stops trading.
  assert.equal(
    matchesSettingRule(never, { key: "trade_deadline", op: "gte", value: 13 }),
    false,
  );
  assert.equal(
    matchesSettingRule(never, { key: "trade_deadline", op: "lte", value: 12 }),
    false,
  );

  // But it stays askable by name.
  const isNever = {
    key: "trade_deadline",
    op: "eq",
    value: NO_TRADE_DEADLINE,
  } as const;
  assert.equal(matchesSettingRule(never, isNever), true);
  assert.equal(matchesSettingRule(week12, isNever), false);
  assert.equal(
    matchesSettingRule(week12, { ...isNever, op: "ne" }),
    true,
  );

  // An unknown is not evidence either way, on the terms every other rule fails.
  assert.equal(matchesSettingRule(league({ settings: null }), isNever), false);
});

test("an absent type reads as redraft and an absent best_ball as false", () => {
  assert.equal(leagueType(league({ settings: {} })), 0);
  assert.equal(leagueType(league({ settings: { type: 2 } })), 2);
  // Junk is not a type; Sleeper's own absence is the fallback.
  assert.equal(leagueType(league({ settings: { type: "2" } })), 0);

  assert.equal(isBestBall(league({ settings: {} })), false);
  assert.equal(isBestBall(league({ settings: { best_ball: 1 } })), true);
  assert.equal(isBestBall(league({ settings: { best_ball: 0 } })), false);
});

test("the fixed filters select on type and format", () => {
  const dynasty = league({ settings: { type: 2 } });
  const redraft = league({ settings: {} });
  assert.equal(matchesFilters(dynasty, filters({ type: "2" })), true);
  assert.equal(matchesFilters(redraft, filters({ type: "2" })), false);
  assert.equal(matchesFilters(redraft, filters({ type: "0" })), true);

  const bestBall = league({ settings: { best_ball: 1 } });
  assert.equal(matchesFilters(bestBall, filters({ bestBall: "yes" })), true);
  assert.equal(matchesFilters(bestBall, filters({ bestBall: "no" })), false);
  // A league with no `best_ball` key is a lineup league, not an absent answer.
  assert.equal(matchesFilters(redraft, filters({ bestBall: "no" })), true);
});

test("every rule narrows — the lists are an AND", () => {
  const target = league({
    settings: { type: 2 },
    roster_positions: ["QB", "SUPER_FLEX", "BN"],
  });
  const both = filters({
    type: "2",
    slots: [{ key: "QB+SF", op: "gte", value: 2 }],
  });
  assert.equal(matchesFilters(target, both), true);

  // Failing either half fails the whole.
  assert.equal(
    matchesFilters(league({ settings: { type: 2 } }), both),
    false,
  );
  assert.equal(
    matchesFilters(
      league({ roster_positions: ["QB", "SUPER_FLEX", "BN"] }),
      both,
    ),
    false,
  );
});

test("the default selection admits everything, including an unsynced league", () => {
  const unsynced = league({
    roster_positions: null,
    settings: null,
    scoring_settings: null,
  });
  assert.equal(matchesFilters(unsynced, DEFAULT_LEAGUE_FILTERS), true);
});

test("the settings menu always offers teams and never type or best_ball", () => {
  const keys = settingKeyOptions([
    league({ settings: { type: 2, best_ball: 1, taxi_slots: 4 } }),
  ]);
  assert.ok(keys.includes("teams"));
  assert.ok(keys.includes("taxi_slots"));
  assert.equal(keys.includes("type"), false);
  assert.equal(keys.includes("best_ball"), false);

  // Only numbers: a rule is a comparison, so a string key could never evaluate.
  const withString = settingKeyOptions([
    league({ settings: { league_average_match: "1" } }),
  ]);
  assert.equal(withString.includes("league_average_match"), false);
});

test("the scoring menu is read off the data and ranked by the common keys", () => {
  const keys = scoringKeyOptions([
    league({ scoring_settings: { house_rule: 3, rec: 1, pass_td: 6 } }),
  ]);
  // Ranked keys lead in table order; an unranked house rule follows.
  assert.deepEqual(keys, ["rec", "pass_td", "house_rule"]);

  // With nothing to read, the dialog still has something to offer.
  assert.ok(scoringKeyOptions([]).includes("rec"));
});

test("a selection is counted, named and cleared off one walk", () => {
  const selection = filters({
    type: "2",
    settings: [{ key: "teams", op: "gte", value: 12 }],
    slots: [
      { key: "QB+SF", op: "gte", value: 2 },
      { key: "IDP", op: "gt", value: 0 },
    ],
  });

  // A rule counts as one, so four narrowings read as four.
  assert.equal(activeFilterCount(selection), 4);
  assert.equal(activeFilterCount(DEFAULT_LEAGUE_FILTERS), 0);
  assert.equal(filterSummary(DEFAULT_LEAGUE_FILTERS), "all leagues");
  assert.equal(
    filterSummary(selection),
    "dynasty · teams ≥ 12 · qb+sf ≥ 2 · idp > 0",
  );

  const active = activeFilters(selection);
  assert.equal(active.length, 4);
  // Everything counted is also addressable — the failure this one walk prevents.
  for (const entry of active) {
    assert.equal(activeFilterCount(clearFilter(selection, entry)), 3);
  }

  // A rule is cleared by position, and the right one goes.
  const withoutFirstSlot = clearFilter(
    selection,
    active.find((f) => f.kind === "slot" && f.index === 0)!,
  );
  assert.deepEqual(
    withoutFirstSlot.slots.map((r) => r.key),
    ["IDP"],
  );

  // A fixed filter returns to neutral rather than being deleted.
  assert.equal(
    clearFilter(selection, active.find((f) => f.kind === "fixed")!).type,
    "all",
  );
});

test("a named settings rule reads as a sentence rather than as digits", () => {
  assert.equal(
    filterSummary(
      filters({ settings: [{ key: "disable_trades", op: "eq", value: 1 }] }),
    ),
    "trades is disabled",
  );
  assert.equal(
    filterSummary(
      filters({
        settings: [
          { key: "trade_deadline", op: "eq", value: NO_TRADE_DEADLINE },
        ],
      }),
    ),
    "trade deadline is no deadline",
  );
  // A quantity keeps its comparison.
  assert.equal(
    filterSummary(
      filters({ settings: [{ key: "taxi_slots", op: "gt", value: 0 }] }),
    ),
    "taxi slots > 0",
  );
});

test("the breakdown counts each row as the filter that would produce it", () => {
  const rows = leagueBreakdown([
    league({
      settings: { type: 2 },
      roster_positions: ["QB", "SUPER_FLEX", "BN"],
    }),
    league({ settings: { type: 2, best_ball: 1 } }),
    league({ settings: {}, roster_positions: null }),
  ]);
  const count = (key: string) => rows.find((r) => r.key === key)?.count;
  assert.equal(count("dynasty"), 2);
  assert.equal(count("superflex"), 1);
  assert.equal(count("best_ball"), 1);
  // The unsynced lineup is not evidence of an IDP league, so it fails the row
  // the same way it fails the rule.
  assert.equal(count("idp"), 0);
});

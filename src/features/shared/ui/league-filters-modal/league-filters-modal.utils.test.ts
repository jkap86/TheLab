import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ActiveFilter, FilterRule } from "../../league-filters/index.ts";
import {
  appendRule,
  chipKey,
  hasRule,
  matchShare,
  parseRuleValue,
  removeRule,
  replaceRule,
  sameRule,
  selectedSegment,
  unlistedKey,
} from "./league-filters-modal.utils.ts";

/**
 * The decisions the dialog's markup used to make inline.
 *
 * Each of these was an expression inside JSX, reachable only by rendering the
 * component that held it — which is why the interesting cases below (a rule
 * addressed by position when an identical one sits beside it, a `<select>` whose
 * value isn't on its own menu, a numeric field mid-keystroke) had no test before
 * the split and are the ones most likely to be "simplified" into a bug.
 */

const rule = (over: Partial<FilterRule> = {}): FilterRule => ({
  key: "rec",
  op: "eq",
  value: 0.5,
  ...over,
});

describe("chipKey", () => {
  test("a fixed filter is addressed by its field", () => {
    const entry: ActiveFilter = {
      kind: "fixed",
      field: "bestBall",
      label: "best ball",
    };
    assert.equal(chipKey(entry), "fixed:bestBall");
  });

  test("two identical rules get distinguishable keys — the label can't", () => {
    const first: ActiveFilter = { kind: "slot", index: 0, label: "qb+sf ≥ 2" };
    const second: ActiveFilter = { kind: "slot", index: 1, label: "qb+sf ≥ 2" };
    assert.notEqual(chipKey(first), chipKey(second));
  });

  test("the two rule families can't collide at the same index", () => {
    assert.notEqual(
      chipKey({ kind: "slot", index: 0, label: "x" }),
      chipKey({ kind: "scoring", index: 0, label: "x" }),
    );
  });
});

describe("sameRule / hasRule", () => {
  test("all three fields count — a comparison is part of the question", () => {
    assert.ok(sameRule(rule(), rule()));
    assert.ok(!sameRule(rule(), rule({ op: "gte" })));
    assert.ok(!sameRule(rule(), rule({ value: 1 })));
    assert.ok(!sameRule(rule(), rule({ key: "bonus_rec_te" })));
  });

  test("a quick-add already on the list is found, one differing in op is not", () => {
    const rules = [rule(), rule({ key: "bonus_rec_te", op: "gt", value: 0 })];
    assert.ok(hasRule(rules, rule()));
    // The dimming rule: `rec ≥ 1` is a different question from `rec = 0.5`, so
    // the PPR preset stays live beside the Half PPR rule.
    assert.ok(!hasRule(rules, rule({ op: "gte", value: 1 })));
  });

  test("nothing is on an empty list", () => {
    assert.ok(!hasRule([], rule()));
  });
});

describe("the rule list writes", () => {
  test("append puts the new rule last and leaves the input alone", () => {
    const rules = [rule()];
    const next = appendRule(rules, rule({ key: "pass_yd" }));
    assert.deepEqual(next.map((r) => r.key), ["rec", "pass_yd"]);
    assert.equal(rules.length, 1);
  });

  test("replace swaps by position, not by identity", () => {
    // Two identical rules: "replace the matching one" has no answer, which is
    // why the row addresses its own index.
    const rules = [rule(), rule()];
    const next = replaceRule(rules, 1, rule({ value: 1 }));
    assert.deepEqual(next.map((r) => r.value), [0.5, 1]);
    assert.deepEqual(rules.map((r) => r.value), [0.5, 0.5]);
  });

  test("remove drops by position, leaving the twin behind", () => {
    const rules = [rule(), rule(), rule({ key: "pass_yd" })];
    const next = removeRule(rules, 0);
    assert.equal(next.length, 2);
    assert.deepEqual(next.map((r) => r.key), ["rec", "pass_yd"]);
  });

  test("an index off the end changes nothing", () => {
    const rules = [rule()];
    assert.deepEqual(replaceRule(rules, 5, rule({ value: 9 })), rules);
    assert.deepEqual(removeRule(rules, 5), rules);
  });
});

describe("unlistedKey", () => {
  const options = [
    { value: "rec", label: "rec" },
    { value: "pass_yd", label: "pass yd" },
  ];

  test("a key on the menu needs no entry of its own", () => {
    assert.equal(unlistedKey(options, "rec"), null);
  });

  test("a key nobody scores is handed back, so the select can't show another", () => {
    // The failure this prevents is silent: a `<select>` whose value is absent
    // from its options renders the first option instead, so the row would read
    // as filtering on `rec` while the rule says `bonus_rec_te`.
    assert.equal(unlistedKey(options, "bonus_rec_te"), "bonus_rec_te");
  });

  test("an empty menu — a cold load — makes every key unlisted", () => {
    assert.equal(unlistedKey([], "rec"), "rec");
  });
});

describe("selectedSegment", () => {
  const options = [
    { value: "all", label: "Any status" },
    { value: "pre_draft", label: "Pre-draft" },
    { value: "in_season", label: "In season" },
  ] as const;

  test("the first option is the unnarrowed one", () => {
    const picked = selectedSegment(options, "all");
    assert.equal(picked.index, 0);
    assert.equal(picked.selected?.label, "Any status");
    assert.equal(picked.narrowed, false);
  });

  test("any other option reads as narrowing", () => {
    const picked = selectedSegment(options, "in_season");
    assert.equal(picked.index, 2);
    assert.equal(picked.selected?.label, "In season");
    assert.equal(picked.narrowed, true);
  });

  test("a value off the table names the first option but still reads narrowed", () => {
    // The honest pair: the row can't name a value it has no label for, and must
    // not claim the list is unnarrowed when it isn't.
    const picked = selectedSegment(options, "bogus" as (typeof options)[number]["value"]);
    assert.equal(picked.index, 0);
    assert.equal(picked.selected?.label, "Any status");
    assert.equal(picked.narrowed, true);
  });

  test("an empty table has no label and nothing to be narrowed against", () => {
    const picked = selectedSegment([] as { value: string; label: string }[], "all");
    assert.equal(picked.selected, undefined);
    assert.equal(picked.narrowed, true);
  });
});

describe("matchShare", () => {
  test("a share of the account it came out of", () => {
    assert.equal(matchShare(17, 68), 0.25);
    assert.equal(matchShare(0, 12), 0);
    assert.equal(matchShare(12, 12), 1);
  });

  test("0 of 0 is not 0% — it is a question with no answer yet", () => {
    assert.equal(matchShare(0, 0), null);
  });
});

describe("parseRuleValue", () => {
  test("a number a keystroke actually means", () => {
    assert.equal(parseRuleValue("12"), 12);
    assert.equal(parseRuleValue("0"), 0);
    assert.equal(parseRuleValue("-0.5"), -0.5);
    assert.equal(parseRuleValue(" 2 "), 2);
  });

  test("a cleared field writes nothing — Number('') is 0 and that is wrong", () => {
    // Emptying the field to type `12` would otherwise snap the rule to 0 and
    // leave the reader typing `012`.
    assert.equal(parseRuleValue(""), null);
    assert.equal(parseRuleValue("   "), null);
  });

  test("a half-typed `0.` parses to 0, which narrows nothing", () => {
    // Deliberate: a rule at 0 lets everything through, where refusing the value
    // would leave the previous one standing and read as the filter matching
    // nothing.
    assert.equal(parseRuleValue("0."), 0);
    assert.equal(parseRuleValue("-"), null);
  });

  test("nothing non-finite reaches a rule", () => {
    assert.equal(parseRuleValue("abc"), null);
    assert.equal(parseRuleValue("Infinity"), null);
    assert.equal(parseRuleValue("1e999"), null);
  });
});

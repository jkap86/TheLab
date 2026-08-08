import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ActiveFilter, FilterRule } from "../../league-filters/index.ts";
import {
  appendRule,
  chipKey,
  hasRule,
  isBackdropPress,
  matchShare,
  parseRuleValue,
  removeRule,
  replaceRule,
  sameRule,
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

describe("whether a press dismissed the dialog", () => {
  // Stand-ins for the two elements identity is compared against; nothing here
  // reads a property off them.
  const dialog = { id: "dialog" };
  const inside = { id: "panel" };

  test("a press that began and ended on the backdrop closes it", () => {
    assert.equal(isBackdropPress(dialog, dialog, dialog), true);
  });

  test("a press inside the panel does not", () => {
    assert.equal(isBackdropPress(dialog, inside, inside), false);
  });

  test("a selection dragged out of the panel does not", () => {
    // The bug this exists for: `click` fires on the common ancestor of its two
    // ends, so selecting text in the panel and releasing past its edge reports
    // the dialog as the target — and used to close the modal, discarding the
    // draft mid-edit.
    assert.equal(isBackdropPress(dialog, inside, dialog), false);
  });

  test("a click with no press before it does not", () => {
    // Enter or Space on a control inside the panel: the recorded near end is
    // null, so the pair can never read as a backdrop press.
    assert.equal(isBackdropPress(dialog, null, dialog), false);
  });

  test("no dialog is no press, whatever the two ends agree on", () => {
    // Both ends are null before the ref is attached, and identity alone would
    // call that a match.
    assert.equal(isBackdropPress(null, null, null), false);
    assert.equal(isBackdropPress(undefined, undefined, undefined), false);
  });
});

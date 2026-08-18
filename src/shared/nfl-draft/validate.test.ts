import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NFL_DRAFT_MAX_SHRINK,
  NFL_DRAFT_MIN_DRAFTED_FRACTION,
  NFL_DRAFT_MIN_PICKS,
  validateNflDraftPicks,
} from "./validate.ts";

import type { NflDraftPick } from "./types.ts";

/** `count` picks, of which `draftedFraction` carry an overall pick. */
const picks = (count: number, draftedFraction = 0.6): NflDraftPick[] =>
  Array.from({ length: count }, (_, i) => {
    const isDrafted = i < Math.round(count * draftedFraction);
    return {
      playerId: String(i),
      season: "2020",
      round: isDrafted ? 1 : null,
      slot: isDrafted ? 1 : null,
      overall: isDrafted ? (i % 250) + 1 : null,
    };
  });

const ok = (result: ReturnType<typeof validateNflDraftPicks>) => {
  assert.ok(result.ok, `expected ok, got: ${result.ok ? "" : result.reason}`);
  return result;
};

const refused = (result: ReturnType<typeof validateNflDraftPicks>) => {
  assert.ok(!result.ok, "expected a refusal");
  return result;
};

describe("validateNflDraftPicks", () => {
  test("a healthy crosswalk passes and reports both halves", () => {
    const result = ok(validateNflDraftPicks(picks(6_000), 5_900));
    assert.equal(result.drafted + result.undrafted, 6_000);
    assert.ok(result.drafted > 0 && result.undrafted > 0);
  });

  test("an empty response is refused, never written", () => {
    assert.match(refused(validateNflDraftPicks([], 6_000)).reason, /no resolvable/);
  });

  test("a fragment below the floor is refused", () => {
    const result = refused(
      validateNflDraftPicks(picks(NFL_DRAFT_MIN_PICKS - 1), 6_000),
    );
    assert.match(result.reason, /below the .* minimum/);
  });

  /**
   * Zero stored is a first sync: there is nothing to shrink against, so only
   * the floor and the drafted-share check apply. Without this an empty database
   * could never bootstrap.
   */
  test("a first sync only has to clear the floor", () => {
    ok(validateNflDraftPicks(picks(NFL_DRAFT_MIN_PICKS), 0));
  });

  test("a response that shrank too far against the stored one is refused", () => {
    const stored = 6_000;
    const tooFew = Math.floor(stored * (1 - NFL_DRAFT_MAX_SHRINK)) - 1;
    assert.match(
      refused(validateNflDraftPicks(picks(tooFew), stored)).reason,
      /below the 6000 stored/,
    );
  });

  test("a shrink inside the allowance still passes", () => {
    const stored = 6_000;
    const justEnough = Math.ceil(stored * (1 - NFL_DRAFT_MAX_SHRINK)) + 1;
    ok(validateNflDraftPicks(picks(justEnough), stored));
  });

  /**
   * The check `ktc/validate` has no analogue of, and the one this source
   * needs. If the draft columns were emptied or renamed the parser would not
   * throw — it would decide no class had been held, hold back every undrafted
   * row as pending, and return a plausible-sized crosswalk of nothing but
   * unreadable rows. A count check alone passes that.
   */
  test("a crosswalk that lost its draft columns is refused on the drafted share", () => {
    const result = refused(validateNflDraftPicks(picks(6_000, 0), 5_900));
    assert.match(result.reason, /draft columns may have moved/);
  });

  test("the drafted-share threshold is applied at its stated fraction", () => {
    refused(
      validateNflDraftPicks(
        picks(6_000, NFL_DRAFT_MIN_DRAFTED_FRACTION - 0.05),
        5_900,
      ),
    );
    ok(
      validateNflDraftPicks(
        picks(6_000, NFL_DRAFT_MIN_DRAFTED_FRACTION + 0.05),
        5_900,
      ),
    );
  });

  test("a refusal reports the counts behind it, so the log can say why", () => {
    const result = refused(validateNflDraftPicks(picks(10), 6_000));
    assert.equal(result.valid, 10);
    assert.equal(result.previous, 6_000);
  });

  test("the returned picks are a copy, so a caller cannot edit the input", () => {
    const input = picks(NFL_DRAFT_MIN_PICKS);
    const result = ok(validateNflDraftPicks(input, 0));
    assert.notEqual(result.picks, input);
    assert.deepEqual(result.picks, input);
  });
});

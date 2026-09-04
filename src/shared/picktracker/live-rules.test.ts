import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  boardSignature,
  pollIntervalMs,
  DRAFTING_INTERVAL_MS,
  PRE_DRAFT_INTERVAL_MS,
} from "./live-rules.ts";

describe("pollIntervalMs", () => {
  test("stops entirely once the draft is complete", () => {
    assert.equal(pollIntervalMs("complete"), null);
  });

  test("slows down before the draft starts", () => {
    assert.equal(pollIntervalMs("pre_draft"), PRE_DRAFT_INTERVAL_MS);
  });

  test("polls a running draft at the fast cadence", () => {
    assert.equal(pollIntervalMs("drafting"), DRAFTING_INTERVAL_MS);
  });

  test("falls toward the fast cadence for a status it does not know", () => {
    // Sleeper's vocabulary is not exhaustively documented, and an extra
    // request is the failure you can see.
    assert.equal(pollIntervalMs("paused"), DRAFTING_INTERVAL_MS);
    assert.equal(pollIntervalMs(""), DRAFTING_INTERVAL_MS);
  });
});

describe("boardSignature", () => {
  const base = { draft_status: "drafting", last_picked: 1000, pickCount: 3 };

  test("is stable across ticks that changed nothing", () => {
    assert.equal(boardSignature(base), boardSignature({ ...base }));
  });

  test("moves when a pick lands", () => {
    assert.notEqual(
      boardSignature(base),
      boardSignature({ ...base, last_picked: 2000, pickCount: 4 }),
    );
  });

  test("moves when a draft completes without a new pick", () => {
    assert.notEqual(
      boardSignature(base),
      boardSignature({ ...base, draft_status: "complete" }),
    );
  });

  test("moves when a kicker lands on an unchanged edge", () => {
    // Defensive: the two halves are paired precisely so neither is trusted on
    // its own.
    assert.notEqual(
      boardSignature(base),
      boardSignature({ ...base, pickCount: 4 }),
    );
  });

  test("spells an unpicked draft rather than coercing it to zero", () => {
    // 0 is a real epoch; "nobody has picked" is not a time.
    assert.notEqual(
      boardSignature({ ...base, last_picked: null }),
      boardSignature({ ...base, last_picked: 0 }),
    );
  });
});

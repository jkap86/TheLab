import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_VISITOR_LOG_RETENTION_DAYS,
  PRUNE_VISITOR_LOGS_SQL,
  pruneContinues,
  RETENTION_BATCH,
  RETENTION_MAX_BATCHES_PER_TICK,
  retentionPolicy,
  VISITOR_LOG_RETENTION_VAR,
} from "./retention-plan.ts";

describe("retentionPolicy", () => {
  test("unset is ninety days", () => {
    assert.deepEqual(retentionPolicy({}), {
      enabled: true,
      days: DEFAULT_VISITOR_LOG_RETENTION_DAYS,
      retentionMs: 90 * 24 * 60 * 60_000,
    });
  });

  test("off is the deliberate archive", () => {
    const policy = retentionPolicy({ [VISITOR_LOG_RETENTION_VAR]: " OFF " });
    assert.equal(policy.enabled, false);
  });

  test("a number of days inside the bounds is read; junk falls back with a warning", () => {
    assert.equal((retentionPolicy({ [VISITOR_LOG_RETENTION_VAR]: "30" }) as { days: number }).days, 30);
    for (const junk of ["0", "-1", "abc", "1.5", "99999"]) {
      const policy = retentionPolicy({ [VISITOR_LOG_RETENTION_VAR]: junk });
      assert.equal(policy.enabled, true, junk);
      assert.equal((policy as { days: number }).days, DEFAULT_VISITOR_LOG_RETENTION_DAYS, junk);
      assert.match(policy.warning ?? "", /VISITOR_LOG_RETENTION_DAYS/, junk);
    }
  });
});

describe("the prune", () => {
  test("deletes by id from a bounded, oldest-first selection", () => {
    // A bare `DELETE … WHERE seen_at < …` over a never-pruned table is one
    // transaction the length of the backlog; the subquery is what bounds it.
    assert.match(PRUNE_VISITOR_LOGS_SQL, /DELETE FROM visitor_logs\s+WHERE id IN \(/);
    assert.match(PRUNE_VISITOR_LOGS_SQL, /WHERE seen_at < now\(\) - \$1::interval/);
    assert.match(PRUNE_VISITOR_LOGS_SQL, /ORDER BY seen_at ASC, id ASC\s+LIMIT \$2/);
  });

  test("a tick continues only on a full batch and inside its budget", () => {
    assert.equal(pruneContinues(0, RETENTION_BATCH), true);
    assert.equal(pruneContinues(1, RETENTION_BATCH - 1), false);
    assert.equal(pruneContinues(RETENTION_MAX_BATCHES_PER_TICK, RETENTION_BATCH), false);
    assert.equal(pruneContinues(RETENTION_MAX_BATCHES_PER_TICK - 1, RETENTION_BATCH), true);
    assert.equal(pruneContinues(3, 0), false);
  });
});

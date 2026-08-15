import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ARCHIVE_EMPTY_CONFIRMATIONS,
  ARCHIVE_EMPTY_RETRY_MS,
  archiveStampFreshSql,
  archiveStampIsFresh,
} from "./archive-clock.ts";

/**
 * The archive tier's clock. Its original promise — one probe per historical
 * week, ever — is what makes backfilling down to the year 2000 affordable, and
 * it read "successful but empty" as proof the feed has no such week. It isn't:
 * one bad minute upstream during the initial backfill retired a week that had
 * real data, permanently and invisibly.
 */

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const stamp = (emptyObservations: number, agoMs: number) => ({
  emptyObservations,
  syncedAtMs: NOW - agoMs,
});

describe("archiveStampIsFresh", () => {
  test("a week never fetched is always due", () => {
    assert.equal(archiveStampIsFresh(null, NOW), false);
  });

  test("a week that stored rows is retired at once and for good", () => {
    // The archive's whole point: a years-old week's numbers never move again,
    // so one successful fetch is the last one.
    assert.equal(archiveStampIsFresh(stamp(0, 0), NOW), true);
    assert.equal(archiveStampIsFresh(stamp(0, 10 * 365 * 24 * HOUR), NOW), true);
  });

  test("a first empty answer is retryable, not proof of anything", () => {
    // The regression. One empty used to retire the week forever.
    assert.equal(archiveStampIsFresh(stamp(1, ARCHIVE_EMPTY_RETRY_MS + 1), NOW), false);
  });

  test("but not immediately — the confirming probe is a day out", () => {
    // Two ticks are five minutes apart, well inside a single upstream
    // incident, so confirming that fast makes the second observation a copy of
    // the first rather than a second opinion.
    assert.equal(archiveStampIsFresh(stamp(1, 0), NOW), true);
    assert.equal(archiveStampIsFresh(stamp(1, HOUR), NOW), true);
    assert.equal(archiveStampIsFresh(stamp(1, ARCHIVE_EMPTY_RETRY_MS - 1), NOW), true);
  });

  test("a confirmed empty is retired for good — no endless retry", () => {
    const confirmed = stamp(ARCHIVE_EMPTY_CONFIRMATIONS, ARCHIVE_EMPTY_RETRY_MS * 400);
    assert.equal(archiveStampIsFresh(confirmed, NOW), true);
    // And beyond the threshold too, in case a count ever runs on.
    assert.equal(
      archiveStampIsFresh(stamp(ARCHIVE_EMPTY_CONFIRMATIONS + 5, ARCHIVE_EMPTY_RETRY_MS * 400), NOW),
      true,
    );
  });

  test("a dead week's lifetime cost is bounded, and it is two probes", () => {
    // Walked as the sync walks it: probe, empty, wait, probe, empty, done.
    let observations = 0;
    let syncedAtMs = 0;
    let probes = 0;
    let clock = NOW;
    let stored: { emptyObservations: number; syncedAtMs: number } | null = null;

    for (let tick = 0; tick < 500; tick += 1) {
      clock += HOUR;
      if (archiveStampIsFresh(stored, clock)) continue;
      probes += 1;
      observations = Math.min(observations + 1, ARCHIVE_EMPTY_CONFIRMATIONS);
      syncedAtMs = clock;
      stored = { emptyObservations: observations, syncedAtMs };
    }
    assert.equal(probes, ARCHIVE_EMPTY_CONFIRMATIONS);
  });

  test("a transient empty followed by real data recovers and then retires", () => {
    // The case the whole change is for: the second probe finds the week, the
    // count resets to 0, and the week is retired as a *stored* week.
    const afterBlip = stamp(1, ARCHIVE_EMPTY_RETRY_MS + HOUR);
    assert.equal(archiveStampIsFresh(afterBlip, NOW), false, "due for its retry");
    // …the retry stores rows, so the count resets.
    assert.equal(archiveStampIsFresh(stamp(0, 0), NOW), true);
  });

  test("the thresholds are overridable, so the rule is testable without waiting", () => {
    assert.equal(
      archiveStampIsFresh(stamp(1, 2 * HOUR), NOW, { retryMs: HOUR }),
      false,
    );
    assert.equal(
      archiveStampIsFresh(stamp(1, 2 * HOUR), NOW, { confirmations: 1 }),
      true,
    );
  });

  test("the bounds are what the note claims: two observations, a day apart", () => {
    assert.equal(ARCHIVE_EMPTY_CONFIRMATIONS, 2);
    assert.equal(ARCHIVE_EMPTY_RETRY_MS, 24 * 60 * 60 * 1000);
  });
});

describe("archiveStampFreshSql", () => {
  test("names the same three clauses the predicate branches on", () => {
    // A matched pair with no compiler link between them: `staleTargets` runs
    // the SQL and the tests drive the predicate, so a change to one that isn't
    // made to the other would be a clock that only misbehaves in production.
    const sql = archiveStampFreshSql("$3", "$4");
    assert.match(sql, /s\.empty_observations <= 0/, "stored rows are final");
    assert.match(sql, /s\.empty_observations >= \$3/, "confirmed empties retire");
    assert.match(sql, /s\.synced_at > now\(\) - \$4::interval/, "and the retry wait");
    // Any one of the three is enough — the clauses are OR'd, not AND'd.
    assert.equal(sql.split(/\bOR\b/).length - 1, 2);
  });

  test("every value is a bound parameter, never spliced", () => {
    const sql = archiveStampFreshSql("$3", "$4");
    assert.ok(!sql.includes(String(ARCHIVE_EMPTY_CONFIRMATIONS)));
    assert.ok(!sql.includes(String(ARCHIVE_EMPTY_RETRY_MS)));
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ACTIVE_LEAGUE_STATUSES,
  CRAWL_PRIORITY,
  DEMAND_WINDOW_MS,
  STARVATION_MULTIPLE,
  compareLeagueRefresh,
  leagueRefreshPriority,
  staleLeagueClaimSql,
  starvationMs,
} from "./crawl-priority.ts";
import type { CrawlCandidate } from "./crawl-priority.ts";

/**
 * The order the refresh queue runs in.
 *
 * Two failures are being guarded against and they pull in opposite directions.
 * Strict oldest-first — what this replaces — treats the league a reader has open
 * and one discovered three hops out through a stranger identically, which stops
 * being tenable the moment a full rotation outruns the freshness TTL. Pure
 * demand-first has the opposite failure and a quieter one: the cold tail is
 * never revisited, and nobody notices, because the leagues that stopped being
 * crawled are exactly the ones nobody is looking at. The starvation bound is
 * what makes the second impossible, and it is the assertion below that matters
 * most.
 *
 * The SQL is generated from the same table, so the last group pins the agreement
 * a type cannot carry: the arms the database orders by are the arms this
 * function checks, in the same order.
 */

const HOUR = 60 * 60 * 1000;
const now = 1_700_000_000_000;
const ttlMs = 15 * 60 * 1000;
const clock = { now, ttlMs };

const league = (over: Partial<CrawlCandidate> = {}): CrawlCandidate => ({
  // Due, but not remotely starved.
  updatedAt: now - ttlMs * 2,
  lastAccessedAt: null,
  status: "complete",
  syncAttemptAt: now - ttlMs * 2,
  ...over,
});

describe("leagueRefreshPriority", () => {
  test("a league nobody has asked for is the coldest tier", () => {
    assert.equal(leagueRefreshPriority(league(), clock), CRAWL_PRIORITY.cold);
  });

  test("a recently read league is demanded", () => {
    assert.equal(
      leagueRefreshPriority(
        league({ lastAccessedAt: now - 60_000 }),
        clock,
      ),
      CRAWL_PRIORITY.demanded,
    );
  });

  test("demand expires rather than being permanent", () => {
    // Yesterday's browsing must not outrank a league somebody is reading now.
    assert.equal(
      leagueRefreshPriority(
        league({ lastAccessedAt: now - DEMAND_WINDOW_MS - 1 }),
        clock,
      ),
      CRAWL_PRIORITY.known,
    );
  });

  test("a live league outranks a finished one", () => {
    for (const status of ACTIVE_LEAGUE_STATUSES) {
      assert.equal(
        leagueRefreshPriority(league({ status }), clock),
        CRAWL_PRIORITY.active,
        status,
      );
    }
    // `pre_draft` deliberately isn't live: it is the commonest offseason status,
    // so counting it would make the tier mean nothing.
    assert.equal(
      leagueRefreshPriority(league({ status: "pre_draft" }), clock),
      CRAWL_PRIORITY.cold,
    );
  });

  test("starvation outranks everything, including demand", () => {
    const starved = league({
      updatedAt: now - starvationMs(ttlMs) - 1,
      lastAccessedAt: now,
      status: "in_season",
    });
    assert.equal(leagueRefreshPriority(starved, clock), CRAWL_PRIORITY.starved);
  });

  test("the starvation bound is past the point the scheduler already warns at", () => {
    // The scheduler warns at twice the TTL, which is a state the whole queue
    // enters at once — and a tier every league is in is not a tier.
    assert.ok(STARVATION_MULTIPLE > 2);
  });

  test("the tiers are distinct and ordered best-first", () => {
    const values = Object.values(CRAWL_PRIORITY);
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual([...values].sort((a, b) => a - b), values);
  });
});

describe("compareLeagueRefresh", () => {
  /** Sort as the claim query would, and report the ids in the order taken. */
  const claim = (
    leagues: (CrawlCandidate & { id: string })[],
    limit = leagues.length,
  ) =>
    [...leagues]
      .sort((a, b) => compareLeagueRefresh(a, b, clock))
      .slice(0, limit)
      .map((l) => l.id);

  test("a hot league is taken before an equally stale cold one", () => {
    const stale = now - ttlMs * 2;
    assert.deepEqual(
      claim([
        { id: "cold", ...league({ updatedAt: stale, syncAttemptAt: stale }) },
        {
          id: "hot",
          ...league({
            updatedAt: stale,
            syncAttemptAt: stale,
            lastAccessedAt: now - 60_000,
          }),
        },
      ]),
      ["hot", "cold"],
    );
  });

  test("a very stale cold league eventually wins over newer hot ones", () => {
    // The whole point of the starvation tier: the cold tail cannot be deferred
    // forever by a database that always has something hot in it.
    assert.deepEqual(
      claim([
        { id: "hot", ...league({ lastAccessedAt: now - 1000 }) },
        {
          id: "forgotten",
          ...league({
            updatedAt: now - starvationMs(ttlMs) - HOUR,
            syncAttemptAt: now - starvationMs(ttlMs) - HOUR,
          }),
        },
      ]),
      ["forgotten", "hot"],
    );
  });

  test("nothing starves: a cold league reaches the front by waiting", () => {
    // Run the queue forward: hot leagues keep arriving, the cold one is never
    // touched, and its age keeps growing. It must be claimed within a bounded
    // number of rotations rather than never.
    const cold = league({ updatedAt: now - ttlMs, syncAttemptAt: now - ttlMs });
    let taken = false;
    for (let elapsed = 0; elapsed <= starvationMs(ttlMs) + ttlMs; elapsed += ttlMs) {
      const at = { now: now + elapsed, ttlMs };
      const hot = league({
        updatedAt: now + elapsed - ttlMs,
        syncAttemptAt: now + elapsed - ttlMs,
        lastAccessedAt: now + elapsed,
      });
      if (compareLeagueRefresh(cold, hot, at) < 0) {
        taken = true;
        break;
      }
    }
    assert.ok(taken, "a cold league never reached the front of the queue");
  });

  test("within a tier the longest-untried goes first", () => {
    // The tiebreaker keeps its old meaning: a league whose fetch keeps failing
    // rotates to the back of its own tier rather than being retried every tick.
    assert.deepEqual(
      claim([
        { id: "recent", ...league({ syncAttemptAt: now - HOUR }) },
        { id: "never", ...league({ syncAttemptAt: null }) },
        { id: "old", ...league({ syncAttemptAt: now - 5 * HOUR }) },
      ]),
      ["never", "old", "recent"],
    );
  });

  test("a starved backlog drains oldest-first", () => {
    const starvedAt = (age: number) =>
      league({
        updatedAt: now - starvationMs(ttlMs) - age,
        syncAttemptAt: now - starvationMs(ttlMs) - age,
      });
    assert.deepEqual(
      claim([
        { id: "b", ...starvedAt(HOUR) },
        { id: "a", ...starvedAt(5 * HOUR) },
        { id: "c", ...starvedAt(1) },
      ]),
      ["a", "b", "c"],
    );
  });

  test("the batch limit still bounds what one tick takes", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `L${i}`,
      ...league({ syncAttemptAt: now - i * HOUR }),
    }));
    assert.equal(claim(many, 15).length, 15);
  });
});

describe("staleLeagueClaimSql", () => {
  const sql = staleLeagueClaimSql();

  test("claims and stamps in one statement", () => {
    // Two ticks — or two instances behind the crawl's advisory lock — must never
    // be able to pick the same leagues, which is what makes this one `UPDATE`
    // rather than a select followed by a write.
    assert.match(sql, /^UPDATE leagues\s+SET sync_attempt_at = now\(\)/);
    assert.match(sql, /RETURNING league_id$/);
    assert.equal(sql.match(/\bSELECT\b/g)?.length, 1);
  });

  test("still skips tombstoned leagues and still bounds the batch", () => {
    assert.match(sql, /gone_at IS NULL/);
    assert.match(sql, /LIMIT \$5/);
  });

  test("every value is bound, none is spliced", () => {
    // The status list is the only interpolation and it is this module's own
    // constant, never a caller's — so the check is that nothing else looks like
    // a literal comparison.
    const bound = sql.match(/\$\d/g) ?? [];
    assert.deepEqual([...new Set(bound)].sort(), ["$1", "$2", "$3", "$4", "$5"]);
    for (const status of ACTIVE_LEAGUE_STATUSES) {
      assert.ok(sql.includes(`'${status}'`), status);
    }
  });

  test("the CASE arms are the same tiers, in the same order", () => {
    // The pure function and the SQL are a matched pair with no compiler link:
    // an arm added to one and not the other is a queue that orders differently
    // from everything reasoned about here, and it fails silently.
    const arms = [...sql.matchAll(/THEN (\d)/g)].map((m) => Number(m[1]));
    const fallback = Number(sql.match(/ELSE (\d)/)?.[1]);
    assert.deepEqual(
      [...arms, fallback],
      [
        CRAWL_PRIORITY.starved,
        CRAWL_PRIORITY.demanded,
        CRAWL_PRIORITY.active,
        CRAWL_PRIORITY.known,
        CRAWL_PRIORITY.cold,
      ],
    );
  });

  test("the tiebreaker is the column the un-prioritised queue used", () => {
    assert.match(sql, /sync_attempt_at ASC NULLS FIRST/);
    // And it comes *after* the tier, or the priority does nothing at all.
    assert.ok(sql.indexOf("END,") < sql.indexOf("sync_attempt_at ASC"));
  });
});

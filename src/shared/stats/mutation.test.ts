import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";
import {
  notifyStatsSeasonWritten,
  onStatsSeasonWritten,
  resetStatsSeasonListeners,
} from "./mutation.ts";

/**
 * The one signal that can shorten a season's cache lifetime without shortening
 * its TTL.
 *
 * A finished season's comps entries are held for a day, which is right for
 * numbers that don't move and wrong for the moment they do — an archive week
 * re-probed with rows, a refused payload the next tick accepts, a backfill
 * reaching a season for the first time. These tests are about the mechanism;
 * `comps/pool.ts` is what registers against it, pinned in `comps/pool.test.ts`.
 */

afterEach(() => resetStatsSeasonListeners());

describe("onStatsSeasonWritten", () => {
  test("every listener hears the season that was written", () => {
    const heard: string[] = [];
    onStatsSeasonWritten((season) => heard.push(`a:${season}`));
    onStatsSeasonWritten((season) => heard.push(`b:${season}`));

    notifyStatsSeasonWritten("2019");
    assert.deepEqual(heard, ["a:2019", "b:2019"]);
  });

  test("registering the same function twice is once", () => {
    // Registration happens at module load, so dev's module reloading must not
    // stack listeners — the set is keyed by identity, which is what makes that
    // safe without a guard at the call site.
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    onStatsSeasonWritten(listener);
    onStatsSeasonWritten(listener);

    notifyStatsSeasonWritten("2024");
    assert.equal(calls, 1);
  });

  test("unsubscribing stops the notifications", () => {
    let calls = 0;
    const off = onStatsSeasonWritten(() => {
      calls += 1;
    });
    notifyStatsSeasonWritten("2024");
    off();
    notifyStatsSeasonWritten("2024");
    assert.equal(calls, 1);
  });

  test("a listener that throws does not fail the sync", () => {
    // This is a cache invalidation announced *after* a committed write. Failing
    // the tick over it would turn a stale cache into a lost week — and the
    // listeners after it must still hear.
    const heard: string[] = [];
    onStatsSeasonWritten(() => {
      throw new Error("cache exploded");
    });
    onStatsSeasonWritten((season) => heard.push(season));

    assert.doesNotThrow(() => notifyStatsSeasonWritten("2025"));
    assert.deepEqual(heard, ["2025"]);
  });

  test("nobody listening is not an error", () => {
    assert.doesNotThrow(() => notifyStatsSeasonWritten("2025"));
  });
});

describe("what a listener buys the reader that registers one", () => {
  test("an entry held for a day is reloaded the moment the season changes", async () => {
    // The production shape: a cache entry on the archive clock, a write to that
    // season, and a reader that must see the correction on its next request
    // rather than a day later.
    const cache = new TtlPromiseCache<{ rows: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test-comps-pool",
    });
    let rows = 1;
    const read = (season: string) =>
      cache.read(season, async () => ({ rows }), {
        ttlMs: 24 * 60 * 60 * 1000,
      });

    onStatsSeasonWritten((season) => cache.forget(season));

    assert.deepEqual(await read("2019"), { rows: 1 });
    rows = 2;
    assert.deepEqual(await read("2019"), { rows: 1 }, "still the day-long entry");

    notifyStatsSeasonWritten("2019");
    assert.deepEqual(await read("2019"), { rows: 2 }, "the correction is visible");
  });

  test("a season nobody wrote keeps its entry", () => {
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test-comps-pool",
    });
    onStatsSeasonWritten((season) => cache.forget(season));

    return cache.read("2019", async () => ({ n: 1 })).then(() => {
      notifyStatsSeasonWritten("2024");
      assert.deepEqual(cache.peek("2019"), { n: 1 });
    });
  });
});

describe("the sync announces it", () => {
  /**
   * `./sync.ts` opens a pool, so it cannot be imported here — the bar every
   * tested module in this package keeps. Pinned against the source instead,
   * because the failure of losing this call is silence: the corrections still
   * land in Postgres and every reader keeps serving what it had.
   */
  const source = readFileSync(
    fileURLToPath(new URL("./sync.ts", import.meta.url)),
    "utf8",
  );

  test("after the write, never before it", () => {
    // The `persistLeagueGraph` rule: a reader invalidating before the rows land
    // would cache exactly the rows the write is replacing.
    const write = source.indexOf("await writeWeek(");
    const notify = source.indexOf("notifyStatsSeasonWritten(");
    assert.ok(write !== -1, "writeWeek is not called — was it renamed?");
    assert.ok(notify > write, "the announcement must follow the write");
  });

  test("a refused or empty payload announces nothing", () => {
    // Neither wrote a row, so neither has anything to invalidate — and an
    // announcement there would drop a good cache entry every archive tick.
    assert.equal(source.split("notifyStatsSeasonWritten(").length - 1, 1);
  });
});

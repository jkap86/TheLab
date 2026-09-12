import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  acquireManagerLeagues,
  clearManagerLeagues,
  managerLeaguesCacheSize,
  managerLeaguesKey,
  MAX_ENTRIES,
  peekManagerLeagues,
  PENDING,
  type ManagerLeaguesStream,
} from "./manager-leagues-cache.ts";

/**
 * The store behind every page that lists a manager's leagues, driven without
 * React.
 *
 * **What it replaces is a per-hook `useState`,** and the reason is one sentence:
 * `/manager`, `/lineupchecker` and `/gametime` list the same leagues, so a
 * reader walking between them opened the same ~519KB stream three times and
 * watched the page they had just been reading blank and fill in again. Every
 * rule below is a way that could come back while still rendering perfectly,
 * which is why they are asserted here rather than looked at on a page.
 */

/** A stream runner the test drives by hand. */
function runner(): {
  run: ManagerLeaguesStream;
  calls: number;
  signals: AbortSignal[];
  commits: Parameters<ManagerLeaguesStream>[1][];
  finish: () => void;
} {
  const state = {
    calls: 0,
    signals: [] as AbortSignal[],
    commits: [] as Parameters<ManagerLeaguesStream>[1][],
    resolve: null as (() => void) | null,
  };
  return {
    run: (signal, commit) => {
      state.calls += 1;
      state.signals.push(signal);
      state.commits.push(commit);
      return new Promise<void>((resolve) => {
        state.resolve = resolve;
      });
    },
    get calls() {
      return state.calls;
    },
    get signals() {
      return state.signals;
    },
    get commits() {
      return state.commits;
    },
    finish: () => state.resolve?.(),
  };
}

const SERVED = {
  ...PENDING,
  leagues: [{ league_id: "L1" }] as never,
  refreshing: false,
};
const FAILED = { ...PENDING, refreshing: false, error: "nope" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => clearManagerLeagues());

describe("managerLeaguesKey", () => {
  test("both halves of the subject are in it", () => {
    assert.notEqual(
      managerLeaguesKey("slim", "2024"),
      managerLeaguesKey("slim", "2025"),
    );
    assert.notEqual(managerLeaguesKey("slim"), managerLeaguesKey("jim"));
  });

  test("an unset season is not the same question as a spelled one", () => {
    // The route resolves the active season for the first and is told it for the
    // second. Folding them together would serve a `?season=`-pinned answer to a
    // page that asked for "now", which is a wrong year rather than a stale one.
    assert.notEqual(managerLeaguesKey("slim"), managerLeaguesKey("slim", "2026"));
  });

  test("no pair of subjects can spell one key", () => {
    // The separator cannot occur in either half, so a username ending in the
    // season's first character cannot collide with the next season along.
    assert.notEqual(
      managerLeaguesKey("slim2", "026"),
      managerLeaguesKey("slim", "2026"),
    );
  });
});

describe("acquireManagerLeagues", () => {
  test("a second reader of a held key makes no request", () => {
    // The whole point: a second tool listing the same leagues reads what the
    // first one got.
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const a = acquireManagerLeagues(key, stream.run, () => {});
    const b = acquireManagerLeagues(key, stream.run, () => {});
    assert.equal(stream.calls, 1);
    a();
    b();
  });

  test("every reader is told when the stream moves", () => {
    const stream = runner();
    let a = 0;
    let b = 0;
    const key = managerLeaguesKey("slim");
    const releaseA = acquireManagerLeagues(key, stream.run, () => (a += 1));
    const releaseB = acquireManagerLeagues(key, stream.run, () => (b += 1));
    stream.commits[0](SERVED);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.deepEqual(peekManagerLeagues(key), SERVED);
    releaseA();
    releaseB();
  });

  test("a different subject runs its own stream", () => {
    const stream = runner();
    const a = acquireManagerLeagues(
      managerLeaguesKey("slim"),
      stream.run,
      () => {},
    );
    const b = acquireManagerLeagues(
      managerLeaguesKey("jim"),
      stream.run,
      () => {},
    );
    assert.equal(stream.calls, 2);
    a();
    b();
  });

  test("a key nothing has asked about reads as pending, not as empty", () => {
    // "No answer yet" and "no leagues" are different claims, and the second is
    // what the page renders as "No leagues found".
    assert.equal(peekManagerLeagues(managerLeaguesKey("nobody")), PENDING);
    assert.equal(peekManagerLeagues(managerLeaguesKey("nobody")).refreshing, true);
  });
});

describe("the entry outlives its readers", () => {
  test("a resolved answer survives the last reader and costs nothing to re-read", async () => {
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const release = acquireManagerLeagues(key, stream.run, () => {});
    stream.commits[0](SERVED);
    stream.finish();
    await flush();
    release();

    assert.deepEqual(peekManagerLeagues(key), SERVED);
    const again = acquireManagerLeagues(key, stream.run, () => {});
    assert.equal(stream.calls, 1, "the second tool asked again");
    again();
  });

  test("an in-flight stream survives the beat between two tools", async () => {
    // **The load-bearing one.** A client-side navigation unmounts the old page
    // before the new page's effect runs, so there is a moment with no
    // subscriber — and a store that dropped in-flight entries there would
    // restart the stream on every tool change during a cold sync, which is
    // exactly the case this exists to remove.
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const release = acquireManagerLeagues(key, stream.run, () => {});

    release();
    await flush();
    assert.equal(stream.signals[0].aborted, false, "the stream was cancelled");

    let seen = PENDING;
    const again = acquireManagerLeagues(key, stream.run, () => {
      seen = peekManagerLeagues(key);
    });
    assert.equal(stream.calls, 1, "the stream was restarted");

    // And the new reader is picked up mid-flight: progress from the stream the
    // *previous* page opened lands on the page that is on screen now.
    stream.commits[0]({ ...PENDING, progress: { loaded: 4, total: 9, failed: 0 } });
    assert.deepEqual(seen.progress, { loaded: 4, total: 9, failed: 0 });
    again();
  });

  test("a failure with nothing to show goes with its last reader", async () => {
    // Kept, it would make the one thing anybody would try — opening the tool
    // again — a no-op for the life of the page.
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const release = acquireManagerLeagues(key, stream.run, () => {});
    stream.commits[0](FAILED);
    stream.finish();
    await flush();
    release();

    assert.equal(managerLeaguesCacheSize(), 0);
    const again = acquireManagerLeagues(key, stream.run, () => {});
    assert.equal(stream.calls, 2, "the retry was not reachable");
    again();
  });

  test("a failure behind a served list is kept, because it can still serve", async () => {
    // `refreshError` beside leagues is a note on a usable page, not a dead end.
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const release = acquireManagerLeagues(key, stream.run, () => {});
    stream.commits[0]({ ...SERVED, stale: true, refreshError: "upstream" });
    stream.finish();
    await flush();
    release();

    assert.equal(managerLeaguesCacheSize(), 1);
    const again = acquireManagerLeagues(key, stream.run, () => {});
    assert.equal(stream.calls, 1);
    again();
  });

  test("a second reader does not restart a held failure", () => {
    // A second tool is a second reader, not a fresh attempt — otherwise the
    // request-per-mount this store removes comes back one state over.
    const stream = runner();
    const key = managerLeaguesKey("slim");
    const a = acquireManagerLeagues(key, stream.run, () => {});
    stream.commits[0](FAILED);
    const b = acquireManagerLeagues(key, stream.run, () => {});
    assert.equal(stream.calls, 1);
    a();
    b();
  });
});

describe("the bound", () => {
  test("entries nothing is reading are evicted oldest first", async () => {
    const streams = [runner(), runner(), runner()];
    const keys = ["a", "b", "c"].map((u) => managerLeaguesKey(u));
    for (const [i, key] of keys.entries()) {
      const release = acquireManagerLeagues(key, streams[i].run, () => {});
      streams[i].commits[0](SERVED);
      streams[i].finish();
      await flush();
      release();
    }

    assert.equal(managerLeaguesCacheSize(), MAX_ENTRIES);
    assert.equal(peekManagerLeagues(keys[0]), PENDING, "the oldest was kept");
    assert.deepEqual(peekManagerLeagues(keys[2]), SERVED);
  });

  test("evicting an in-flight entry aborts it", async () => {
    // The release deliberately does not abort, so this is the only thing that
    // bounds how many abandoned streams a reader walking between accounts can
    // leave open.
    const streams = [runner(), runner(), runner()];
    const keys = ["a", "b", "c"].map((u) => managerLeaguesKey(u));
    for (const [i, key] of keys.entries()) {
      acquireManagerLeagues(key, streams[i].run, () => {})();
      await flush();
    }

    assert.equal(streams[0].signals[0].aborted, true);
    assert.equal(streams[2].signals[0].aborted, false);
  });

  test("a subscribed entry is neither evicted nor counted against the bound", async () => {
    // Counted, a reader with a page open would be handed a smaller cache than
    // one without — and the page they are looking at could be evicted out from
    // under them.
    const open = runner();
    const openKey = managerLeaguesKey("open");
    const held = acquireManagerLeagues(openKey, open.run, () => {});
    open.commits[0](SERVED);
    open.finish();
    await flush();

    const streams = [runner(), runner()];
    const keys = ["a", "b"].map((u) => managerLeaguesKey(u));
    for (const [i, key] of keys.entries()) {
      const release = acquireManagerLeagues(key, streams[i].run, () => {});
      streams[i].commits[0](SERVED);
      streams[i].finish();
      await flush();
      release();
    }

    assert.equal(managerLeaguesCacheSize(), MAX_ENTRIES + 1);
    assert.deepEqual(peekManagerLeagues(openKey), SERVED);
    for (const key of keys) assert.deepEqual(peekManagerLeagues(key), SERVED);
    held();
  });

  test("the account just navigated away from is not the first evicted", async () => {
    // `at` is otherwise the last *write*, so an entry read for ten minutes and
    // one written ten minutes ago and never looked at again sort identically.
    const streams = [runner(), runner(), runner()];
    const keys = ["a", "b", "c"].map((u) => managerLeaguesKey(u));
    const releases = keys.map((key, i) => {
      const release = acquireManagerLeagues(key, streams[i].run, () => {});
      streams[i].commits[0](SERVED);
      streams[i].finish();
      return release;
    });
    await flush();

    // Written oldest-first, then left in the reverse order: the one let go last
    // is the one a reader has just come from.
    releases[0]();
    releases[1]();
    releases[2]();

    assert.equal(peekManagerLeagues(keys[0]), PENDING, "the oldest was kept");
    assert.deepEqual(peekManagerLeagues(keys[2]), SERVED, "the newest went");
  });

  test("a commit from an evicted stream is ignored", async () => {
    const streams = [runner(), runner(), runner()];
    const keys = ["a", "b", "c"].map((u) => managerLeaguesKey(u));
    for (const [i, key] of keys.entries()) {
      acquireManagerLeagues(key, streams[i].run, () => {})();
      await flush();
    }

    // The evicted entry's runner has not noticed its abort yet.
    streams[0].commits[0](SERVED);
    assert.equal(managerLeaguesCacheSize(), MAX_ENTRIES);
    assert.equal(peekManagerLeagues(keys[0]), PENDING);
  });
});

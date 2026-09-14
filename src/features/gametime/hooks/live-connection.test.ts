import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";

import type { GametimeConnection } from "../helpers/connection.ts";
import {
  followGametime,
  NO_WEEK,
  RETRY_AFTER_MAX_MS,
  RETRY_BASE_MS,
  RETRY_JITTER_MS,
  RETRY_MAX_MS,
  SNAPSHOT_COOLDOWN_MS,
  SOURCE_CLOSED,
} from "./live-connection.ts";
import type { LiveEnv, LiveSink, LiveSource, LiveTimer } from "./live-connection.ts";

/**
 * The stream controller driven with a scripted `EventSource`, a scripted
 * `fetch` and scripted timers — the three races this file exists for are all
 * about *when* things land, and none of them shows in source text.
 */

const SUBJECT = { username: "slim", season: "2026", week: 3 };

/** A payload naming its leagues, so what the page holds is legible in an assertion. */
function payload(tag: string, leagues: Record<string, unknown>): ManagerGametimePayload {
  return {
    season: "2026",
    week: 3,
    projections: "ok",
    stats: "ok",
    scores: "ok",
    read_at: 0,
    games: { pre: 0, live: 1, final: 0 },
    board: {},
    players: {},
    leagues: { ...leagues, tag: { tag } as never },
  } as unknown as ManagerGametimePayload;
}

const leagueTag = (held: ManagerGametimePayload | null) =>
  (held?.leagues.tag as unknown as { tag: string } | undefined)?.tag ?? null;

/** One scripted `EventSource`. */
class FakeSource implements LiveSource {
  readyState = 0;
  onopen: EventSource["onopen"] = null;
  onmessage: EventSource["onmessage"] = null;
  onerror: EventSource["onerror"] = null;
  closed = false;
  readonly url: string;

  // Assigned rather than declared in the signature: Node's strip-only mode
  // cannot parse a parameter property — `BoundedCache`'s own finding.
  constructor(url: string) {
    this.url = url;
  }

  close() {
    this.closed = true;
    this.readyState = SOURCE_CLOSED;
  }

  /** The transport connected — no data yet. */
  open() {
    this.readyState = 1;
    this.onopen?.call(this as unknown as EventSource, new Event("open"));
  }

  send(message: GametimeStreamMessage) {
    this.onmessage?.call(
      this as unknown as EventSource,
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  /** The browser gave up for good — a bad status, a wrong content type. */
  fail() {
    this.readyState = SOURCE_CLOSED;
    this.onerror?.call(this as unknown as EventSource, new Event("error"));
  }

  /** The socket dropped and the browser is reconnecting on its own. */
  drop() {
    this.readyState = 0;
    this.onerror?.call(this as unknown as EventSource, new Event("error"));
  }
}

type PendingFetch = {
  url: string;
  signal: AbortSignal;
  resolve: (body: ManagerGametimePayload) => void;
  /** A non-OK status, with the `Retry-After` seconds a shed one carries. */
  status: (code: number, retryAfter?: number) => void;
  reject: (error: Error) => void;
};

type Timer = { at: number; run: () => void; cleared: boolean };

function harness(options: { random?: () => number } = {}) {
  const store: {
    payload: ManagerGametimePayload | null;
    connection: GametimeConnection;
    stale: string | null;
  } = { payload: null, connection: "connecting", stale: null };
  const connections: GametimeConnection[] = [];

  const apply = <T,>(held: T, update: T | ((held: T) => T)): T =>
    typeof update === "function" ? (update as (held: T) => T)(held) : update;
  const sink: LiveSink = {
    setPayload: (update) => {
      store.payload = apply(store.payload, update);
    },
    setConnection: (update) => {
      store.connection = apply(store.connection, update);
      connections.push(store.connection);
    },
    setStale: (update) => {
      store.stale = apply(store.stale, update);
    },
  };

  const sources: FakeSource[] = [];
  /**
   * Every fetch the controller asked for, in order. **Deliberately deaf to
   * its abort signal**: a real `fetch` rejects on abort, and the guard this
   * exists to test is the one that has to hold when it does not — a response
   * already parsing, or a transport that never honoured the signal.
   */
  const fetches: PendingFetch[] = [];
  const timers: Timer[] = [];
  let now = 0;

  const env: LiveEnv = {
    openSource: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        fetches.push({
          url,
          signal: init.signal,
          resolve: (body) => resolve({ ok: true, status: 200, json: async () => body }),
          status: (code, retryAfter) =>
            resolve({
              ok: false,
              status: code,
              json: async () => ({}),
              headers: {
                get: (name) =>
                  name.toLowerCase() === "retry-after" && retryAfter !== undefined
                    ? String(retryAfter)
                    : null,
              },
            }),
          reject,
        });
      }),
    setTimeout: (run, ms) => {
      const timer: Timer = { at: now + ms, run, cleared: false };
      timers.push(timer);
      return timer as unknown as LiveTimer;
    },
    clearTimeout: (timer) => {
      (timer as unknown as Timer).cleared = true;
    },
    now: () => now,
    // No jitter unless a test asks for it, so the ladder's figures are exact.
    random: options.random ?? (() => 0),
  };

  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const pending = () => timers.filter((timer) => !timer.cleared);
  /** Run every timer due inside the window, in order. */
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = pending()
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cleared = true;
      now = Math.max(now, due.at);
      due.run();
      await flush();
    }
    now = target;
  };
  /** The one retry scheduled, as a wait from now — or null. */
  const retryIn = () => {
    const armed = pending();
    assert.ok(armed.length <= 1, `at most one retry, saw ${armed.length}`);
    return armed.length === 0 ? null : armed[0].at - now;
  };
  const current = () => sources[sources.length - 1];
  const live = () => sources.filter((source) => !source.closed);

  const stop = followGametime(SUBJECT, sink, env);

  return { store, connections, sources, fetches, current, live, retryIn, advance, flush, stop };
}

/** The server opened the stream and then named a fault. */
const openThenFail = (source: FakeSource) => {
  source.open();
  source.send({ type: "error", error: "Failed to load lineups" });
};

describe("a snapshot is owned by whoever has the newest word", () => {
  test("a delayed snapshot landing after a recovered live payload changes nothing", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    assert.equal(h.store.connection, "failed");
    assert.equal(h.fetches.length, 1, "one snapshot asked for");
    assert.equal(h.retryIn(), RETRY_BASE_MS);

    await h.advance(RETRY_BASE_MS);
    assert.equal(h.sources.length, 2);
    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    assert.equal(h.store.connection, "live");
    assert.equal(leagueTag(h.store.payload), "live");
    assert.equal(h.fetches[0].signal.aborted, true, "the pending snapshot was aborted");

    // The abort was ignored and the snapshot lands anyway.
    h.fetches[0].resolve(payload("snapshot", { a: 0 }));
    await h.flush();
    assert.equal(leagueTag(h.store.payload), "live", "the live payload stands");
    assert.equal(h.store.connection, "live");
  });

  test("an obsolete snapshot rejecting after recovery leaves the live status alone", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    assert.equal(h.store.connection, "live");

    h.fetches[0].reject(new Error("upstream gone"));
    await h.flush();
    assert.equal(h.store.connection, "live");
    assert.equal(leagueTag(h.store.payload), "live");

    // And a non-OK status is the same rejection with a different spelling.
    // (Past the cooldown, or the second close would stand the last answer in
    // rather than ask again.)
    await h.advance(SNAPSHOT_COOLDOWN_MS);
    h.current().send({ type: "error", error: "Failed to load lineups" });
    await h.flush();
    assert.equal(h.fetches.length, 2);
    await h.advance(RETRY_BASE_MS);
    h.current().send({ type: "payload", payload: payload("live-2", { a: 2 }) });
    await h.flush();
    h.fetches[1].status(503);
    await h.flush();
    assert.equal(h.store.connection, "live");
    assert.equal(leagueTag(h.store.payload), "live-2");
  });

  test("snapshots cannot commit out of order across failed attempts", async () => {
    const h = harness();
    // Attempt 1 fails; its snapshot A hangs.
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 1);

    // Attempt 2 delivers, which retires A; then fails — past the cooldown —
    // which asks for B.
    await h.advance(RETRY_BASE_MS);
    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    await h.advance(SNAPSHOT_COOLDOWN_MS);
    h.current().send({ type: "error", error: "Failed to load lineups" });
    await h.flush();
    assert.equal(h.fetches.length, 2, "a second snapshot, since the first was retired");

    // B lands first and is shown; A lands late and is nothing.
    h.fetches[1].resolve(payload("B", { a: 2 }));
    await h.flush();
    assert.equal(h.store.connection, "snapshot");
    assert.equal(leagueTag(h.store.payload), "B");
    h.fetches[0].resolve(payload("A", { a: 0 }));
    await h.flush();
    assert.equal(leagueTag(h.store.payload), "B", "the older snapshot could not overwrite the newer");
    assert.equal(h.store.connection, "snapshot");
  });

  test("only one snapshot is ever in flight, so two cannot race each other", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    await h.advance(2 * RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 1, "the pending snapshot is still the owner; no second was started");
    assert.equal(h.fetches[0].signal.aborted, false);

    h.fetches[0].resolve(payload("A", { a: 1 }));
    await h.flush();
    assert.equal(h.store.connection, "snapshot");
    assert.equal(leagueTag(h.store.payload), "A");

    // A settled slot lets the next fatal close ask again.
    await h.advance(4 * RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 2);
  });

  test("a change of subject — the caller stopping — keeps an old response from committing", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    const before = [...h.connections];

    h.stop();
    assert.equal(h.fetches[0].signal.aborted, true);
    assert.equal(h.retryIn(), null, "no retry outlives the stop");
    assert.equal(h.live().length, 0, "no source outlives the stop");

    h.fetches[0].resolve(payload("stale-subject", { a: 1 }));
    await h.flush();
    assert.equal(h.store.payload, null, "nothing committed under the next subject's heading");
    assert.deepEqual(h.connections, before, "and nothing was said");

    // Nor for a rejection.
    const g = harness();
    g.current().fail();
    await g.flush();
    g.stop();
    const said = [...g.connections];
    g.fetches[0].reject(new Error("late"));
    await g.flush();
    assert.deepEqual(g.connections, said);
  });

  test("after recovery, a delta folds over the recovered live payload and not the snapshot", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    const live = payload("live", { a: { v: 1 }, b: { v: 1 } });
    h.current().open();
    h.current().send({ type: "payload", payload: live });
    await h.flush();
    h.fetches[0].resolve(payload("snapshot", { a: { v: 0 }, b: { v: 0 }, c: { v: 0 } }));
    await h.flush();

    h.current().send({
      type: "delta",
      delta: {
        ...live,
        leagues: { b: { v: 2 } as never },
        removed: [],
        players: {},
        removed_players: [],
      },
    });
    await h.flush();
    assert.deepEqual(h.store.payload?.leagues, { a: { v: 1 }, b: { v: 2 }, tag: { tag: "live" } });
    assert.equal(h.store.connection, "live");
  });

  test("a delta with nothing to fold onto is dropped, and is not the recovery a payload is", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().open();
    h.current().send({
      type: "delta",
      delta: { ...payload("delta", {}), leagues: {}, removed: [], players: {}, removed_players: [] },
    });
    await h.flush();
    assert.equal(h.store.payload, null);
    assert.equal(h.store.connection, "reconnecting");
    assert.equal(h.fetches[0].signal.aborted, false, "the pending snapshot is still wanted");
  });
});

describe("the backoff survives a transport that opens and then fails", () => {
  test("repeated open-then-error cycles back off toward the cap", async () => {
    const h = harness();
    const waits: (number | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      openThenFail(h.current());
      await h.flush();
      waits.push(h.retryIn());
      await h.advance(waits[i] ?? 0);
    }
    assert.deepEqual(waits, [
      RETRY_BASE_MS,
      2 * RETRY_BASE_MS,
      4 * RETRY_BASE_MS,
      8 * RETRY_BASE_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
    ]);
    assert.equal(h.sources.length, 8);
    assert.equal(h.live().length, 1, "one source open at a time");
    // The plain route was asked for once per fatal close and never twice at
    // once: the first snapshot is still pending, so it is still the owner.
    assert.equal(h.fetches.length, 1);
  });

  test("a transport open without usable data neither resets the backoff nor reads as live", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().open();
    await h.flush();
    assert.equal(h.store.connection, "reconnecting", "open is not recovery");

    h.current().send({ type: "error", error: "Failed to load lineups" });
    await h.flush();
    assert.equal(h.retryIn(), 2 * RETRY_BASE_MS, "the second failure, not the first");
  });

  test("meaningful recovery resets the backoff for a later, independent failure", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    openThenFail(h.current());
    await h.flush();
    assert.equal(h.retryIn(), 2 * RETRY_BASE_MS);
    await h.advance(2 * RETRY_BASE_MS);

    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    assert.equal(h.store.connection, "live");

    // A dropped socket later that afternoon starts the ladder over.
    h.current().fail();
    await h.flush();
    assert.equal(h.retryIn(), RETRY_BASE_MS);
    assert.equal(leagueTag(h.store.payload), "live", "the last usable payload is kept");
  });

  test("a superseded source's callbacks cannot touch the current one", async () => {
    const h = harness();
    const first = h.current();
    first.fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    const second = h.current();
    second.open();
    second.send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    const said = h.connections.length;

    // The old source speaks from the grave: an error, a terminal message, a
    // payload of its own.
    first.fail();
    first.send({ type: "error", error: "Failed to load lineups" });
    first.send({ type: "payload", payload: payload("ghost", { a: 9 }) });
    await h.flush();
    assert.equal(second.closed, false, "the current source is untouched");
    assert.equal(h.retryIn(), null, "no retry was armed");
    assert.equal(h.store.connection, "live");
    assert.equal(leagueTag(h.store.payload), "live");
    assert.equal(h.connections.length, said);
    assert.equal(h.fetches.length, 1, "no second snapshot");
  });

  test("a dropped socket the browser is retrying itself is a note, not a fatal close", async () => {
    const h = harness();
    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    h.current().drop();
    await h.flush();
    assert.equal(h.store.connection, "reconnecting");
    assert.equal(h.retryIn(), null);
    assert.equal(h.fetches.length, 0);
    assert.equal(h.current().closed, false);
  });
});

describe("a shed stream is not answered with a solve", () => {
  test("a snapshot is asked for at most once a minute, however many fatal closes there are", async () => {
    const h = harness();
    // Close, snapshot answered, close again inside the minute: no second ask.
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 1);
    h.fetches[0].resolve(payload("A", { a: 1 }));
    await h.flush();
    assert.equal(h.store.connection, "snapshot");

    await h.advance(RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 1, "inside the cooldown, the last answer stands in");
    assert.equal(h.store.connection, "snapshot", "and it is still shown");
    assert.equal(h.retryIn(), 2 * RETRY_BASE_MS, "the backoff still runs");

    await h.advance(2 * RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 1, "still inside the minute");

    // Past the minute, the next close may ask again.
    await h.advance(4 * RETRY_BASE_MS);
    h.current().fail();
    await h.flush();
    assert.equal(h.fetches.length, 2);
  });

  test("a snapshot shed with a Retry-After pushes the next attempt out to it", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    assert.equal(h.retryIn(), RETRY_BASE_MS);
    h.fetches[0].status(503, 45);
    await h.flush();
    assert.equal(h.store.connection, "failed");
    assert.equal(h.retryIn(), 45_000, "the server's word, not the ladder's");

    // The retry that eventually fires is one attempt, not a herd.
    await h.advance(45_000);
    assert.equal(h.sources.length, 2);
    assert.equal(h.live().length, 1);
  });

  test("a Retry-After shorter than the armed wait, or on a status that is not a shed, is left alone", async () => {
    const h = harness();
    // Walk the ladder to a long wait first.
    for (let i = 0; i < 3; i += 1) {
      h.current().fail();
      await h.flush();
      await h.advance(h.retryIn() ?? 0);
    }
    h.current().fail();
    await h.flush();
    assert.equal(h.retryIn(), 8 * RETRY_BASE_MS);
    // The pending snapshot (the first, still the owner) answers 429 with a short wait.
    h.fetches[0].status(429, 5);
    await h.flush();
    assert.equal(h.retryIn(), 8 * RETRY_BASE_MS, "never pulled in");

    const g = harness();
    g.current().fail();
    await g.flush();
    g.fetches[0].status(500, 90);
    await g.flush();
    assert.equal(g.retryIn(), RETRY_BASE_MS, "a 500 is a fault, not a shed");

    const k = harness();
    k.current().fail();
    await k.flush();
    k.fetches[0].status(503, 24 * 60 * 60);
    await k.flush();
    assert.equal(k.retryIn(), RETRY_AFTER_MAX_MS, "capped");
  });

  test("a retired snapshot's Retry-After moves nothing", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().open();
    h.current().send({ type: "payload", payload: payload("live", { a: 1 }) });
    await h.flush();
    h.fetches[0].status(503, 300);
    await h.flush();
    assert.equal(h.retryIn(), null, "nothing armed on a live stream");
    assert.equal(h.store.connection, "live");
  });

  test("every wait is jittered", async () => {
    const h = harness({ random: () => 0.999 });
    h.current().fail();
    await h.flush();
    const wait = h.retryIn() ?? 0;
    assert.ok(wait > RETRY_BASE_MS && wait < RETRY_BASE_MS + RETRY_JITTER_MS, String(wait));
  });
});

describe("endings", () => {
  test("the no-week ending schedules no retry and asks for no snapshot", async () => {
    const h = harness();
    h.current().open();
    h.current().send({ type: "error", error: NO_WEEK });
    await h.flush();
    assert.equal(h.store.connection, "complete");
    assert.equal(h.retryIn(), null);
    assert.equal(h.fetches.length, 0);
    assert.equal(h.current().closed, true);
  });

  test("the no-week ending on a reconnect retires the snapshot a failure had asked for", async () => {
    const h = harness();
    h.current().fail();
    await h.flush();
    await h.advance(RETRY_BASE_MS);
    h.current().send({ type: "error", error: NO_WEEK });
    await h.flush();
    assert.equal(h.store.connection, "complete");
    assert.equal(h.fetches[0].signal.aborted, true);
    h.fetches[0].resolve(payload("snapshot", {}));
    await h.flush();
    assert.equal(h.store.connection, "complete");
    assert.equal(h.store.payload, null);
  });

  test("an unmount leaves nothing armed and nothing open", async () => {
    const h = harness();
    openThenFail(h.current());
    await h.flush();
    assert.equal(h.retryIn(), RETRY_BASE_MS);
    h.stop();
    assert.equal(h.retryIn(), null);
    assert.equal(h.live().length, 0);
    assert.equal(h.fetches[0].signal.aborted, true);
    // A timer that somehow fired after the stop opens nothing.
    await h.advance(RETRY_MAX_MS);
    assert.equal(h.sources.length, 1);
  });
});

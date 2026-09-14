import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createStreamAdmission,
  DEFAULT_STREAM_ADMISSION,
  STREAM_ADMISSION_VARS,
  streamAdmissionConfig,
  streamRefusalResponse,
} from "./admission.ts";
import type { StreamRefusal, StreamReservation } from "./admission.ts";

const config = {
  maxConnections: 4,
  maxPerClient: 2,
  maxPerSubject: 3,
  maxOpening: 2,
  retryAfterSeconds: 15,
};

function seat(admission: ReturnType<typeof createStreamAdmission>, client = "10.0.0.1", kind: "gametime" | "picktracker" = "gametime"): StreamReservation {
  const reservation = admission.reserve({ kind, client });
  assert.equal(reservation.ok, true, `expected admission for ${client}`);
  return reservation as StreamReservation;
}

describe("the process-wide total", () => {
  test("holds under a burst of concurrent attempts, and both kinds share it", () => {
    const admission = createStreamAdmission(config);
    // Eight arrivals in one tick, alternating kinds, from distinct addresses so
    // only the total can refuse them.
    const results = Array.from({ length: 8 }, (_, i) =>
      admission.reserve({ kind: i % 2 ? "picktracker" : "gametime", client: `10.0.0.${i}` }),
    );
    const admitted = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok) as StreamRefusal[];
    assert.equal(admitted.length, 4);
    assert.equal(refused.length, 4);
    assert.ok(refused.every((r) => r.reason === "capacity" && r.status === 503));
    const stats = admission.stats();
    assert.equal(stats.connections, 4);
    assert.equal(stats.byKind.gametime + stats.byKind.picktracker, 4);
    assert.equal(stats.refused.capacity, 4);
  });

  test("a pending reservation — no subject yet, no stream yet — counts", () => {
    const admission = createStreamAdmission(config);
    for (let i = 0; i < 4; i += 1) seat(admission, `10.0.0.${i}`);
    // None of the four has attached or opened anything; the fifth is still refused.
    const fifth = admission.reserve({ kind: "gametime", client: "10.0.0.9" });
    assert.equal(fifth.ok, false);
  });

  test("a normal client reconnects once capacity is released", () => {
    const admission = createStreamAdmission(config);
    const held = Array.from({ length: 4 }, (_, i) => seat(admission, `10.0.0.${i}`));
    assert.equal(admission.reserve({ kind: "gametime", client: "10.0.0.9" }).ok, false);
    held[0].release();
    assert.equal(admission.reserve({ kind: "gametime", client: "10.0.0.9" }).ok, true);
  });
});

describe("per client", () => {
  test("a client at its cap is refused with a 429 while others are admitted", () => {
    const admission = createStreamAdmission(config);
    seat(admission, "10.0.0.1");
    seat(admission, "10.0.0.1");
    const third = admission.reserve({ kind: "picktracker", client: "10.0.0.1" });
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.reason, "client");
      assert.equal(third.status, 429);
      assert.equal(third.retryAfterSeconds, 15);
    }
    assert.equal(admission.reserve({ kind: "picktracker", client: "10.0.0.2" }).ok, true);
  });

  test("the per-client map holds only live counts", () => {
    const admission = createStreamAdmission(config);
    const a = seat(admission, "10.0.0.1");
    const b = seat(admission, "10.0.0.2");
    assert.equal(admission.stats().clients, 2);
    a.release();
    b.release();
    assert.equal(admission.stats().clients, 0);
  });
});

describe("per subject", () => {
  test("a room at its cap refuses the next seat and releases that reservation", () => {
    const admission = createStreamAdmission({ ...config, maxConnections: 10, maxPerClient: 10 });
    for (let i = 0; i < 3; i += 1) assert.equal(seat(admission, `10.0.0.${i}`).attach("2026:3").ok, true);
    const fourth = seat(admission, "10.0.0.9");
    const seated = fourth.attach("2026:3");
    assert.equal(seated.ok, false);
    if (!seated.ok) assert.equal(seated.reason, "subject");
    // The refusal handed the connection back: nothing is held for it.
    assert.equal(admission.stats().connections, 3);
    // Another subject is unaffected.
    assert.equal(seat(admission, "10.0.0.9").attach("2026:4").ok, true);
  });

  test("attaching twice is a programming error, not a second seat", () => {
    const admission = createStreamAdmission(config);
    const r = seat(admission);
    r.attach("s");
    assert.throws(() => r.attach("t"));
  });
});

describe("cold openings", () => {
  test("distinct subjects opening at once are bounded before any work begins", () => {
    const admission = createStreamAdmission({ ...config, maxConnections: 10, maxPerClient: 10 });
    const a = seat(admission, "10.0.0.1");
    a.attach("L1");
    const b = seat(admission, "10.0.0.2");
    b.attach("L2");
    const c = seat(admission, "10.0.0.3");
    c.attach("L3");
    assert.equal(a.beginOpening().ok, true);
    assert.equal(b.beginOpening().ok, true);
    const refused = c.beginOpening();
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.reason, "opening");
    // And the refused one gave its connection back.
    assert.equal(admission.stats().connections, 2);
  });

  test("same-subject joiners share one opening slot — the dedupe survives", () => {
    const admission = createStreamAdmission({ ...config, maxConnections: 10, maxPerClient: 10 });
    const joiners = Array.from({ length: 3 }, (_, i) => {
      const r = seat(admission, `10.0.0.${i}`);
      r.attach("L1");
      return r;
    });
    for (const r of joiners) assert.equal(r.beginOpening().ok, true);
    assert.equal(admission.stats().opening, 1, "one subject opening, however many joined it");
    // A second subject still fits, a third does not.
    const other = seat(admission, "10.0.0.7");
    other.attach("L2");
    assert.equal(other.beginOpening().ok, true);
    const third = seat(admission, "10.0.0.8");
    third.attach("L3");
    assert.equal(third.beginOpening().ok, false);
    // The slot is held until the last joiner ends its opening.
    joiners[0].endOpening();
    joiners[1].endOpening();
    assert.equal(admission.stats().opening, 2);
    joiners[2].endOpening();
    assert.equal(admission.stats().opening, 1);
  });

  test("a subject already opening is joined, never refused, even at the bound", () => {
    const admission = createStreamAdmission({ ...config, maxConnections: 10, maxPerClient: 10, maxOpening: 1 });
    const a = seat(admission, "10.0.0.1");
    a.attach("L1");
    assert.equal(a.beginOpening().ok, true);
    const b = seat(admission, "10.0.0.2");
    b.attach("L1");
    assert.equal(b.beginOpening().ok, true, "the same subject shares the slot");
  });

  test("opening before attaching is a programming error", () => {
    const admission = createStreamAdmission(config);
    assert.throws(() => seat(admission).beginOpening());
  });
});

describe("release", () => {
  test("gives everything back exactly once, however many times it is called", () => {
    const admission = createStreamAdmission(config);
    const r = seat(admission, "10.0.0.1");
    r.attach("L1");
    r.beginOpening();
    const other = seat(admission, "10.0.0.2");
    assert.deepEqual(
      { ...admission.stats(), refused: undefined },
      { connections: 2, byKind: { gametime: 2, picktracker: 0 }, clients: 2, subjects: 1, opening: 1, refused: undefined },
    );
    r.release();
    r.release();
    r.endOpening();
    r.release();
    const stats = admission.stats();
    assert.equal(stats.connections, 1, "a doubled release must not widen the bound");
    assert.equal(stats.clients, 1);
    assert.equal(stats.subjects, 0);
    assert.equal(stats.opening, 0);
    other.release();
    assert.equal(admission.stats().connections, 0);
  });

  test("a released reservation refuses to attach or open", () => {
    const admission = createStreamAdmission(config);
    const r = seat(admission);
    r.release();
    assert.equal(r.attach("L1").ok, false);
    assert.equal(admission.stats().connections, 0);
  });
});

describe("streamRefusalResponse", () => {
  test("carries the status, a Retry-After and no-store", async () => {
    const admission = createStreamAdmission({ ...config, maxConnections: 0 });
    const refusal = admission.reserve({ kind: "gametime", client: "c" });
    assert.equal(refusal.ok, false);
    const response = streamRefusalResponse(refusal as StreamRefusal);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "15");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /shortly/);
  });
});

describe("streamAdmissionConfig", () => {
  test("defaults are the documented ones, and are conservative", () => {
    const { warnings, ...config } = streamAdmissionConfig({});
    assert.deepEqual(config, DEFAULT_STREAM_ADMISSION);
    assert.deepEqual(warnings, []);
    assert.ok(DEFAULT_STREAM_ADMISSION.maxConnections <= 60);
    assert.ok(DEFAULT_STREAM_ADMISSION.maxPerClient >= 4, "a household with tabs must fit");
    assert.ok(DEFAULT_STREAM_ADMISSION.maxPerSubject >= 24, "a twelve-team room on two devices each");
  });

  test("reads each variable, and junk falls back with a warning", () => {
    const read = streamAdmissionConfig({
      [STREAM_ADMISSION_VARS.maxConnections]: "12",
      [STREAM_ADMISSION_VARS.maxPerClient]: "0",
      [STREAM_ADMISSION_VARS.maxPerSubject]: "abc",
      [STREAM_ADMISSION_VARS.maxOpening]: "3",
      [STREAM_ADMISSION_VARS.retryAfterSeconds]: "99999",
    });
    assert.equal(read.maxConnections, 12);
    assert.equal(read.maxPerClient, DEFAULT_STREAM_ADMISSION.maxPerClient);
    assert.equal(read.maxPerSubject, DEFAULT_STREAM_ADMISSION.maxPerSubject);
    assert.equal(read.maxOpening, 3);
    assert.equal(read.retryAfterSeconds, DEFAULT_STREAM_ADMISSION.retryAfterSeconds);
    assert.equal(read.warnings.length, 3);
  });
});

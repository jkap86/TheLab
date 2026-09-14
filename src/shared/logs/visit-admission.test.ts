import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  anyDropped,
  createVisitAdmission,
  DEFAULT_VISIT_ADMISSION,
  VISIT_ADMISSION_VARS,
  visitAdmissionConfig,
} from "./visit-admission.ts";

const NOW = 1_700_000_000_000;
const small = { writesPerMinute: 6, perClientPerMinute: 3, maxInFlight: 2, dedupeMs: 2_000, maxKeys: 4 };

describe("visit admission", () => {
  test("a repeat of one route from one client inside the window is dropped, and another route is not", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 100 });
    const first = gate.admit({ client: "a", route: "/tools" }, NOW);
    assert.equal(first.ok, true);
    if (first.ok) first.release();
    assert.deepEqual(gate.admit({ client: "a", route: "/tools" }, NOW + 500), { ok: false, reason: "duplicate" });
    assert.equal(gate.admit({ client: "a", route: "/trades" }, NOW + 500).ok, true);
    assert.equal(gate.admit({ client: "b", route: "/tools" }, NOW + 500).ok, true);
    assert.equal(gate.admit({ client: "a", route: "/tools" }, NOW + 2_000).ok, true);
  });

  test("in-flight inserts are capped, and a release gives the slot back once", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 2, perClientPerMinute: 100, writesPerMinute: 100 });
    const one = gate.admit({ client: "a", route: "/r1" }, NOW);
    const two = gate.admit({ client: "a", route: "/r2" }, NOW);
    assert.equal(one.ok && two.ok, true);
    assert.deepEqual(gate.admit({ client: "a", route: "/r3" }, NOW), { ok: false, reason: "in-flight" });
    assert.equal(gate.stats().inFlight, 2);
    if (one.ok) {
      one.release();
      one.release();
    }
    assert.equal(gate.stats().inFlight, 1);
    assert.equal(gate.admit({ client: "a", route: "/r3" }, NOW).ok, true);
  });

  test("one client's budget is spent before the process's, and refills with time", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 100 });
    for (let i = 0; i < 3; i++) {
      const d = gate.admit({ client: "a", route: `/r${i}` }, NOW);
      assert.equal(d.ok, true, `write ${i}`);
    }
    assert.deepEqual(gate.admit({ client: "a", route: "/r9" }, NOW), { ok: false, reason: "client" });
    // Another client still has the process's remaining three.
    assert.equal(gate.admit({ client: "b", route: "/r1" }, NOW).ok, true);
    // Twenty seconds refills one token of a three-a-minute budget.
    assert.equal(gate.admit({ client: "a", route: "/r9" }, NOW + 20_000).ok, true);
    assert.deepEqual(gate.admit({ client: "a", route: "/r10" }, NOW + 20_000), { ok: false, reason: "client" });
  });

  test("the process budget is the whole-table bound across clients", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 100, perClientPerMinute: 100 });
    for (let i = 0; i < 6; i++) {
      assert.equal(gate.admit({ client: `c${i}`, route: "/tools" }, NOW).ok, true, `write ${i}`);
    }
    assert.deepEqual(gate.admit({ client: "c9", route: "/tools" }, NOW), { ok: false, reason: "budget" });
    // A refusal spends nothing: the client that was refused is not charged.
    assert.equal(gate.admit({ client: "c9", route: "/tools" }, NOW + 10_000).ok, true);
    // And never more than the capacity, however long the quiet.
    assert.equal(gate.admit({ client: "c1", route: "/x" }, NOW + 600_000).ok, true);
    let admitted = 1;
    for (let i = 0; i < 20; i++) {
      if (gate.admit({ client: `d${i}`, route: "/x" }, NOW + 600_000).ok) admitted += 1;
    }
    assert.equal(admitted, 6);
  });

  test("drops are counted by reason and drained", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 1 });
    gate.admit({ client: "a", route: "/tools" }, NOW);
    gate.admit({ client: "a", route: "/tools" }, NOW); // duplicate
    gate.admit({ client: "b", route: "/tools" }, NOW); // in-flight
    assert.deepEqual(gate.stats().dropped, { duplicate: 1, "in-flight": 1, client: 0, budget: 0 });
    assert.equal(anyDropped(gate.drain()), true);
    assert.equal(anyDropped(gate.drain()), false);
  });

  test("the client map and the dedupe map are bounded", () => {
    const gate = createVisitAdmission({ ...small, maxInFlight: 100, writesPerMinute: 100 });
    for (let i = 0; i < 50; i++) {
      const d = gate.admit({ client: `c${i}`, route: "/tools" }, NOW + i);
      assert.equal(d.ok, true);
    }
    // The maps are private; what is observable is that an old key has been
    // forgotten — a client evicted from the dedupe map may repeat at once.
    assert.equal(gate.admit({ client: "c0", route: "/tools" }, NOW + 100).ok, true);
  });
});

describe("visitAdmissionConfig", () => {
  test("defaults are the documented ones", () => {
    assert.deepEqual(visitAdmissionConfig({}).config, DEFAULT_VISIT_ADMISSION);
    assert.equal(DEFAULT_VISIT_ADMISSION.maxInFlight <= 4, true);
  });

  test("reads each variable, and junk falls back with a warning", () => {
    const { config, warnings } = visitAdmissionConfig({
      [VISIT_ADMISSION_VARS.writesPerMinute]: "120",
      [VISIT_ADMISSION_VARS.perClientPerMinute]: "abc",
      [VISIT_ADMISSION_VARS.maxInFlight]: "999",
    });
    assert.equal(config.writesPerMinute, 120);
    assert.equal(config.perClientPerMinute, DEFAULT_VISIT_ADMISSION.perClientPerMinute);
    assert.equal(config.maxInFlight, DEFAULT_VISIT_ADMISSION.maxInFlight);
    assert.equal(warnings.length, 2);
  });
});

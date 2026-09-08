import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRequestGuard } from "./request-guard.ts";

/**
 * The acceptance rule behind every async Manager hook, driven without React.
 *
 * **The race it closes is invisible in a passing render.** A hook resets its
 * visible state during render when its subject changes and aborts the previous
 * request in an effect cleanup — but the cleanup is a passive effect and runs
 * after paint, so between the two there is a window in which the *previous*
 * manager's response resolves, is not an abort, and commits itself under the
 * *new* manager's name. Nothing throws and nothing looks wrong: a league list,
 * a rank or an error message is a plausible value whichever question produced
 * it, which is exactly why this is tested rather than observed.
 *
 * These are the three ways a stale commit gets in. Each is written as the
 * sequence a hook actually performs.
 */
describe("createRequestGuard", () => {
  test("a ticket taken for the current subject may commit", () => {
    const guard = createRequestGuard("jkap86 2026");
    const ticket = guard.issue();
    assert.equal(guard.accepts(ticket), true);
  });

  test("a subject change retires a ticket before any cleanup runs", () => {
    // The exact race: A's request is launched, the render for B changes the
    // subject, and only *then* does A's fetch resolve. The abort has not
    // fired, so `isAbortError` does not catch it — this does.
    const guard = createRequestGuard("A 2026");
    const a = guard.issue();
    guard.setSubject("B 2026");
    assert.equal(guard.accepts(a), false, "A's answer must not land on B");

    const b = guard.issue();
    assert.equal(guard.accepts(b), true);
    assert.equal(guard.accepts(a), false, "and never becomes acceptable again");
  });

  test("a second request for the same subject retires the first", () => {
    // A retry: nothing about the manager, season or board has moved, so a
    // subject comparison alone would let the abandoned attempt's answer — or
    // its error — land on the attempt that replaced it.
    const guard = createRequestGuard("A 2026");
    const first = guard.issue();
    const second = guard.issue();
    assert.equal(guard.accepts(first), false);
    assert.equal(guard.accepts(second), true);
  });

  test("returning to a subject does not revive its old tickets", () => {
    // A → B → A. The generation is what carries this: a bare subject
    // comparison would accept a response from the first visit to A, which is
    // about a state the reader has since left and come back to.
    const guard = createRequestGuard("A 2026");
    const first = guard.issue();
    guard.setSubject("B 2026");
    guard.setSubject("A 2026");
    assert.equal(guard.accepts(first), false);
  });

  test("re-declaring the same subject retires nothing", () => {
    // Every render calls `setSubject`, and StrictMode calls it twice. A guard
    // that retired on each would reject its own in-flight request.
    const guard = createRequestGuard("A 2026");
    const ticket = guard.issue();
    guard.setSubject("A 2026");
    guard.setSubject("A 2026");
    assert.equal(guard.accepts(ticket), true);
  });

  test("a ticket forged for another guard is refused", () => {
    // Two hooks on one page hold two guards; a ticket is only ever meaningful
    // to the one that issued it.
    const a = createRequestGuard("A 2026");
    const b = createRequestGuard("B 2026");
    assert.equal(b.accepts(a.issue()), false);
  });
});

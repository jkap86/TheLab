"use client";

import { useState } from "react";

/**
 * Which request a response belongs to, so a late one cannot write state that is
 * no longer about it.
 *
 * **Every async hook in this app already resets its state during render when
 * its subject changes, and aborts the previous request in an effect cleanup.
 * Neither is enough on its own, and the gap between them is a real race.**
 * React runs the render-phase reset immediately and the cleanup as a *passive*
 * effect, after paint — so between the frame that renders manager B and the
 * commit that tears manager A's fetch down there is a window in which A's
 * response can resolve. `AbortController` has not fired yet, the `isAbortError`
 * guard therefore does not catch it, and the `setState` lands on B: A's
 * payload, A's error or A's progress bar, under B's name, with nothing on
 * screen saying so.
 *
 * The abort stays — it is what stops a dead request consuming a connection and
 * a stream reader, which is worth having on its own — but *correctness* is this
 * ticket's, and it holds whatever order the browser resolves things in.
 *
 * It is a plain factory rather than a hook so the acceptance rule can be driven
 * under Node's own test runner; {@link useRequestGuard} is the four-line React
 * wrapper. `request-guard.test.ts` pins the three ways a stale commit gets in.
 */
export type RequestTicket = {
  /** The manager, season, board — whatever identifies *what* was asked for. */
  subject: string;
  /** Which asking it was. Distinguishes two requests for one subject. */
  generation: number;
};

export type RequestGuard = {
  /**
   * Point the guard at a subject. A **change** retires every ticket in flight,
   * which is what closes the window above: it is called during render, on the
   * same pass that resets the visible state, so a response that arrives before
   * the effect cleanup runs is already stale.
   *
   * Idempotent, so React's double-render in development retires nothing twice.
   */
  setSubject(subject: string): void;
  /**
   * Take a ticket for a request about to be launched, retiring any earlier one.
   *
   * Called per launch rather than per subject so a **retry** — same manager,
   * same season, a second attempt — cannot have its predecessor's answer land
   * on it.
   */
  issue(): RequestTicket;
  /** Whether this ticket may still write state. */
  accepts(ticket: RequestTicket): boolean;
};

export function createRequestGuard(subject: string): RequestGuard {
  const current: RequestTicket = { subject, generation: 0 };
  return {
    setSubject(next) {
      if (current.subject === next) return;
      current.subject = next;
      current.generation += 1;
    },
    issue() {
      current.generation += 1;
      return { subject: current.subject, generation: current.generation };
    },
    accepts(ticket) {
      return (
        ticket.subject === current.subject &&
        ticket.generation === current.generation
      );
    },
  };
}

/**
 * {@link createRequestGuard} held across renders, pointed at the current
 * subject on every one of them.
 *
 * The `setSubject` call is **render-phase and deliberate**, on the same terms
 * this codebase already states for the resets beside it: an effect would run
 * after paint, which is exactly the window the guard exists to close. It writes
 * only to a ref and is a no-op when the subject has not moved, so a re-render
 * — including StrictMode's second pass — changes nothing.
 */
export function useRequestGuard(subject: string): RequestGuard {
  // `useState` with a lazy initialiser rather than a ref, and the reason is the
  // one rule this shape has to satisfy: the guard is *read* during render, and
  // reading a ref there is what `react-hooks/refs` exists to stop. State that is
  // never re-set is the same "one object for the life of the component" with
  // none of that hazard — and it makes the guard a stable value an effect can
  // list among its dependencies rather than one it has to be excused from.
  const [guard] = useState(() => createRequestGuard(subject));
  guard.setSubject(subject);
  return guard;
}

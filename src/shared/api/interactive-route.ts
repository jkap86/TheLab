/**
 * The scope a route handler runs its body in, and the one place its overload
 * is answered.
 *
 * `withInteractiveSleeper` is the general scope — it is what a *page* opens,
 * and what a test drives — and this is the route-shaped composition of it:
 * declare the class, mint the request's absolute Sleeper deadline, and turn a
 * refusal into a 503 however deep in the handler it came from.
 *
 * **The "however deep" is the whole reason it exists.** Every handler in this
 * app resolves its manager and its season *before* the `try` it wraps the rest
 * in — deliberately, because those two produce their own statuses — so a
 * refusal from either escaped every `catch` on the page and reached Next as an
 * unhandled exception. A helper that only wrapped the try'd part would fix half
 * the reads in a handler and leave the two that run first.
 *
 * **A non-refusal is rethrown rather than mapped**, which is the other half of
 * being safe to put in front of sixteen routes: whatever a handler does about
 * its own failures today, it goes on doing. This adds an answer for the one
 * error class that had none.
 */

// Relative and with the extension — `./overload`'s reason: the composition is
// the thing worth testing, and `request-policy.ts` imports nothing but
// `node:async_hooks`, so the whole of it resolves under Node's own runner.
import { withInteractiveSleeper } from "../sleeper/request-policy.ts";

import { mapOverload } from "./overload.ts";

export type InteractiveRouteOptions = {
  /**
   * The reader's own cancellation, handed to every Sleeper read in the scope.
   *
   * Almost never passed, and the reason is `request-policy`'s: a scope's signal
   * is a promise about *every* read under it, and most of them are held in
   * process for other readers. `/api/picktracker/[leagueId]` is the one route
   * that can make that promise.
   */
  signal?: AbortSignal;
};

/**
 * Run a route handler as interactive Sleeper traffic, answering an overload as
 * an overload.
 *
 * The handler returns the `Response` it always did; only a thrown admission
 * refusal is intercepted.
 */
export async function interactiveRoute(
  handler: () => Promise<Response>,
  options: InteractiveRouteOptions = {},
): Promise<Response> {
  return withInteractiveSleeper(async () => {
    try {
      return await handler();
    } catch (error) {
      const shed = mapOverload(error);
      if (shed) return shed;
      throw error;
    }
  }, options);
}

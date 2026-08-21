/**
 * An **optional** read: one whose failure costs a section of a payload rather
 * than the whole request.
 *
 * Five routes make a read of this shape — the projected ranks, the two manager
 * value routes' lineup solves, League Details' KTC and ADP prices, and the
 * lineup checker's week — and every one of them used to spell it the same wrong
 * way: `.catch(() => <the empty answer>)`. That is a `200` carrying a value the
 * caller cannot tell from a real one, and three things follow that nobody chose.
 * The client's retry never runs, because nothing failed. The fabricated empty is
 * cached as a **successful** answer — by React Query for its whole stale time,
 * and by this app's own in-process caches for theirs — so a database busy for a
 * second reads as "this manager has no projections" for fifteen minutes. And at
 * no layer, server or client, is there anything left that could tell the two
 * apart.
 *
 * The judgement that made those catches right is untouched: a manager's record
 * and points ranks are read off rosters already in hand, and throwing them away
 * because a *second* read failed would be a worse answer than a partial one. So
 * this keeps the partial answer and adds back the one bit the catch destroyed —
 * **which of the two happened.** A caller stores the `status` on its payload,
 * the client reads it, and the sections that could not be computed stay blank
 * *and* stay retryable rather than being remembered as facts.
 *
 * Three rules:
 *
 *   - **`status: "ok"` is a claim about the read, not about the value.** An
 *     empty map from a successful read is a legitimate "nothing to project" and
 *     stays exactly as expressible as it was; that is the whole distinction this
 *     module exists to restore.
 *   - **It never decides fatality.** A read whose failure *is* the request's
 *     failure must not be wrapped — it belongs to the route's own catch and
 *     `readFailureResponse`, which is what turns a busy database into a 503 the
 *     caller will retry. Wrapping such a read is how a 500 becomes a 200 holding
 *     nothing.
 *   - **The failure is logged where it happened**, with the caller's own prefix,
 *     because the caller is the only thing that knows whose read it was.
 *
 * `error` rides along on the failed arm rather than being dropped: nothing reads
 * it today, and a caller that later wants to distinguish "the pool had no room"
 * from "the query is broken" has it without another edit here.
 */

import { errorMessage } from "./errors.ts";

/**
 * What an optional read did — the same two words that cross the wire as an
 * enrichment's status, so a route can hand this straight to its payload.
 */
export type OptionalReadStatus = "ok" | "error";

export type OptionalRead<T> =
  | { status: "ok"; value: T; error?: undefined }
  | { status: "error"; value: null; error: unknown };

/**
 * Run `read`, reporting a failure as a failure instead of as an empty answer.
 *
 * `label` is the log prefix the call site would have written in its own
 * `.catch` — `` `[ktc] lineups for ${username}` `` — and it is the caller's
 * because only the caller knows the subject.
 */
export async function readOptional<T>(
  label: string,
  read: () => Promise<T>,
): Promise<OptionalRead<T>> {
  try {
    return { status: "ok", value: await read() };
  } catch (error) {
    console.error(`${label} failed:`, errorMessage(error));
    return { status: "error", value: null, error };
  }
}

/**
 * The status a section takes when it was never attempted at all.
 *
 * Not an outcome of {@link readOptional} — there is no read to report on — but
 * the third word a payload needs where a caller can *ask* for a section to be
 * skipped, which today is `?projections=0` on the ranks route. Kept here beside
 * the other two so the vocabulary is one list rather than a union rebuilt per
 * payload.
 */
export type SkippableReadStatus = OptionalReadStatus | "skipped";

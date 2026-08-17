import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";

import { readFailureResponse } from "./read-failure";
import { withReadTiming } from "./read-timing";

/**
 * A read, answered — or the standard read failure, never a 200 pretending to be
 * one.
 *
 * The five lines every route that catches a read opens with, written once:
 * time it, send what it returned, and turn a throw into
 * {@link readFailureResponse}. `values` and `timeline` already wrote exactly
 * this inline; what makes it a module is the two routes that *didn't*.
 *
 * **`/week` and `/outlook` used to answer a failed read with `200 null`**, on
 * the reasoning that an enrichment is a couple of columns on top of a panel
 * whose point is the rosters, so a read that can't answer should cost the
 * columns rather than the league. That half is right and is unchanged — the
 * client's own composition is what holds it up ({@link useLeagueDetail}: only
 * the core's failure is the panel's failure). What was wrong was the *spelling*.
 * A 200 tells the browser the request succeeded, so three things follow that
 * nobody chose: the query client's retry never runs, because there was no
 * failure to retry; the `null` is cached as a **successful** answer for the
 * entry's whole stale time, so a database that was busy for one second reads as
 * a league with no outlook for five minutes; and there is no way, at any layer,
 * to tell that from a league that genuinely has nothing to project.
 *
 * So the rule is the one the em dash already implied and the wire didn't carry:
 * **a null body means the domain answered "nothing", and an operational failure
 * is a failure status.** A route with a legitimate null keeps sending it (see
 * `…/outlook`); a route whose loader cannot return null has no null on the wire
 * at all (see `…/week`, whose `getLeagueWeekView` is `Promise<LeagueWeekView>`).
 * Which of the two failure statuses a caller gets is `readFailureResponse`'s
 * decision and stays there — a database out of room is a 503 and a retry, and
 * anything else is a 500.
 *
 * The label and subject are the timing's, reused for the error line: a read that
 * failed wants naming exactly as precisely as one that was slow, and two strings
 * that would have to agree are better as one pair that cannot disagree.
 */
export async function readResponse<T>(args: {
  /** The timing label, one per route — `league.week`. */
  label: string;
  /** What was being read — `league=123 week=5`. */
  subject: string;
  /** The sentence a caller is shown when the read fails for a reason of its own. */
  failure: string;
  read: () => Promise<T>;
}): Promise<NextResponse<T | ApiErrorPayload>> {
  const { label, subject, failure, read } = args;

  try {
    return NextResponse.json(await withReadTiming(label, subject, read));
  } catch (error) {
    console.error(`[read] ${label} failed (${subject}):`, error);
    return readFailureResponse(error, failure);
  }
}

import type { RosterTimelinePayload } from "@/shared/contract";

import { apiFetch } from "./api.ts";

/**
 * Where a roster timeline is fetched from and filed under.
 *
 * **Two routes, one entry shape, and the source is what tells them apart.** The
 * trades board asks about a trade and the leagues list asks about a league; the
 * answers have the same type and the same meaning, so they belong under one key
 * table with the kind as a segment rather than in two — spelling the kind out is
 * what stops a league id and a transaction id from ever colliding on one entry,
 * which is not hypothetical when both are bare digit strings from the same
 * upstream.
 *
 * **Deliberately outside both the manager prefix and the trades one.** It asks
 * nothing about an account, so a manager-scoped invalidation has no business
 * throwing it away; and it stopped being a trades answer the moment a second tool
 * drew the same rail, which is why it is no longer an entry on
 * `tradesQueryKeys`.
 *
 * Pure, with a relative `.ts` import, so the keys can be hashed in a test.
 */

/** Which walk a timeline comes from — see {@link timelineQueryKeys}. */
export type TimelineSource =
  | { kind: "trade"; id: string }
  | { kind: "league"; id: string };

export const timelineQueryKeys = {
  all: ["timeline"] as const,
  /**
   * One timeline, keyed on its source alone.
   *
   * **The rail's position is deliberately not in it.** A stop is arithmetic over
   * this one payload rather than a request of its own, which is the whole point of
   * sending the log instead of the answer: keying on the position would turn a
   * drag into a request per notch for data the browser is already holding.
   */
  timeline: (source: TimelineSource) =>
    [...timelineQueryKeys.all, source.kind, source.id] as const,
};

/**
 * How long a timeline is reused.
 *
 * **An hour, where nothing else on these pages goes past fifteen minutes.** What
 * a roster held on a past date does not change once it is right, and every stop
 * on the rail but one is in the past. What *does* change is the present end — a
 * waiver claimed since the payload was fetched is a move the rail does not know
 * about — and that is bounded rather than wrong: the detail panel behind "now" is
 * a separate read on a separate TTL, and it is the panel that draws the present.
 *
 * It matters more on the unanchored rail than it ever did on the anchored one,
 * which is the reason worth restating: a league's whole log is the heaviest read
 * either of these routes makes, and the leagues list opens cards casually. An hour
 * is what makes opening the same league twice cost one request.
 */
export const TIMELINE_STALE_TIME = 60 * 60 * 1000;

const PATHS: Record<TimelineSource["kind"], (id: string) => string> = {
  trade: (id) => `/api/trades/timeline?trade=${encodeURIComponent(id)}`,
  league: (id) => `/api/league/${encodeURIComponent(id)}/timeline`,
};

/**
 * One league's replay, from whichever of the two routes answers for this source.
 *
 * It lives apart from the hook for the reason `fetchManagerLeagues` does — a
 * function taking its inputs as arguments is one a test can call, where the same
 * logic inside a hook is only reachable through a renderer.
 */
export async function fetchTimeline({
  source,
  signal,
}: {
  source: TimelineSource;
  signal?: AbortSignal;
}): Promise<RosterTimelinePayload> {
  const res = await apiFetch(PATHS[source.kind](source.id), {
    signal,
    fallbackError: "Failed to load the league's timeline",
  });
  return (await res.json()) as RosterTimelinePayload;
}

/**
 * The visit log's wire shape.
 *
 * A visit is stored as its raw path plus the one fact a path cannot carry — who
 * was looking — and everything else the page shows (which tool, whose page,
 * which league) is derived on the client from `route`. So this file is small on
 * purpose: adding a tool changes a pure helper in `features/logs`, not a type
 * here and not a column.
 */

/** One request the proxy saw. */
export type VisitorLogEntry = {
  /** `bigint`, which `pg` hands back as a string rather than losing precision. */
  id: string;
  /** ISO 8601, UTC. Rendered in the reader's own zone. */
  seen_at: string;
  /**
   * The address the request claimed, or **null** when it carried none this app
   * could read — which is the ordinary case in local development, where nothing
   * sets `x-forwarded-for`. Null is not "unknown IP" spelled differently: there
   * is no address, and the column says so rather than storing a sentinel.
   */
  ip: string | null;
  /** The pathname. Query strings are not stored. */
  route: string;
  /**
   * The stored Sleeper account of whoever was *looking*, or null before one is
   * resolved on that browser. Distinct from whoever the page is *about*, which
   * is in `route` — on `/manager/[username]` those are two different people
   * whenever anyone looks somebody else up.
   */
  viewer: string | null;
};

/** `GET /api/logs` — recent visits, newest first. */
export type VisitorLogsPayload = {
  /** The window that answered, echoed so the page cannot mislabel its own list. */
  window_hours: number;
  entries: VisitorLogEntry[];
  /**
   * True when the row cap trimmed the window — the list is not the whole answer,
   * and the totals above it are counts of what arrived rather than of what
   * happened.
   */
  truncated: boolean;
};

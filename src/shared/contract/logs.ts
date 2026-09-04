/**
 * The visit log's wire shape.
 *
 * A visit is stored as its raw path and nothing else, and everything the page
 * shows (which tool, whose page, which league) is derived on the client from
 * `route`. So this file is small on purpose: adding a tool changes a pure
 * helper in `features/logs`, not a type here and not a column.
 *
 * It carried a `viewer` — the browser's stored account, meant to say who was
 * *looking* as opposed to who was being looked at. It named the last account
 * that browser had looked up instead, which on a page built for looking other
 * people up is usually somebody else; the migration that drops the column
 * carries the argument.
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

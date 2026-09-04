import type { VisitorLogEntry } from "@/shared/contract";
import { msInterval, pool } from "@/shared/db";

/**
 * The most rows one read will ship.
 *
 * The ported original has no `LIMIT` at all — it sends every row in its window
 * and renders all of them, unvirtualized. That is survivable at a day and is
 * not at a month, and rows here are kept rather than pruned. The cap is high
 * enough that a personal app's month fits under it and low enough that a
 * scraped-flat table cannot take the page down.
 */
export const VISITOR_LOG_CAP = 5000;

type VisitorLogRow = {
  id: string;
  seen_at: Date;
  ip: string | null;
  route: string;
  viewer: string | null;
};

/**
 * Recent visits, newest first.
 *
 * `host(ip)` renders the `INET` without the `/32` a bare cast would carry —
 * a mask on a single address is noise in a column of them.
 *
 * The cap is fetched with one row of headroom so the caller can say whether it
 * bit, rather than presenting a trimmed list as the whole window. A page that
 * silently drops the older half of a month is making a claim it cannot support.
 */
export async function getVisitorLogs(
  windowMs: number,
  cap: number = VISITOR_LOG_CAP,
): Promise<{ entries: VisitorLogEntry[]; truncated: boolean }> {
  const { rows } = await pool.query<VisitorLogRow>(
    `SELECT id, seen_at, host(ip) AS ip, route, viewer
       FROM visitor_logs
      WHERE seen_at > now() - $1::interval
      ORDER BY seen_at DESC, id DESC
      LIMIT $2`,
    [msInterval(windowMs), cap + 1],
  );

  const truncated = rows.length > cap;
  return {
    entries: (truncated ? rows.slice(0, cap) : rows).map((row) => ({
      id: row.id,
      seen_at: row.seen_at.toISOString(),
      ip: row.ip,
      route: row.route,
      viewer: row.viewer,
    })),
    truncated,
  };
}

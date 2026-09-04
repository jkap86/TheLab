/**
 * `POST /api/league/[leagueId]/sync` — one league, re-read from Sleeper because
 * a reader pressed a key.
 *
 * Types only, like everything in `contract/`: the route builds this on the
 * server and a `"use client"` hook decodes it, so it must be nameable on both
 * sides of that seam without dragging `pg` or the Sleeper client into the
 * browser.
 *
 * **Every field here exists because a refused press still has to say something
 * true.** The press has six outcomes and only two of them changed anything, so
 * the shape's whole job is letting the client tell "the numbers moved" from "the
 * numbers are the same and here is why".
 */

/**
 * What became of a press.
 *
 * - `synced` — the graph was re-read and written whole.
 * - `fresh` — somebody else's refresh landed while this one queued on the lock.
 *   A success: the data the reader wanted is there, they just did not fetch it.
 * - `cooldown` — pressed again too soon; see `retry_after_ms`.
 * - `locked` — a refresh of this league is already running somewhere.
 * - `gone` — Sleeper no longer serves this league. It has been tombstoned.
 * - `failed` — Sleeper was reached and the graph did not come back whole.
 */
export type LeagueSyncStatus =
  | "synced"
  | "fresh"
  | "cooldown"
  | "locked"
  | "gone"
  | "failed";

export type LeagueSyncPayload = {
  league_id: string;
  status: LeagueSyncStatus;
  /**
   * Whether what is stored is now current — true for `synced` and `fresh`, and
   * for nothing else.
   *
   * **Computed on the server rather than derived from `status` on the client**,
   * so the two readers of this fact — the note beside the key, and the decision
   * to re-read the card — cannot come to different conclusions about the same
   * press. A status added later is placed once, here.
   */
  synced: boolean;
  /**
   * How long until a press would be honoured, in milliseconds. **Zero whenever
   * nothing is holding a refresh off**, which includes every status but
   * `cooldown` — a race in particular reports no wait, because the work it lost
   * to has already been done.
   */
  retry_after_ms: number;
  /**
   * When this league's graph was last written whole, ISO-8601, or null for a
   * league nothing has ever successfully synced.
   *
   * The one thing a *refused* answer can honestly report: it names the data the
   * press declined to replace, rather than implying anything about the press.
   */
  updated_at: string | null;
};

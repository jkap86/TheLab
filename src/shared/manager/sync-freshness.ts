/**
 * When a manager's league sync is due, and what "fresh" is allowed to mean.
 *
 * Split out of `sync.ts` and pure — no runtime imports at all, so Node's own
 * runner drives it — because the rule it carries is easy to state and was
 * quietly wrong: **a sync that left leagues behind is not a synced manager.**
 * `manager_syncs` has carried two columns since the crawler landed, with
 * exactly the meanings this module needs, and only one of them was being
 * written honestly:
 *
 * - `attempt_at` — when this manager's list was last *tried*. It is what
 *   throttles the next try, and the crawler's discovery pass stamps it too.
 * - `synced_at` — when the manager's whole league graph was last *completely*
 *   synced. It is what lets a reader be told the list in front of them is
 *   current.
 *
 * `syncManagerLeaguesLocked` used to advance both on every run, including one
 * where a Sleeper timeout dropped three of a hundred leagues — so for the next
 * ten minutes a partial graph was indistinguishable from a complete one, to the
 * route, to the client, and to anything reading the summary. Advancing neither
 * would have been worse: the leagues route decides to refresh on exactly this
 * timestamp, so an upstream failure that never stamps anything is a full
 * ~11-requests-per-league fan-out on *every* request until Sleeper recovers.
 * Hence two timestamps and two questions, which is what the schema already had
 * room for.
 *
 * TheLabX carries a second gate here, `leagueRefreshGate` — the same decision
 * at the other grain, asked of one league instead of a manager's whole graph,
 * and kept in this file because what differs is only who is asking. It arrives
 * with the per-league refresh press it stands behind; nothing here presses one
 * league.
 */

/** How long a **fully successful** sync of the *current* season stays fresh. */
export const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * How long a **fully successful** sync of the season just finished stays fresh.
 *
 * Thirty days, borrowed wholesale from `stats`' {@link STATS_SETTLED_TTL_MS} and
 * for its argument: a finished season is final, so the only thing a re-read buys
 * is healing a graph that stored thin once, and a month is often enough for that
 * and rare enough to cost nothing.
 *
 * **Not `Infinity`, and the season *just* finished is exactly why.**
 * `getActiveSeason` rolls over off Sleeper's `state/nfl`, which names the new
 * league year well before the old one's playoffs settle — and `syncLeagueGraphs`
 * deliberately re-fetches from the stored week *minus one* to catch
 * late-settling waivers, trades and the stat corrections that move a closed
 * week's points. Retiring last season on the day of the rollover freezes it
 * mid-playoffs.
 */
export const SETTLED_SYNC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Which clock a season's league graph is on.
 *
 * The tier the crawler already has for *time* (`./crawl-ttl`), applied to
 * *seasons*: what a re-sync can possibly discover falls away as a season
 * recedes, so the TTL in front of it should too. Nothing about the schema
 * changes — a past season is already its own set of `leagues` rows, because
 * Sleeper mints a new `league_id` per season — and nothing is deleted, since the
 * reads with no manager in the question (the ADP board, the trades market) are
 * what that corpus is kept whole for. What changes is only how often a manager's
 * graph for it is asked about again.
 */
export type SeasonSyncTier =
  /** The season being played. Minutes. */
  | "active"
  /** The season just finished, still inside the correction window. A month. */
  | "settled"
  /** Anything older. Synced once, completely, and then never again. */
  | "archive";

/**
 * Which tier a season sits in, against the season the app is operating in.
 *
 * **An unknown or unparseable season on either side answers `"active"`**, the
 * shortest clock — the `crawl-ttl` rule that a missing date fails toward the
 * fresh tier, and the reason the caller may hand this `peekActiveSeason`'s
 * `undefined` without checking it first. Extra fetches are the failure you can
 * see; the other direction retires a live season on the strength of a value
 * nobody could read.
 *
 * A season *ahead* of the active one is `"active"` too. Sleeper answers an
 * unknown league year with an empty list, and retiring that answer forever would
 * make "this manager has no leagues yet" permanent for the whole of the year
 * before the rollover.
 */
export function seasonSyncTier(
  season: string | null | undefined,
  activeSeason: string | null | undefined,
): SeasonSyncTier {
  const year = seasonYear(season);
  const active = seasonYear(activeSeason);
  if (year === null || active === null || year >= active) return "active";
  return year === active - 1 ? "settled" : "archive";
}

/**
 * How long a complete sync stays fresh on a tier — `Infinity` for the archive,
 * where "fresh" means *final*: the graph is complete, the season cannot change,
 * and there is nothing a re-fetch could learn.
 *
 * `Infinity` rather than a very large number so the retirement is legible at the
 * comparison rather than inferred from a magnitude, and so `now - syncedAt <
 * ttl` needs no special case to express it.
 */
export function syncTtlMsFor(tier: SeasonSyncTier): number {
  if (tier === "settled") return SETTLED_SYNC_TTL_MS;
  if (tier === "archive") return Number.POSITIVE_INFINITY;
  return SYNC_TTL_MS;
}

/** A four-digit year as a number, or null for anything that isn't one. */
function seasonYear(season: string | null | undefined): number | null {
  return season && /^\d{4}$/.test(season) ? Number(season) : null;
}

/**
 * How long *any* attempt suppresses the next one, whatever it achieved.
 *
 * **It is deliberately not tiered, where {@link SYNC_TTL_MS} now is**, and the
 * asymmetry is the point: what a tier lengthens is the quiet a *complete* graph
 * buys, and an incomplete one has bought nothing. A reader who steps the header
 * back to 2019 and loses three leagues to a Sleeper timeout would otherwise wait
 * a month — or forever — to be shown them, on a page where the retry is free and
 * one round of it is all that stands between the graph and the retirement above.
 * So a past season retries on exactly the cadence it always did, and stops the
 * moment it completes. That leaves the equality below describing the active
 * tier, which is the tier it was written about.
 *
 * Deliberately the same duration as {@link SYNC_TTL_MS} rather than shorter,
 * and that is the whole of the retry-storm protection: before this split, a
 * partial sync stamped `synced_at` and so bought exactly this much quiet, and a
 * manager whose leagues keep half-failing must not start costing more upstream
 * traffic than one whose leagues succeed. It is a separate constant because the
 * two answer different questions and only one of them is about the data being
 * current — a future decision to retry a partial sync sooner is a change to
 * this number alone.
 */
export const SYNC_ATTEMPT_TTL_MS = SYNC_TTL_MS;

/** The two timestamps `manager_syncs` keeps for one manager and season. */
export type ManagerSyncState = {
  /** Last **completely** successful sync, or null if there has never been one. */
  syncedAt: Date | null;
  /** Last attempt of any outcome, or null if this manager has never been tried. */
  attemptAt: Date | null;
};

/** Why a sync was or wasn't run — a log line's worth of the decision below. */
export type SyncGateReason =
  /** Nothing suppresses it: run the fan-out. */
  | "due"
  /** A fully successful sync is still inside {@link SYNC_TTL_MS}. */
  | "fresh"
  /** An attempt is inside {@link SYNC_ATTEMPT_TTL_MS} but did not complete. */
  | "throttled"
  /** Someone else synced or tried while this caller was deciding or queueing. */
  | "raced";

export type SyncGate = {
  /** Whether this caller should run the Sleeper fan-out. */
  run: boolean;
  /**
   * Whether what is **stored** is a complete, current graph — a fully successful
   * sync inside the season's own window ({@link syncTtlMsFor}), and nothing
   * else. On the archive tier that window is unbounded, so one complete sync of
   * a finished season is complete forever: the retirement.
   *
   * Deliberately independent of `run` and of `force`: it describes the data, not
   * the decision, so an operator forcing a refresh over a complete graph is
   * still looking at a complete graph until the new one lands.
   */
  complete: boolean;
  reason: SyncGateReason;
};

/**
 * Decide whether a manager's league sync is due.
 *
 * Read by both ends of that decision, which is the point of it being one
 * function: the leagues route asks before it decides to refresh at all, and
 * `syncManagerLeagues` asks again *inside* the per-manager advisory lock, where
 * `requestedAt` is when the caller started queueing rather than now. Two
 * spellings of "is this due" is how a throttle that reads correctly in one place
 * gets bypassed in the other.
 *
 * The order of the tests is the design:
 *
 * 1. **A race is never overridden, not even by `force`.** A timestamp at or
 *    after `requestedAt` means another caller did this work while we waited for
 *    the lock; re-running is the fan-out we queued to avoid. `force` means "the
 *    caller decided a refresh is due", and the winner just did that refresh —
 *    or just tried, which is as good a reason not to try again a millisecond
 *    later.
 * 2. **`force` overrides freshness and the throttle**, which is what an operator
 *    `?refresh=1` is for. It is checked *after* the race tests for that reason.
 * 3. **Freshness before the throttle**, so a complete sync reports `fresh`
 *    rather than the throttle that would also have caught it — the two are
 *    different answers to a caller and to a log.
 *
 * `tier` is the only thing that varies the freshness window, and it defaults to
 * `"active"` so a caller that has no season in hand gets the shortest clock —
 * see {@link seasonSyncTier}, which is the one thing that should ever compute
 * it. The throttle is untiered on purpose; see {@link SYNC_ATTEMPT_TTL_MS}.
 */
export function managerSyncGate(
  state: ManagerSyncState | null,
  {
    now,
    requestedAt,
    force = false,
    tier = "active",
  }: {
    now: number;
    requestedAt: number;
    force?: boolean;
    tier?: SeasonSyncTier;
  },
): SyncGate {
  const syncedAt = state?.syncedAt?.getTime() ?? null;
  const attemptAt = state?.attemptAt?.getTime() ?? null;
  const complete = syncedAt !== null && now - syncedAt < syncTtlMsFor(tier);

  if (syncedAt !== null && syncedAt >= requestedAt) {
    return { run: false, complete, reason: "raced" };
  }
  if (attemptAt !== null && attemptAt >= requestedAt) {
    return { run: false, complete, reason: "raced" };
  }
  if (force) return { run: true, complete, reason: "due" };
  if (complete) return { run: false, complete, reason: "fresh" };
  if (attemptAt !== null && now - attemptAt < SYNC_ATTEMPT_TTL_MS) {
    return { run: false, complete, reason: "throttled" };
  }
  return { run: true, complete, reason: "due" };
}

/**
 * What `leagues.updated_at` holds for a row whose graph has **never** been
 * successfully persisted.
 *
 * `updated_at` means one thing — when this league's graph was last written
 * whole — and a row can exist without that ever having happened: a league
 * discovered, inserted, and left partial because Sleeper answered its users or
 * rosters with nothing. Taking the column's `DEFAULT now()` there made a graph
 * nobody had ever read look like one refreshed this second, and bought it a
 * full freshness TTL of quiet on its very first tick.
 *
 * The column is `NOT NULL`, so the honest value is the oldest one there is
 * rather than an absent one — which needs no migration and reads correctly in
 * the two places freshness is *compared*: such a league is always past the TTL
 * and always in the starved tier. The two places it is *reported* ask
 * {@link hasBeenRefreshed} instead, because "1970" is not a sync time to print
 * and an age of fifty-six years is not a backlog to warn about.
 *
 * What stops that from being a retry loop is `sync_attempt_at`, which is the
 * other half of this module's own rule: freshness says whether work is needed,
 * the attempt says how often it may be tried.
 */
export const NEVER_REFRESHED_SQL = "'epoch'::timestamptz";

/** The same instant as epoch milliseconds, for the readers comparing in JS. */
export const NEVER_REFRESHED_AT = 0;

/**
 * Whether a `leagues.updated_at` names a real refresh rather than
 * {@link NEVER_REFRESHED_SQL}.
 *
 * `<=` rather than `===` so a clock skew, a migration or a hand-written row
 * landing anywhere at or before the epoch still reads as never synced — the
 * conservative direction, since the cost is one extra crawl and the other way
 * round is a league reported fresh on the strength of a timestamp nobody wrote.
 */
export function hasBeenRefreshed(updatedAt: Date | null): boolean {
  return updatedAt !== null && updatedAt.getTime() > NEVER_REFRESHED_AT;
}

/**
 * Record a sync attempt: `$1` user, `$2` season, `$3` whether it completed.
 *
 * `attempt_at` advances unconditionally — that is what the next caller's
 * throttle reads, so a failed run has to move it or the failure becomes a retry
 * loop. `synced_at` advances **only** on a complete run and otherwise keeps
 * whatever it held, so a manager who was fully synced an hour ago and partially
 * synced a minute ago still reports the hour-old success rather than losing it.
 *
 * A string constant rather than an inline query, and pinned by a test: the
 * conditional half is invisible to a type and exactly the kind of thing a later
 * edit flattens back to `synced_at = now()`.
 */
export const MANAGER_SYNC_STAMP_SQL = `
  INSERT INTO manager_syncs (user_id, season, synced_at, attempt_at)
  VALUES ($1, $2, CASE WHEN $3::boolean THEN now() ELSE NULL END, now())
  ON CONFLICT (user_id, season) DO UPDATE
     SET attempt_at = now(),
         synced_at = CASE WHEN $3::boolean THEN now()
                          ELSE manager_syncs.synced_at END`;

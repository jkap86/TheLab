import {
  bulkInsert,
  jsonb as j,
  LOCK_KEYS,
  msInterval,
  pool,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { getActiveSeason } from "@/shared/season";
import { fetchWeekStats, getNflState } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import {
  ARCHIVE_EMPTY_CONFIRMATIONS,
  ARCHIVE_EMPTY_RETRY_MS,
  archiveStampFreshSql,
} from "./archive-clock";
import { toStatRows } from "./parse";
import type { StatRow } from "./parse";
import { validateWeekStats } from "./validate";
import {
  allRegularWeeks,
  archiveSeasons,
  liveWeeks,
  previousSeason,
  settledWeeks,
} from "./weeks";

/**
 * How long a live week's stored stats stay fresh.
 *
 * An hour. Two things move inside it and neither moves faster than that is worth
 * chasing: a week fills in game by game across five days, and the NFL's own
 * corrections land through the following Tuesday. This is not a live-scoring
 * feed and must not be mistaken for one — nothing in this app reads a stat line
 * to tell a reader what is happening right now, it reads them to average a
 * season.
 */
export const STATS_TTL_MS = 60 * 60 * 1000;

/**
 * How long a settled week stays fresh.
 *
 * Thirty days, which is as close to "never again" as a TTL gate gets. A week
 * outside the correction window is *final* — the same request returns the same
 * bytes forever — so the only thing a re-read buys is healing a week that stored
 * thin once, and a month is often enough for that and rare enough that a
 * finished season costs a few hundred megabytes a year rather than a week.
 *
 * The previous season rides this same clock, for the same reason: it is
 * finished too.
 */
export const STATS_SETTLED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How far back the archive reaches — every finished season behind the previous
 * one, down to this floor, which is the comps pool's depth.
 *
 * **The floor is a runaway stop, not a claim about what Sleeper carries.** How
 * deep the source actually goes is discovered by fetching: an archive week is
 * fetched at most {@link ARCHIVE_EMPTY_CONFIRMATIONS} times (see `./archive-clock`),
 * so a season the feed doesn't have answers eighteen empty weeks, each retired
 * once a second probe agrees, and — storing no rows — never appears in
 * `listStoredSeasons` or anywhere downstream. The oldest season on the comps
 * board is therefore exactly the oldest one the source has, and a dead season's
 * whole lifetime cost is two passes of probes rather than one. 2000 sits below
 * any plausible NFL stats feed, so the stop never truncates real data.
 */
export const STATS_ARCHIVE_FLOOR_SEASON = "2000";

/**
 * Settled and archive weeks fetched per run, so the backfill trickles instead
 * of arriving as one very large tick.
 *
 * The `HORIZON_WEEKS_PER_TICK` shape and the same argument: a tick that pulls
 * a whole season at once is a burst on Sleeper and a long stretch of held
 * advisory lock. Six is sized against the archive it now feeds — ~450
 * once-ever weeks, walked in about six hours at the loop's five-minute tick —
 * while staying a bounded burst: each response is ~5MB fetched sequentially,
 * so a full tick is ~30MB spread over the seconds it takes, not a spike.
 */
export const SETTLED_WEEKS_PER_TICK = 6;

const COLUMNS = [
  "season", "week", "player_id", "company", "team", "opponent", "game_id",
  "game_date", "pts_std", "pts_half_ppr", "pts_ppr", "stats",
  "source_updated_at",
];

const ON_CONFLICT = `(season, week, player_id) DO UPDATE SET
    company = EXCLUDED.company, team = EXCLUDED.team,
    opponent = EXCLUDED.opponent, game_id = EXCLUDED.game_id,
    game_date = EXCLUDED.game_date, pts_std = EXCLUDED.pts_std,
    pts_half_ppr = EXCLUDED.pts_half_ppr, pts_ppr = EXCLUDED.pts_ppr,
    stats = EXCLUDED.stats, source_updated_at = EXCLUDED.source_updated_at,
    updated_at = now()`;

/** One `(season, week)` the sync was asked to cover, and on which clock. */
type Target = { season: string; week: number; settled: boolean };

/** What one week's sync did. */
export type StatWeekSyncResult = {
  season: string;
  week: number;
  /** Rows upserted. */
  rows: number;
  /** Rows deleted because Sleeper no longer carries them for the week. */
  removed: number;
};

export type StatsSyncSummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  season: string;
  /** Weeks fetched and written. */
  synced: StatWeekSyncResult[];
  /** Weeks skipped because the stored rows were still inside the TTL. */
  fresh: { season: string; week: number }[];
  /**
   * Settled weeks that were due but past {@link SETTLED_WEEKS_PER_TICK}, left
   * for the next run. Reported rather than folded into `fresh`, the
   * `ProjectionsSyncSummary.deferred` rule: a capped week is stale and a fresh
   * one isn't, and a cap that reads as "nothing to do" is how a backfill
   * silently stops making progress.
   */
  deferred: { season: string; week: number }[];
  /** Weeks Sleeper had no stat lines for — not played yet. Nothing written. */
  empty: { season: string; week: number }[];
  /** Weeks whose fetch or write failed. Logged, retried on a later tick. */
  failed: { season: string; week: number }[];
  /**
   * Weeks whose payload was refused as incomplete — nothing written, no
   * freshness stamp, so the stored week is untouched and the next tick tries
   * again. Separate from `failed` because the fetch *succeeded*: what was
   * rejected is the data. See `./validate`.
   */
  rejected: { season: string; week: number; reason: string }[];
};

/**
 * Which of `targets` are stale, judged on when the week was last *fetched*
 * rather than on the rows it left.
 *
 * **This gate cannot read the data, and that is the `projection_week_syncs`
 * lesson with a sharper edge.** A week nobody has played yet has no stat lines
 * at all, and neither does a bye-heavy week for the teams that were idle — so a
 * gate reading `player_week_stats` would find those weeks unsynced forever,
 * refetch them every tick, and, because the per-tick cap takes the earliest
 * stale weeks first, crowd out weeks that do have something to store.
 * `stat_week_syncs` stamps the attempt.
 *
 * A null `ttlMs` means the **archive clock**: a week that stored rows is fresh
 * forever — a years-old week's numbers never move again, and a season the feed
 * doesn't carry must cost its probes a fixed number of times rather than one
 * per tick. What it is *not* is "one probe whatever came back": an empty answer
 * is observed rather than believed, so it takes two of them a day apart to
 * retire a week. That rule and this fragment are `./archive-clock`, together.
 * A failed or refused fetch still stamps nothing, so those retry on either
 * clock.
 */
async function staleTargets(
  targets: readonly Target[],
  ttlMs: number | null,
): Promise<Target[]> {
  if (targets.length === 0) return [];

  const params: unknown[] = [
    targets.map((t) => t.season),
    targets.map((t) => t.week),
  ];
  let stampIsFresh: string;
  if (ttlMs !== null) {
    params.push(msInterval(ttlMs));
    stampIsFresh = `s.synced_at > now() - $3::interval`;
  } else {
    params.push(ARCHIVE_EMPTY_CONFIRMATIONS, msInterval(ARCHIVE_EMPTY_RETRY_MS));
    stampIsFresh = archiveStampFreshSql("$3", "$4");
  }

  const { rows } = await pool.query<{ season: string; week: number }>(
    `SELECT t.season, t.week
       FROM unnest($1::varchar[], $2::int[]) AS t(season, week)
      WHERE NOT EXISTS (
            SELECT 1
              FROM stat_week_syncs s
             WHERE s.season = t.season
               AND s.week = t.week
               AND ${stampIsFresh})`,
    params,
  );

  const due = new Set(rows.map((r) => `${r.season}:${r.week}`));
  return targets.filter((t) => due.has(`${t.season}:${t.week}`));
}

/**
 * How many rows are stored for a `(season, week)` — the population a fresh
 * payload's completeness is judged against. Zero is a first sync of that week.
 */
async function storedWeekCount(season: string, week: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM player_week_stats WHERE season = $1 AND week = $2`,
    [season, week],
  );
  return Number(rows[0].count);
}

/**
 * Stamp a week as fetched, empty or not — the marker {@link staleTargets} reads.
 *
 * `empty` is what the archive clock counts. An empty answer *increments* the
 * observation count and a non-empty one resets it to 0, so a week that stored
 * rows is retired as a stored week however many empties preceded it, and a week
 * that keeps answering empty retires on the second one rather than the first.
 * The count is clamped at the confirmation threshold: past it nothing changes,
 * and a `SMALLINT` that only ever grows would eventually be a different bug.
 */
function markWeekSynced(
  season: string,
  week: number,
  options: { empty: boolean },
): Promise<unknown> {
  return pool.query(
    `INSERT INTO stat_week_syncs (season, week, synced_at, empty_observations)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (season, week) DO UPDATE SET
       synced_at = now(),
       empty_observations = CASE
         WHEN $3 = 0 THEN 0
         ELSE least(stat_week_syncs.empty_observations + 1, $4::int)
       END`,
    [season, week, options.empty ? 1 : 0, ARCHIVE_EMPTY_CONFIRMATIONS],
  );
}

/**
 * Replace one week's stat lines with `rows`, in a single transaction so readers
 * never see a half-written week.
 *
 * The delete is what keeps a line Sleeper has withdrawn — a player credited in
 * error and corrected out — from sitting there looking like a played game and
 * quietly deflating his average. Only reachable with a non-empty `rows`, so an
 * upstream hiccup returning nothing can never empty a week.
 */
function writeWeek(
  season: string,
  week: number,
  rows: StatRow[],
): Promise<number> {
  return withTransaction(async (client) => {
    await bulkInsert(client, {
      table: "player_week_stats",
      columns: COLUMNS,
      rows,
      values: (r) => [
        r.season, r.week, r.player_id, r.company, r.team, r.opponent, r.game_id,
        r.game_date, r.pts_std, r.pts_half_ppr, r.pts_ppr, j(r.stats),
        r.source_updated_at,
      ],
      trailing: { column: "updated_at", sql: "now()" },
      onConflict: ON_CONFLICT,
    });

    const { rowCount } = await client.query(
      `DELETE FROM player_week_stats
         WHERE season = $1 AND week = $2 AND player_id <> ALL($3::varchar[])`,
      [season, week, rows.map((r) => r.player_id)],
    );
    return rowCount ?? 0;
  });
}

/**
 * Fetch and store actual weekly stat lines.
 *
 * With no options it covers every week the NFL has played this season, the
 * whole of the season before it, and every finished season behind that down to
 * {@link STATS_ARCHIVE_FLOOR_SEASON}, on three clocks: the week being played
 * and the one still being corrected are refreshed hourly, the settled and
 * previous-season weeks monthly, and an archive week **once if the fetch stored
 * anything, twice if it answered empty** (`./archive-clock`) — the slow tiers
 * sharing one per-run cap (see {@link SETTLED_WEEKS_PER_TICK}), settled first,
 * so the backfill trickles and last season fills before the deep ones do.
 *
 * **The previous season is not an optional extra.** A points-per-game average is
 * counted over the weeks *before* the one on screen, so in week 1 there is
 * nothing this season to average and the only honest number is what the player
 * did last year. Syncing it here is what makes that fallback real rather than a
 * branch that always reaches an empty table.
 *
 * Pass `weeks` (with `season`) to backfill specific ones — that skips the
 * tiering and the cap entirely and fetches exactly what was asked for, which is
 * how a season older than the previous one is ever picked up.
 *
 * `force` applies to the live window only, the `syncProjections` rule: forcing is
 * for "this week's numbers look wrong", and a flag that quietly turned into a
 * two-season re-download would be a footgun.
 *
 * Weeks are fetched one at a time on purpose — each response is multiple
 * megabytes, so parallelising them would put tens of megabytes in flight and in
 * memory at once for no useful latency win in a background loop.
 *
 * Held under an advisory lock, including the freshness gate, so whichever
 * instance wins is the one that decides what needs fetching and extra dynos
 * sharing a database don't each pull the same week.
 */
export async function syncStats(
  options: {
    season?: string;
    weeks?: number[];
    force?: boolean;
    ttlMs?: number;
    settledTtlMs?: number;
    settledPerRun?: number;
    archiveFloor?: string;
  } = {},
): Promise<StatsSyncSummary> {
  const {
    force = false,
    ttlMs = STATS_TTL_MS,
    settledTtlMs = STATS_SETTLED_TTL_MS,
    settledPerRun = SETTLED_WEEKS_PER_TICK,
    archiveFloor = STATS_ARCHIVE_FLOOR_SEASON,
  } = options;

  const summary = await withAdvisoryLock(LOCK_KEYS.playerStats, async () => {
    const explicitWeeks = options.weeks?.length ? options.weeks : null;

    let state = null;
    if (!options.season || !explicitWeeks) {
      try {
        state = await getNflState();
      } catch (error) {
        console.warn(
          "[stats] NFL state unavailable; falling back to defaults:",
          errorMessage(error),
        );
      }
    }

    // The state read above is the same call the resolver makes, so it wins when
    // it worked; the resolver is the ladder underneath it.
    const season = options.season ?? state?.season ?? (await getActiveSeason());

    // An explicit backfill is exactly what was asked for, on the settled clock:
    // a named week is a deliberate act, and every week worth naming is one whose
    // games are behind us.
    const live: Target[] = explicitWeeks
      ? []
      : liveWeeks(state).map((week) => ({ season, week, settled: false }));

    const prior = previousSeason(season);

    const settled: Target[] = explicitWeeks
      ? explicitWeeks.map((week) => ({ season, week, settled: true }))
      : [
          ...settledWeeks(state).map((week) => ({ season, week, settled: true })),
          // Newest week first, so a cold database fills the end of last season —
          // the form a reader coming into week 1 is actually asking about —
          // before it fills the start of it.
          ...(prior
            ? allRegularWeeks()
                .reverse()
                .map((week) => ({ season: prior, week, settled: true }))
            : []),
        ];

    // The archive: every finished season behind the previous one down to the
    // floor, fetched once each. Never part of an explicit backfill (that names
    // its own weeks), and behind the settled tier in the queue, so a cold
    // database fills last season before it reaches for the deep ones — newest
    // season first, newest week first, the same convergence rule as the tier
    // above it.
    const archive: Target[] = explicitWeeks
      ? []
      : archiveSeasons(season, archiveFloor).flatMap((s) =>
          allRegularWeeks()
            .reverse()
            .map((week) => ({ season: s, week, settled: true })),
        );

    const liveDue = force ? live : await staleTargets(live, ttlMs);
    const settledStale = await staleTargets(settled, settledTtlMs);
    // The archive clock: a week that stored rows is retired at once, and one
    // that answered empty is retired only when a second probe a day later
    // agrees. That is what makes probing past the feed's real floor affordable
    // without letting one bad minute upstream lose a real historical week.
    const archiveStale = await staleTargets(archive, null);
    // One cap over both slow tiers: the trickle is about the burst on Sleeper,
    // and two caps would be twice the burst under another name.
    const slowStale = [...settledStale, ...archiveStale];
    const slowDue = slowStale.slice(0, Math.max(0, settledPerRun));
    const deferred = slowStale.slice(slowDue.length);

    const due = [...liveDue, ...slowDue];
    const key = (t: { season: string; week: number }) => `${t.season}:${t.week}`;
    const dueKeys = new Set(due.map(key));
    const deferredKeys = new Set(deferred.map(key));
    const fresh = [...live, ...settled, ...archive]
      .filter((t) => !dueKeys.has(key(t)) && !deferredKeys.has(key(t)))
      .map(({ season: s, week }) => ({ season: s, week }));

    const synced: StatWeekSyncResult[] = [];
    const empty: { season: string; week: number }[] = [];
    const failed: { season: string; week: number }[] = [];
    const rejected: { season: string; week: number; reason: string }[] = [];

    for (const target of due) {
      const { season: s, week } = target;
      try {
        const entries = await fetchWeekStats(s, week);
        const rows = toStatRows(entries, s, week);

        if (rows.length === 0) {
          // A week that has not been played answers 200 with placeholders, so
          // this is a normal state rather than an error. Still a successful
          // fetch: stamp it so the week waits out its TTL instead of being
          // refetched every tick for as long as the season is ahead of us.
          //
          // Stamped as *empty*, which is what stops the archive clock treating
          // one blip upstream as proof the feed has no such week — see
          // `./archive-clock`.
          await markWeekSynced(s, week, { empty: true });
          empty.push({ season: s, week });
          continue;
        }

        // Completeness gate, outside the transaction on purpose: a refusal must
        // leave the stored week byte-for-byte as it was, and the cheapest way to
        // guarantee that is never to open the transaction that deletes.
        const previous = await storedWeekCount(s, week);
        const validation = validateWeekStats(rows, previous, {
          settled: target.settled,
        });
        if (!validation.ok) {
          console.error(
            `[stats] Refused a suspicious payload for ${s} week ${week}: ` +
              `${validation.reason} (previous=${validation.previous} ` +
              `valid=${validation.valid} rejected=${validation.rejected} ` +
              `parsed=${rows.length}). Stored rows left untouched.`,
          );
          // No `markWeekSynced`: the week stays stale so the next tick retries.
          rejected.push({ season: s, week, reason: validation.reason });
          continue;
        }

        const removed = await writeWeek(s, week, validation.rows);
        await markWeekSynced(s, week, { empty: false });
        synced.push({ season: s, week, rows: validation.rows.length, removed });
      } catch (error) {
        failed.push({ season: s, week });
        console.warn(
          `[stats] Sync failed for ${s} week ${week}:`,
          errorMessage(error),
        );
      }
    }

    return {
      locked: false, season, synced, fresh, deferred, empty, failed, rejected,
    };
  });

  return (
    summary ?? {
      locked: true,
      season: options.season ?? (await getActiveSeason()),
      synced: [],
      fresh: [],
      deferred: [],
      empty: [],
      failed: [],
      rejected: [],
    }
  );
}

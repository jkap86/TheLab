import { COMPS_FIELDS } from "./fields.ts";

import type { CompsBasis } from "./filters.ts";
import type { CompsPoolRow } from "./knn.ts";

/**
 * Weekly stat lines into pool rows — the riskiest transformations in the tool,
 * pure so every one is pinned by a test rather than believed: which stat keys
 * are read, what counts as a game, what absence means in each family.
 *
 * `pool.ts` is the thin I/O that fetches these inputs and calls this; nothing
 * in it decides anything.
 */

/** One stored weekly line, as `listSeasonStatLines` returns it. */
export type CompsStatLineInput = {
  player_id: string;
  stats: Record<string, number> | null;
};

/** A player's identity and birth date, `getPlayerProfiles`'s shape. */
export type CompsProfileInput = {
  name: string;
  position: string | null;
  team: string | null;
  birth_date: string | null;
};

/** KTC per player id, both boards; null where a board says nothing. */
export type CompsKtcInput = Record<
  string,
  { sf: number | null; oneqb: number | null }
>;

/**
 * ADP per player id — structurally `PlayerBoardAdp`, so `pool.ts` hands the
 * manager module's answer straight through. A null board is "too few picks to
 * average", which stays null here: an unaveraged market is unknown, not free.
 */
export type CompsAdpInput = ReadonlyMap<
  string,
  { redraft: { adp: number } | null; dynasty: { adp: number } | null }
>;

const PRODUCTION_FIELDS = COMPS_FIELDS.filter(
  (field) => field.family === "production",
);

/**
 * Sleeper's own totals on a stored line — the keys `scoreStatLine` refuses to
 * score (they restate an answer rather than naming an event), summed here for
 * exactly that reason: they *are* the answer, and "how did that season go" is
 * the question every comp exists to be asked.
 */
const POINTS_KEYS = ["pts_ppr", "pts_half_ppr", "pts_std"] as const;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Decimal age at the season's Sept 1 — always Sept 1, never the market anchor:
 * how old a player was entering the season is a fact about the season, and the
 * birth date is time-invariant, so age-at-season is exact even for a
 * historical row. Null for an unparseable date or one after the anchor (a
 * player born in the future is a junk blob, not an infant quarterback).
 */
export function ageAtSeasonStart(
  birthDate: string | null,
  season: string,
): number | null {
  if (birthDate === null) return null;
  const birth = Date.parse(`${birthDate}T00:00:00Z`);
  const anchor = Date.parse(`${season}-09-01T00:00:00Z`);
  if (!Number.isFinite(birth) || !Number.isFinite(anchor)) return null;
  const age = (anchor - birth) / MS_PER_YEAR;
  if (age <= 0) return null;
  return Math.round(age * 100) / 100;
}

export function assemblePoolRows({
  statLines,
  profiles,
  ktc,
  adp,
  season,
}: {
  statLines: readonly CompsStatLineInput[];
  profiles: Record<string, CompsProfileInput>;
  ktc: CompsKtcInput;
  adp: CompsAdpInput;
  season: string;
}): CompsPoolRow[] {
  // One accumulator per player: games, production and point totals in a
  // single pass.
  const byPlayer = new Map<
    string,
    { games: number; totals: Record<string, number>; points: number[] }
  >();

  for (const line of statLines) {
    let entry = byPlayer.get(line.player_id);
    if (!entry) {
      const totals: Record<string, number> = {};
      for (const field of PRODUCTION_FIELDS) totals[field.key] = 0;
      entry = { games: 0, totals, points: [0, 0, 0] };
      byPlayer.set(line.player_id, entry);
    }

    // A stored row is a game played — `hasStatLine` is the ingestion filter
    // (a line hangs off a game_id; a dressed player who did nothing still
    // carries `gp`), so counting rows is `playerPpg`'s own denominator. A
    // second spelling of "games played" here would be the drift to avoid.
    entry.games += 1;

    // An absent production key is a real 0: Sleeper omits what didn't happen,
    // which is the opposite reading from the market fields' null-is-unknown.
    const stats = line.stats;
    if (!stats) continue;
    for (const field of PRODUCTION_FIELDS) {
      const value = stats[field.statKey as string];
      if (typeof value === "number" && Number.isFinite(value)) {
        entry.totals[field.key] += value;
      }
    }
    for (const [i, key] of POINTS_KEYS.entries()) {
      const value = stats[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        entry.points[i] += value;
      }
    }
  }

  const rows: CompsPoolRow[] = [];
  for (const [player_id, entry] of byPlayer) {
    const profile = profiles[player_id];
    const marketKtc = ktc[player_id];
    const marketAdp = adp.get(player_id);

    const values: Record<string, number | null> = {};
    for (const field of PRODUCTION_FIELDS) {
      // Summed floats carry binary noise; two decimals is the precision the
      // stats are quoted at.
      values[field.key] = Math.round(entry.totals[field.key] * 100) / 100;
    }
    values.age = ageAtSeasonStart(profile?.birth_date ?? null, season);
    values.ktc_sf = marketKtc?.sf ?? null;
    values.ktc_oneqb = marketKtc?.oneqb ?? null;
    values.adp_dynasty = marketAdp?.dynasty?.adp ?? null;
    values.adp_redraft = marketAdp?.redraft?.adp ?? null;

    rows.push({
      player_id,
      season,
      // An id the players cache doesn't know still rows — its stats are real —
      // under its id as a name and no position, which every position-filtered
      // population then excludes.
      name: profile?.name ?? player_id,
      position: profile?.position ?? null,
      team: profile?.team ?? null,
      games: entry.games,
      values,
      points: {
        ppr: round2(entry.points[0]),
        half_ppr: round2(entry.points[1]),
        std: round2(entry.points[2]),
      },
    });
  }
  return rows;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The whole season as one line — every production total plus the three
 * fantasy-point totals, resolved under the basis exactly as the weighted
 * fields are (per-game divides by games; a zero-game season has no per-game
 * reading and answers null).
 *
 * This is what "how did that season go" reads off: a comp is picked on the
 * weighted criteria, and this line is the outcome those criteria led to,
 * whatever was weighted.
 */
export function seasonLine(
  row: CompsPoolRow,
  basis: CompsBasis,
): Record<string, number | null> {
  const perGame = basis === "per_game";
  const resolve = (total: number): number | null =>
    perGame ? (row.games > 0 ? total / row.games : null) : total;

  const line: Record<string, number | null> = {};
  for (const field of PRODUCTION_FIELDS) {
    line[field.key] = resolve(
      typeof row.values[field.key] === "number"
        ? (row.values[field.key] as number)
        : 0,
    );
  }
  line.pts_ppr = resolve(row.points.ppr);
  line.pts_half_ppr = resolve(row.points.half_ppr);
  line.pts_std = resolve(row.points.std);
  return line;
}

import { draftCapital } from "../nfl-draft/capital.ts";
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
  week: number;
  /**
   * The team the player was on *that week* — the row's own attribution, which
   * is what makes a usage share honest across a trade. Null where the feed
   * didn't say, which excludes the line from both ends of a share rather than
   * filing it under a guessed team.
   */
  team: string | null;
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

/**
 * KTC history per player id — peak and trend entering the season, both nullable
 * on the market family's terms: a season before KTC existed, or a player its
 * board never carried, is unknown and never zero.
 */
export type CompsKtcHistoryInput = Record<
  string,
  { peak: number | null; trend: number | null }
>;

/**
 * NFL draft picks per player id — `getNflDraftPicks`'s own map, handed straight
 * through.
 *
 * **A missing key is unknown; a present entry with a null `overall` is
 * undrafted.** That distinction is the map's whole contract and the reason this
 * arrives as a `Map` rather than as a nullable number per player: a number
 * cannot carry it, and flattening it here would lose it for every reader
 * downstream. `draftCapital` is the one place it becomes a value.
 *
 * Time-invariant, like the birth date beside it: where a player was drafted is
 * the same fact in every season of his career, so unlike the KTC and ADP inputs
 * it needs no anchor and a historical row is exact rather than as-of.
 */
export type CompsDraftInput = ReadonlyMap<
  string,
  { season: string; round: number | null; slot: number | null; overall: number | null }
>;

/** The production fields read straight off a line — the derived ones aren't. */
const STAT_FIELDS = COMPS_FIELDS.filter(
  (field) => field.family === "production" && field.derived !== true,
);

/**
 * The line-read fields whose keys are unverified, so absent-is-zero only holds
 * in a season whose feed demonstrably carries the key — see `gated` in the
 * catalogue.
 */
const GATED_FIELDS = STAT_FIELDS.filter((field) => field.gated === true);

/**
 * Every unverified *stat key* worth watching for: the gated fields' own keys
 * plus the raw keys the derived fields are computed from. Tracked as stat keys
 * rather than field keys because the two part company — `tm_off_snp` is a
 * denominator no field is named after, and `snap_pct` is a field named after no
 * key.
 */
const WATCHED_KEYS: readonly string[] = [
  ...new Set([
    ...GATED_FIELDS.map((field) => field.statKey as string),
    ...COMPS_FIELDS.flatMap((field) => field.requires ?? []),
  ]),
];

/** Per derived field, the keys its season's feed has to carry to answer it. */
const REQUIRED_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  COMPS_FIELDS.filter((field) => field.derived === true).map((field) => [
    field.key,
    field.requires ?? [],
  ]),
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

/** A finite stat off a line, else 0 — the absent-is-zero production rule. */
const stat = (
  stats: Record<string, number> | null,
  key: string,
): number => finite(stats?.[key]) ?? 0;

/**
 * A finite number or null — the *other* reading, for the keys whose absence is
 * unknown rather than zero: a week with no snap count says nothing about how
 * many snaps were played, where a week with no reception says there were none.
 */
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The datasets that ride *onto* an assembled row rather than being read off its
 * stat lines — each one an expensive query of its own, each loaded only where
 * the board being run weighs a field that names it (`enrichment.ts`).
 *
 * **Every one is optional, and absent means unknown rather than zero** — the
 * market family's own rule, which is exactly what makes a base pool a
 * legitimate pool: it answers null for the fields nobody weighted, which is the
 * same thing it would answer for a player those sources have never heard of.
 */
export type CompsEnrichmentInputs = {
  ktc?: CompsKtcInput;
  ktcHistory?: CompsKtcHistoryInput;
  adp?: CompsAdpInput;
  draft?: CompsDraftInput;
};

/**
 * A season's weekly lines into pool rows.
 *
 * The datasets are accepted here as well as by {@link applyCompsEnrichment} —
 * one call for a caller that has them in hand — but the read does not use that
 * form: it assembles the base rows once, caches them, and merges whichever
 * datasets a board actually asked for on top. Handed none, this is exactly that
 * base row.
 */
export function assemblePoolRows({
  statLines,
  profiles,
  season,
  ...enrichment
}: {
  statLines: readonly CompsStatLineInput[];
  profiles: Record<string, CompsProfileInput>;
  season: string;
} & CompsEnrichmentInputs): CompsPoolRow[] {
  // One accumulator per player: games, production and point totals in a
  // single pass. The share numerators are tracked apart from the totals —
  // they sum only the team-attributed lines, so numerator and denominator
  // always describe the same weeks.
  const byPlayer = new Map<
    string,
    {
      games: number;
      totals: Record<string, number>;
      points: number[];
      cells: string[];
      shareTgt: number;
      shareRush: number;
      /** Snaps and team snaps over the weeks carrying *both* keys. */
      snapPlayer: number;
      snapTeam: number;
      /** Snaps, and the targets from the same weeks — a different week set. */
      snaps: number;
      snapTgt: number;
    }
  >();

  // Team-week usage totals, the share denominators: what the whole team threw
  // and ran in each week, keyed by the row's own team attribution.
  const teamTgt = new Map<string, number>();
  const teamRush = new Map<string, number>();

  // The season's vocabulary for the gated keys: one line carrying the key is
  // proof the feed publishes it this season, and a player without it is then a
  // real zero. No line carrying it means the season can't answer the field —
  // for anyone — and null is the only honest reading.
  const vocabulary = new Set<string>();

  for (const line of statLines) {
    let entry = byPlayer.get(line.player_id);
    if (!entry) {
      const totals: Record<string, number> = {};
      for (const field of STAT_FIELDS) totals[field.key] = 0;
      entry = {
        games: 0,
        totals,
        points: [0, 0, 0],
        cells: [],
        shareTgt: 0,
        shareRush: 0,
        snapPlayer: 0,
        snapTeam: 0,
        snaps: 0,
        snapTgt: 0,
      };
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
    if (stats) {
      for (const field of STAT_FIELDS) {
        entry.totals[field.key] += stat(stats, field.statKey as string);
      }
      for (const key of WATCHED_KEYS) {
        if (!vocabulary.has(key) && key in stats) vocabulary.add(key);
      }
      for (const [i, key] of POINTS_KEYS.entries()) {
        entry.points[i] += stat(stats, key);
      }

      // The snap rates, each summed only over the weeks that can answer it:
      // targets-per-snap over the weeks carrying snaps, snap share over the
      // weeks carrying snaps *and* the team's. A numerator counting a week its
      // denominator never saw is the failure the usage shares below already
      // avoid by pairing on team-weeks.
      const snaps = finite(stats.off_snp);
      if (snaps !== null) {
        entry.snaps += snaps;
        entry.snapTgt += stat(stats, "rec_tgt");
        const teamSnaps = finite(stats.tm_off_snp);
        if (teamSnaps !== null) {
          entry.snapPlayer += snaps;
          entry.snapTeam += teamSnaps;
        }
      }
    }

    if (line.team !== null) {
      const cell = `${line.team}:${line.week}`;
      entry.cells.push(cell);
      const tgt = stat(stats, "rec_tgt");
      const rush = stat(stats, "rush_att");
      entry.shareTgt += tgt;
      entry.shareRush += rush;
      teamTgt.set(cell, (teamTgt.get(cell) ?? 0) + tgt);
      teamRush.set(cell, (teamRush.get(cell) ?? 0) + rush);
    }
  }

  // The team-week denominator a share is taken against: the cells the player
  // actually appeared in, so a midseason trade reads each half against the
  // right offense.
  const teamTotal = (
    cells: readonly string[],
    totals: ReadonlyMap<string, number>,
  ): number => {
    let denominator = 0;
    for (const cell of cells) denominator += totals.get(cell) ?? 0;
    return denominator;
  };

  /** Whether the season's feed carries every key a derived field needs. */
  const answers = (key: string): boolean =>
    (REQUIRED_KEYS[key] ?? []).every((required) => vocabulary.has(required));

  const rows: CompsPoolRow[] = [];
  for (const [player_id, entry] of byPlayer) {
    const profile = profiles[player_id];

    // Every derived rate's own numerator and denominator, scaled so the value
    // is exactly `n / d` whatever the unit — a percentage carries the ×100 in
    // its numerator. That uniformity is what lets a multi-season window pool
    // any of them as Σn / Σd without knowing which rate it is holding.
    const rates: Record<string, { n: number; d: number }> = {};
    const rate = (
      key: string,
      n: number,
      d: number,
      known: boolean,
    ): number | null => {
      // Null where nothing can be attributed, where the denominator is empty,
      // or where the season's feed never published the keys — none of which
      // may read as everyone commanding 0%.
      if (!known || !(d > 0)) return null;
      rates[key] = { n, d };
      return round2(n / d);
    };

    const values: Record<string, number | null> = {};
    for (const field of STAT_FIELDS) {
      // Summed floats carry binary noise; two decimals is the precision the
      // stats are quoted at. A gated field outside the season's vocabulary is
      // unknown, never zero.
      values[field.key] =
        field.gated === true && !vocabulary.has(field.statKey as string)
          ? null
          : round2(entry.totals[field.key]);
    }
    const attributed = entry.cells.length > 0;
    values.tgt_share = rate(
      "tgt_share",
      entry.shareTgt * 100,
      teamTotal(entry.cells, teamTgt),
      attributed,
    );
    values.rush_share = rate(
      "rush_share",
      entry.shareRush * 100,
      teamTotal(entry.cells, teamRush),
      attributed,
    );
    values.snap_pct = rate(
      "snap_pct",
      entry.snapPlayer * 100,
      entry.snapTeam,
      answers("snap_pct"),
    );
    values.tgt_per_snap = rate(
      "tgt_per_snap",
      entry.snapTgt,
      entry.snaps,
      answers("tgt_per_snap"),
    );
    values.age = ageAtSeasonStart(profile?.birth_date ?? null, season);
    // The enrichment-fed fields are written as unknown here and filled in by
    // `applyCompsEnrichment` for whichever datasets were actually loaded, so a
    // base row and an enriched one are the same shape — a reader can't tell "not
    // loaded" from "this source has never heard of him", which is the honest
    // reading either way and the one the market family already had.
    for (const key of ENRICHED_KEYS) values[key] = null;

    rows.push({
      player_id,
      season,
      // An id the players cache doesn't know still rows — its stats are real —
      // under its id as a name and no position, which every position-filtered
      // population then excludes.
      name: profile?.name ?? player_id,
      position: profile?.position ?? null,
      team: profile?.team ?? null,
      // The pick rides beside the capital, the way `position` and `team` ride
      // beside the values: it is what the reader actually wants printed —
      // "1.05", "UDFA" — where the capital is what the distance is measured in.
      // Unknown until the draft dataset is merged on, since it is that dataset's
      // to answer; null there means no record, where a record with a null
      // `overall` means undrafted.
      draft: null,
      games: entry.games,
      values,
      rates,
      points: {
        ppr: round2(entry.points[0]),
        half_ppr: round2(entry.points[1]),
        std: round2(entry.points[2]),
      },
    });
  }
  return applyCompsEnrichment(rows, enrichment);
}

/**
 * The fields no stat line answers — every one fed by a dataset the catalogue
 * names, derived from `reads` rather than listed so a new market field is
 * covered the moment it declares where it comes from.
 */
const ENRICHED_KEYS: readonly string[] = COMPS_FIELDS.filter(
  (field) => field.reads.length > 0,
).map((field) => field.key);

/**
 * The rows with the loaded datasets written onto them — the composition half of
 * the pool, kept pure so what each dataset contributes is a tested fact rather
 * than a read of `pool.ts`.
 *
 * **Only the datasets present are written.** A dataset absent leaves its fields
 * exactly as they were, which is null on a base row: nothing here can turn "not
 * loaded" into a zero, and nothing can overwrite a loaded value with an unknown
 * one by being called twice with different halves.
 *
 * Non-mutating, because the rows it is handed are the frozen cached base pool:
 * every enriched row is a fresh object with a fresh `values`, and the immutable
 * parts (points, rates) are shared rather than copied. Given nothing to write it
 * hands the same array straight back — an identity the memoized passes above it
 * (`withCareerValues`) read as "the corpus has not changed".
 */
export function applyCompsEnrichment(
  rows: readonly CompsPoolRow[],
  { ktc, ktcHistory, adp, draft }: CompsEnrichmentInputs,
): CompsPoolRow[] {
  // The same array, not a copy: the identity is what the memoized passes above
  // this read as "the corpus has not changed". The cast is only the readonly
  // parameter being handed back out.
  if (!ktc && !ktcHistory && !adp && !draft) return rows as CompsPoolRow[];

  return rows.map((row) => {
    const values = { ...row.values };
    if (ktc) {
      const priced = ktc[row.player_id];
      values.ktc_sf = priced?.sf ?? null;
      values.ktc_oneqb = priced?.oneqb ?? null;
    }
    if (ktcHistory) {
      const history = ktcHistory[row.player_id];
      values.ktc_peak_sf = history?.peak ?? null;
      values.ktc_trend_sf = history?.trend ?? null;
    }
    if (adp) {
      const board = adp.get(row.player_id);
      values.adp_dynasty = board?.dynasty?.adp ?? null;
      values.adp_redraft = board?.redraft?.adp ?? null;
    }
    let pick = row.draft;
    if (draft) {
      pick = draft.get(row.player_id) ?? null;
      // Three answers folded to two by one call: a drafted player gets his
      // pick's capital, an undrafted one the shared notch past the last pick,
      // and a player with no record at all gets null — which excludes him from
      // any comparison weighting this, rather than filing him with the
      // undrafted.
      values.draft_capital = draftCapital(
        pick === null ? null : { playerId: row.player_id, ...pick },
      );
    }
    return { ...row, draft: pick, values };
  });
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The whole season as one line — every line-read production total plus the
 * three fantasy-point totals, resolved under the basis exactly as the weighted
 * fields are (per-game divides by games; a zero-game season has no per-game
 * reading and answers null).
 *
 * This is what "how did that season go" reads off: a comp is picked on the
 * weighted criteria, and this line is the outcome those criteria led to,
 * whatever was weighted. The derived shares are deliberately not on it — they
 * are comparison criteria rather than season totals, already rates, and
 * nullable — so they reach the reader the way the profile and market fields
 * do: on `values`, when weighted.
 */
export function seasonLine(
  row: CompsPoolRow,
  basis: CompsBasis,
): Record<string, number | null> {
  const perGame = basis === "per_game";
  const resolve = (total: number): number | null =>
    perGame ? (row.games > 0 ? total / row.games : null) : total;

  const line: Record<string, number | null> = {};
  for (const field of STAT_FIELDS) {
    const raw = row.values[field.key];
    // A gated field the season couldn't answer stays null on the line too —
    // "Air yards 0" for a 2005 season would be the zero-wearing-a-label the
    // gate exists to prevent.
    line[field.key] =
      typeof raw === "number"
        ? resolve(raw)
        : field.gated === true
          ? null
          : resolve(0);
  }
  line.pts_ppr = resolve(row.points.ppr);
  line.pts_half_ppr = resolve(row.points.half_ppr);
  line.pts_std = resolve(row.points.std);
  return line;
}

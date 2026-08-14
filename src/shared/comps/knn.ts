import type { CompsBasis } from "./filters.ts";

/**
 * The KNN itself — pure, so the numbers this tool exists to produce are pinned
 * by tests rather than believed.
 *
 * The pipeline order is fixed and every count in the payload is named against
 * it:
 *
 *   1. position filter
 *   2. `min_games`
 *   3. identity exclusion (the subject's own row)
 *        → `candidates_considered`
 *   4. weighted-field completeness
 *        → `candidates_eligible`, `excluded_missing` per field
 *   5. normalization statistics over the eligible candidates — never the
 *      subject
 *   6. weighted distance, ranking, top k
 *
 * Step 5's population is the design decision worth restating: the subject is
 * **not** in the population its comps are normalized over. The mean cancels in
 * `z_cand − z_subj`, so what the population decides is σ — and a subject
 * included in it inflates σ exactly when the subject is exceptional, shrinking
 * every distance and re-scaling each field per chosen subject. Excluded, the
 * field scaling is a property of the comparison population alone, and the
 * payload's per-field mean/stdev honestly mean "the comparison population".
 */

/**
 * One player-season in the pool. `values` holds season totals for the
 * production fields (an absent stat key was folded to a real 0 at assembly —
 * Sleeper omits what didn't happen) and nullable profile/market values, where
 * null is *unknown* and never zero.
 */
export type CompsPoolRow = {
  player_id: string;
  season: string;
  name: string;
  position: string | null;
  /** The player's *current* team — `players` stores no historical team. */
  team: string | null;
  /** Games played: the count of stored weekly lines, `playerPpg`'s own rule. */
  games: number;
  values: Record<string, number | null>;
};

/** A field as the KNN weighs it: resolved key, positive weight, basis rule. */
export type CompsFieldSpec = {
  key: string;
  weight: number;
  perGame: boolean;
};

/** Per-field normalization statistics over the eligible candidates. */
export type CompsFieldStats = {
  key: string;
  /** Null only when no candidate was eligible — there is no population. */
  mean: number | null;
  stdev: number | null;
};

export type CompsResult = {
  row: CompsPoolRow;
  distance: number;
  similarity: number;
};

export type CompsKnnOutput = {
  results: CompsResult[];
  fieldStats: CompsFieldStats[];
  /** Rows surviving position, min_games and identity — steps 1–3. */
  candidatesConsidered: number;
  /** Rows also carrying every weighted field — the KNN population. */
  candidatesEligible: number;
  /**
   * Exclusions per field key. A candidate missing several weighted fields
   * increments each while removing one row, so the counts sum to at least
   * `candidatesConsidered − candidatesEligible` rather than exactly.
   */
  excludedMissing: Record<string, number>;
};

/**
 * A field's value for a row under the basis — the one resolution both the
 * distance and the payload's display values go through, so they cannot
 * disagree. Null means the row doesn't answer this field: a market unknown, or
 * a per-game read of a season with no games to divide by.
 */
export function fieldValue(
  row: CompsPoolRow,
  field: { key: string; perGame: boolean },
  basis: CompsBasis,
): number | null {
  const raw = row.values[field.key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (field.perGame && basis === "per_game") {
    return row.games > 0 ? raw / row.games : null;
  }
  return raw;
}

/**
 * The similarity a distance reads as: `round(100·exp(−d))`. A fixed monotone
 * map, never rescaled within a result set — 82 means the same gap whatever
 * else matched — and presented as a score, never as "82% match".
 */
export function similarityScore(distance: number): number {
  return Math.round(100 * Math.exp(-distance));
}

export function runCompsKnn({
  subject,
  candidates,
  fields,
  basis,
  k,
  minGames,
  positions,
}: {
  subject: CompsPoolRow;
  candidates: readonly CompsPoolRow[];
  fields: readonly CompsFieldSpec[];
  basis: CompsBasis;
  k: number;
  minGames: number;
  positions: readonly string[];
}): CompsKnnOutput {
  // Steps 1–3. The subject is spared min_games (it is the question, not a
  // candidate), and its own row is excluded by (player_id, season) — the same
  // player's *other* seasons are legitimate comps.
  const considered = candidates.filter(
    (row) =>
      row.position !== null &&
      positions.includes(row.position) &&
      row.games >= minGames &&
      !(row.player_id === subject.player_id && row.season === subject.season),
  );

  // Step 4: a candidate missing any weighted field is excluded rather than
  // compared on the fields it has — a lower-dimensional distance is biased
  // small, which would float exactly the unknown players to the top.
  const excludedMissing: Record<string, number> = {};
  const eligible: { row: CompsPoolRow; values: number[] }[] = [];
  for (const row of considered) {
    let complete = true;
    const values: number[] = [];
    for (const field of fields) {
      const value = fieldValue(row, field, basis);
      if (value === null) {
        complete = false;
        excludedMissing[field.key] = (excludedMissing[field.key] ?? 0) + 1;
      } else {
        values.push(value);
      }
    }
    if (complete) eligible.push({ row, values });
  }

  // Step 5: mean and population stdev per field, over the eligible candidates
  // only.
  const n = eligible.length;
  const fieldStats: CompsFieldStats[] = fields.map((field, f) => {
    if (n === 0) return { key: field.key, mean: null, stdev: null };
    let sum = 0;
    for (const candidate of eligible) sum += candidate.values[f];
    const mean = sum / n;
    let variance = 0;
    for (const candidate of eligible) {
      variance += (candidate.values[f] - mean) ** 2;
    }
    return { key: field.key, mean, stdev: Math.sqrt(variance / n) };
  });

  // Step 6. A zero-variance field contributes 0 — every candidate is the same
  // there, so it separates nobody — rather than NaN. The subject is
  // transformed with the candidates' statistics.
  const totalWeight = fields.reduce((sum, field) => sum + field.weight, 0);
  const scored = eligible.map(({ row, values }) => {
    let weighted = 0;
    for (const [f, field] of fields.entries()) {
      const { mean, stdev } = fieldStats[f];
      if (mean === null || stdev === null || stdev === 0) continue;
      const subjectValue = fieldValue(subject, field, basis);
      // Resolution dropped subject-missing fields, so this only guards a
      // caller that skipped resolve; contributing 0 beats NaN either way.
      if (subjectValue === null) continue;
      const gap = (values[f] - mean) / stdev - (subjectValue - mean) / stdev;
      weighted += field.weight * gap * gap;
    }
    const distance = totalWeight > 0 ? Math.sqrt(weighted / totalWeight) : 0;
    return { row, distance, similarity: similarityScore(distance) };
  });

  scored.sort(
    (a, b) =>
      a.distance - b.distance ||
      // Deterministic ties: newer season first, then player id.
      b.row.season.localeCompare(a.row.season) ||
      a.row.player_id.localeCompare(b.row.player_id),
  );

  return {
    results: scored.slice(0, k),
    fieldStats,
    candidatesConsidered: considered.length,
    candidatesEligible: n,
    excludedMissing,
  };
}

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
  /**
   * Where the player went in the NFL draft, or null where this app has no
   * record of it. A record with a null `overall` means he went *undrafted*,
   * which is a different answer — see `nfl-draft/types.ts`.
   *
   * Row metadata rather than a value, exactly like `position` and `team`: the
   * comparable form of this fact is `values.draft_capital`, and printing a
   * pick number is what this is for. Unlike those two it is time-invariant, so
   * a historical row carries the right pick rather than today's.
   */
  draft: {
    season: string;
    round: number | null;
    slot: number | null;
    overall: number | null;
  } | null;
  /** Games played: the count of stored weekly lines, `playerPpg`'s own rule. */
  games: number;
  values: Record<string, number | null>;
  /**
   * The numerator and denominator behind each derived rate on `values`, scaled
   * so the value is exactly `n / d`. What they are for is *windows*: pooling
   * three seasons of target share is Σtargets over Σteam-targets, and only the
   * components can say that — a mean of three seasons' shares is a different
   * number wearing the same label. Optional because a row assembled without
   * them is still a legitimate row; it simply can't pool a rate, which reads as
   * the window answering null rather than answering approximately.
   */
  rates?: Record<string, { n: number; d: number }>;
  /**
   * Season fantasy-point totals under Sleeper's three generic scorings — what
   * "how did that season go" is answered with. Display only, never a KNN
   * field: the comparison is *criteria* (usage, profile, market) and this is
   * the *outcome*, which is what the reader came to see. `pts_ppr` is fine
   * here precisely because this board belongs to no league — the house rule
   * reserves it for exactly this generic, league-less context.
   */
  points: { ppr: number; half_ppr: number; std: number };
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
 *
 * `key` is a *dimension* key, which for the default window is the catalogue's
 * own and for any other is `windows.ts`'s composite. A windowed value was
 * materialized already resolved under the basis — its divisor is the window's
 * games, not this season's — so its spec carries `perGame: false` and this
 * function is the same one either way rather than growing a branch.
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

  // Step 6.
  //
  // **Only a field that can actually separate two candidates is in the
  // distance — numerator *and* denominator.** A field whose eligible
  // population holds one value has σ = 0, so every z-gap on it is 0 and it
  // contributes nothing to the numerator (dividing by σ would be NaN, which is
  // why it was already skipped there). Leaving its weight in the denominator
  // was the bug: it divided a real gap by weight nothing had paid, so adding a
  // dimension carrying *zero comparative information* improved every
  // similarity score. Measured on one useful field, an equally weighted
  // constant beside it took a candidate from d ≈ 1.2247 to d ≈ 0.8660 — the
  // ranking unmoved and every number flattering. A field the subject cannot
  // answer is dropped on the same terms and for the same arithmetic.
  //
  // The participating set is a property of the field statistics and the
  // subject, never of the candidate being scored, so it is resolved once: every
  // candidate is scored over the same dimensions and against the same total.
  const participating: {
    index: number;
    weight: number;
    mean: number;
    stdev: number;
    subjectValue: number;
  }[] = [];
  for (const [f, field] of fields.entries()) {
    const { mean, stdev } = fieldStats[f];
    if (mean === null || stdev === null || stdev === 0) continue;
    // Resolution dropped subject-missing fields, so this only guards a caller
    // that skipped resolve; dropping beats NaN either way.
    const subjectValue = fieldValue(subject, field, basis);
    if (subjectValue === null) continue;
    participating.push({
      index: f,
      weight: field.weight,
      mean,
      stdev,
      subjectValue,
    });
  }

  const totalWeight = participating.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );

  const scored = eligible.map(({ row, values }) => {
    let weighted = 0;
    for (const { index, weight, mean, stdev, subjectValue } of participating) {
      const gap = (values[index] - mean) / stdev - (subjectValue - mean) / stdev;
      weighted += weight * gap * gap;
    }
    // No dimension separates anybody — every requested field is constant across
    // the population, or the subject answers none of them. Every candidate is
    // then genuinely indistinguishable *on what was asked*, so they all sit at
    // distance 0 and the deterministic tiebreak below orders them. This is the
    // answer the code already gave (an all-skipped numerator over a non-zero
    // total is 0 too); what it must never be is NaN or Infinity, and the
    // payload's own `pool_stdev` of 0 is where a reader sees why.
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

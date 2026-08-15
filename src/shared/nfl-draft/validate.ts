import type { NflDraftPick } from "./types.ts";

/**
 * Whether a parsed crosswalk is complete enough to replace the stored table
 * with — `ktc/validate`'s job, for `ktc/validate`'s reason.
 *
 * The sync is destructive by design: a player who falls out of the crosswalk
 * has his stored row deleted, because the source revises itself and a stale row
 * would otherwise outlive a correction forever. That is right when the response
 * is the crosswalk. It is catastrophic when the response is a fragment — a
 * column rename the parser half-survives, a truncated body, GitHub serving an
 * error page with a 200 — because a hundred-row "crosswalk" deletes several
 * thousand good rows and stamps the result fresh.
 *
 * So: validate before the transaction opens, refuse to write anything at all
 * when the answer doesn't look like the crosswalk, and say why. Refusing costs
 * one cycle of staleness on data that changes once a year; writing a fragment
 * costs every draft-capital comparison in the app until somebody notices.
 *
 * Pure and tested, beside `parse` and `capital`.
 */

/**
 * Fewest picks a response must carry to be treated as the crosswalk.
 *
 * The source resolves ~3,700 drafted players to Sleeper ids and ~2,600 more as
 * undrafted, and both numbers only grow — a class a year in, nothing ever
 * leaving. Set well under the true size rather than near it: this floor is what
 * catches a fragment, and the shrink check is what catches a response that is
 * merely short.
 */
export const NFL_DRAFT_MIN_PICKS = 2_000;

/**
 * How far the crosswalk may shrink against what is stored before the response
 * is refused, as a fraction.
 *
 * A real refresh only grows, so any shrink at all is already surprising; 10%
 * leaves room for the source genuinely retiring a batch of stale ids without
 * wedging the sync permanently, and is far inside what a truncated body looks
 * like.
 */
export const NFL_DRAFT_MAX_SHRINK = 0.1;

/**
 * The fewest *drafted* players a response must carry, as a fraction of it.
 *
 * The one check `ktc/validate` has no analogue of, and the one this source
 * actually needs. Every rule in the parser that distinguishes undrafted from
 * unknown reads the draft columns; if `draft_ovr` were renamed or emptied, the
 * parser would not throw — it would decide that *no* class had been held, hold
 * back every undrafted row as pending, and emit a crosswalk of nothing but the
 * rows it could still read. A count check alone can pass that. Requiring that a
 * healthy share of the answer is actually drafted is what turns a silently
 * emptied column into a refusal.
 */
export const NFL_DRAFT_MIN_DRAFTED_FRACTION = 0.3;

export type NflDraftValidation =
  | {
      ok: true;
      picks: NflDraftPick[];
      drafted: number;
      undrafted: number;
      previous: number;
    }
  | {
      ok: false;
      reason: string;
      valid: number;
      drafted: number;
      previous: number;
    };

/**
 * Validate a parsed crosswalk against the stored one.
 *
 * `previous` is how many rows the table currently holds. **Zero means first
 * sync** — there is nothing to shrink against, so only the absolute floor and
 * the drafted-share check apply, which is what lets an empty database bootstrap
 * without an operator disabling the guard.
 */
export function validateNflDraftPicks(
  picks: readonly NflDraftPick[],
  previous: number,
): NflDraftValidation {
  const drafted = picks.filter((pick) => pick.overall !== null).length;
  const undrafted = picks.length - drafted;

  if (picks.length === 0) {
    return {
      ok: false,
      reason: "crosswalk contained no resolvable picks",
      valid: 0,
      drafted: 0,
      previous,
    };
  }

  if (picks.length < NFL_DRAFT_MIN_PICKS) {
    return {
      ok: false,
      reason:
        `only ${picks.length} pick(s), below the ${NFL_DRAFT_MIN_PICKS} minimum`,
      valid: picks.length,
      drafted,
      previous,
    };
  }

  if (drafted < picks.length * NFL_DRAFT_MIN_DRAFTED_FRACTION) {
    return {
      ok: false,
      reason:
        `only ${drafted} of ${picks.length} pick(s) are drafted, below ` +
        `${pct(NFL_DRAFT_MIN_DRAFTED_FRACTION)} — the draft columns may have moved`,
      valid: picks.length,
      drafted,
      previous,
    };
  }

  if (previous > 0 && picks.length < previous * (1 - NFL_DRAFT_MAX_SHRINK)) {
    return {
      ok: false,
      reason:
        `${picks.length} pick(s) is more than ${pct(NFL_DRAFT_MAX_SHRINK)} ` +
        `below the ${previous} stored`,
      valid: picks.length,
      drafted,
      previous,
    };
  }

  return { ok: true, picks: [...picks], drafted, undrafted, previous };
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * Whether this deployment may answer a comp from the sample corpus.
 *
 * **Production must not silently serve twenty-six invented rows.** The sample
 * is a transcription of a design prototype: twelve subjects, twenty-six
 * hand-picked good seasons, no retirements, and figures nobody measured. It is
 * exactly the right thing for a checkout with no database and exactly the
 * wrong thing for a deployed page, because the failure is invisible — the
 * board renders, the percentages look plausible, and the only thing on screen
 * saying so is a four-word caption a reader has no reason to weigh.
 *
 * So the fallback is a **decision** rather than a consequence of an empty
 * table: allowed by default in development and in tests, denied by default in
 * production, and forced either way by `COMPS_SAMPLE_CORPUS`. A production
 * deployment that genuinely wants the sample — a demo, a preview build — says
 * so out loud and gets it.
 *
 * Pure, with the environment as an argument, on `db/config`'s and
 * `logs/access`'s shape: the production rule is checked without setting
 * `NODE_ENV` in a test process.
 */

export const COMPS_SAMPLE_CORPUS_ENV = "COMPS_SAMPLE_CORPUS";

export type SampleCorpusAccess = {
  allowed: boolean;
  /** Why, in a sentence a log line or a diagnostic can carry. */
  reason: string;
};

/**
 * Whether the sample may stand in for an unloaded `player_seasons`.
 *
 * `on` and `off` are explicit and win everywhere. Anything else — including
 * junk, which must not be read as an opt-in — falls to the default for the
 * environment. That last clause is the one worth stating: `COMPS_SAMPLE_CORPUS=yes`
 * in production is a typo, and reading a typo as consent is how the thing this
 * gate exists to prevent gets shipped anyway.
 */
export function sampleCorpusAccess(
  env: Record<string, string | undefined>,
  production: boolean,
): SampleCorpusAccess {
  const raw = env[COMPS_SAMPLE_CORPUS_ENV]?.trim().toLowerCase();

  if (raw === "off") {
    return { allowed: false, reason: `${COMPS_SAMPLE_CORPUS_ENV}=off` };
  }
  if (raw === "on") {
    return { allowed: true, reason: `${COMPS_SAMPLE_CORPUS_ENV}=on` };
  }
  if (raw !== undefined && raw !== "") {
    return {
      allowed: !production,
      reason:
        `${COMPS_SAMPLE_CORPUS_ENV}="${raw}" is not "on" or "off"; ` +
        `falling back to the ${production ? "production" : "development"} default`,
    };
  }

  return production
    ? {
        allowed: false,
        reason:
          `player_seasons is empty and ${COMPS_SAMPLE_CORPUS_ENV} is unset. ` +
          `Refusing to serve the sample corpus in production: run the loader ` +
          `(npm run comps:load-corpus), or set ${COMPS_SAMPLE_CORPUS_ENV}=on ` +
          `to serve it deliberately.`,
      }
    : {
        allowed: true,
        reason: `player_seasons is empty; answering from the sample corpus in development`,
      };
}

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to run the expensive sync endpoints.
 *
 * The sync routes fan out to Sleeper and KeepTradeCut — a forced players sync is
 * a ~5MB download, a projections week is ~5.6MB, a forced league refresh is ~9
 * requests per league — so they are operator tools, not public reads. The
 * advisory locks stop two of those running *at once*; nothing stopped a caller
 * running them back to back forever, which is what this closes.
 *
 * Deliberately narrow: one shared secret in a header, no session, no user model.
 * There is no account system in this app to hang an admin role off, and
 * inventing one to gate three routes would be the larger change.
 *
 * Pure and tested — the environment and the header arrive as arguments, so the
 * decision can be checked without a request. The `NextResponse` half lives one
 * layer out in `app/api/internal-auth.ts`, the same split as
 * `resolveManagerUser` / `resolveManagerRequest`.
 */

/** The header the secret travels in. Never a query parameter — those get logged. */
export const INTERNAL_SYNC_HEADER = "x-internal-sync-secret";

/** The environment variable holding the expected secret. */
export const INTERNAL_SYNC_SECRET_ENV = "INTERNAL_SYNC_SECRET";

export type InternalSyncDecision =
  | { ok: true; /** true when a dev server let an unconfigured request through. */ dev: boolean }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type InternalSyncInput = {
  /** Value of the {@link INTERNAL_SYNC_HEADER} header, or null when absent. */
  provided: string | null | undefined;
  /** Value of {@link INTERNAL_SYNC_SECRET_ENV}. */
  secret: string | null | undefined;
  /** Whether this process is running in production. */
  production: boolean;
};

/**
 * Whether a request may run an internal sync.
 *
 * Unconfigured is the case worth stating: in production it is a **503**, not a
 * pass and not a 403. Failing open would leave the endpoints exactly as exposed
 * as they were, and answering 403 would make a missing environment variable
 * indistinguishable from a wrong secret at 3am. On a dev server an unconfigured
 * secret is allowed through, so `npm run dev` still lets you force a sync by
 * hand — that is the only place this is ever permissive, and it is why the
 * production branch is keyed on the environment rather than on a flag someone
 * could set in production.
 */
export function internalSyncDecision(
  input: InternalSyncInput,
): InternalSyncDecision {
  const secret = input.secret?.trim();

  if (!secret) {
    if (input.production) {
      return {
        ok: false,
        status: 503,
        error: `Internal sync is not configured; set ${INTERNAL_SYNC_SECRET_ENV}`,
      };
    }
    return { ok: true, dev: true };
  }

  const provided = input.provided?.trim();
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: `Missing ${INTERNAL_SYNC_HEADER} header`,
    };
  }

  if (!secretsMatch(provided, secret)) {
    return { ok: false, status: 403, error: "Invalid internal sync credentials" };
  }

  return { ok: true, dev: false };
}

/**
 * Constant-time secret comparison.
 *
 * `timingSafeEqual` throws on differing lengths — which would leak the length
 * through the error path — so both sides are hashed to a fixed 32 bytes first
 * and the digests are compared. The hash is not a password KDF and doesn't need
 * to be: it exists to fix the width, not to protect the secret at rest.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import {
  internalSyncDecision,
  INTERNAL_SYNC_HEADER,
} from "@/shared/internal-auth";

/**
 * The HTTP half of the internal-sync guard.
 *
 * `internalSyncDecision` owns every decision; all this adds is reading the
 * header, reading the environment, and turning a refusal into a `NextResponse`
 * — the same split (and the same reason) as
 * `app/api/user/[username]/manager-request.ts`: domain code has no business
 * constructing responses, and a non-route file in `src/app` is fine because
 * only `route.ts`/`page.tsx` are special.
 */
export type InternalAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/** Authorize a request against `INTERNAL_SYNC_SECRET`; see the policy module. */
export function authorizeInternalRequest(request: Request): InternalAuthResult {
  const decision = internalSyncDecision({
    provided: request.headers.get(INTERNAL_SYNC_HEADER),
    secret: process.env.INTERNAL_SYNC_SECRET,
    production: process.env.NODE_ENV === "production",
  });

  if (decision.ok) return { ok: true };

  const payload: ApiErrorPayload = { error: decision.error };
  return {
    ok: false,
    response: NextResponse.json(payload, { status: decision.status }),
  };
}

/**
 * Whether a request carries valid internal credentials, without producing a
 * response.
 *
 * For the public routes that merely have a privileged *knob* — the leagues
 * stream's `?refresh=1` — rather than a privileged purpose. Those keep
 * answering normally for anyone; they just stop honouring the expensive
 * override.
 */
export function isInternalRequest(request: Request): boolean {
  return internalSyncDecision({
    provided: request.headers.get(INTERNAL_SYNC_HEADER),
    secret: process.env.INTERNAL_SYNC_SECRET,
    production: process.env.NODE_ENV === "production",
  }).ok;
}

/** The 405 a sync endpoint answers a `GET` with, now that they are POST-only. */
export function methodNotAllowed(allow = "POST"): NextResponse {
  const payload: ApiErrorPayload = { error: `Method not allowed; use ${allow}` };
  return NextResponse.json(payload, { status: 405, headers: { Allow: allow } });
}

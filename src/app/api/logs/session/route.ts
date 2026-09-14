import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import {
  createLoginThrottle,
  GLOBAL_LOGIN_THROTTLE,
  loginRequest,
  logoutRequest,
  logsConfig,
  PER_CLIENT_LOGIN_THROTTLE,
} from "@/shared/logs";
import type { LoginDecision, LoginThrottle } from "@/shared/logs";
import { clientKey, isJsonRequest, readJsonWithin } from "@/shared/request";
import type { JsonRead } from "@/shared/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/logs/session` — sign in to the visit log; `DELETE` — sign out.
 *
 * The credential arrives **once**, in a JSON body over HTTPS, and what it buys
 * is a signed, expiring session in an HttpOnly cookie — never the credential
 * itself in a cookie, a URL, a prop or a page. Every decision is
 * `shared/logs/login`'s and is driven under Node's own runner there; what this
 * file owns is the two things a pure function cannot: reading the body
 * **within** a bound (`readJsonWithin`, so a 1 MiB body is refused at its
 * first chunk rather than allocated whole and then measured), and the two
 * throttles, which are process state.
 *
 * **The throttles live on `globalThis`**, on the live rooms' argument: under
 * `next dev` an edit re-evaluates this module, and a fresh pair would hand a
 * locked client a new budget on every save.
 */
const MAX_LOGIN_BODY_BYTES = 1024;

const THROTTLE_KEY = Symbol.for("thelab.logs.login-throttle");
const globalForThrottle = globalThis as unknown as {
  [key: symbol]: { client: LoginThrottle; global: LoginThrottle } | undefined;
};
const throttle = (globalForThrottle[THROTTLE_KEY] ??= {
  client: createLoginThrottle(PER_CLIENT_LOGIN_THROTTLE),
  global: createLoginThrottle(GLOBAL_LOGIN_THROTTLE),
});

const production = () => process.env.NODE_ENV === "production";

export async function POST(request: Request) {
  const config = logsConfig(process.env, production());
  if (config.kind === "configured" && config.warning) console.warn(`[logs] ${config.warning}`);

  // A body that is not JSON is not read at all — nothing to bound and nothing
  // to parse — and lands on the decision's "not a sign-in" arm.
  const body: JsonRead = isJsonRequest(request.headers)
    ? await readJsonWithin(request, MAX_LOGIN_BODY_BYTES)
    : { ok: false, reason: "malformed" };

  return toResponse(
    loginRequest({
      config,
      production: production(),
      headers: request.headers,
      body,
      client: clientKey(request.headers),
      now: Date.now(),
      throttle,
    }),
  );
}

export async function DELETE(request: Request) {
  return toResponse(logoutRequest({ production: production(), headers: request.headers }));
}

export async function GET() {
  const error: ApiErrorPayload = { error: "Use POST to sign in and DELETE to sign out" };
  return NextResponse.json(error, {
    status: 405,
    headers: { Allow: "POST, DELETE", "Cache-Control": "no-store" },
  });
}

function toResponse(decision: LoginDecision): Response {
  return decision.body === null
    ? new NextResponse(null, { status: decision.status, headers: decision.headers })
    : NextResponse.json(decision.body, { status: decision.status, headers: decision.headers });
}

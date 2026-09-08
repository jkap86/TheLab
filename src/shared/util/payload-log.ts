/**
 * A JSON response that says how big it was — in development only.
 *
 * **The point of it is that a payload's size is the one thing nobody measures
 * until it is a problem.** The manager page's batched lineups answer grew from
 * "the manager's lineup" to "every roster of every league" one field at a time,
 * each addition small and none of them visible: the route returns
 * `NextResponse.json(payload)` and the serialised bytes exist only inside
 * Next's own writer. This makes them a number a developer can read in the
 * terminal beside the leagues that produced it.
 *
 * **It is silent in production**, and that is a rule rather than a default:
 * this route is hit once per page load per reader, and a size line per request
 * is log noise that costs money to store. `LOG_PAYLOAD_SIZE=on` turns it on
 * anywhere for a deliberate measurement — the switch every background loop in
 * this app is already spelled with, one word over.
 *
 * **It serialises exactly once either way.** In the quiet path it hands the
 * object to `Response.json`, which is what `NextResponse.json` does; in the
 * loud path it stringifies, measures the string, and builds the response *from
 * that string* — so measuring costs a `TextEncoder`-free `Buffer.byteLength`
 * and no second pass over the object. A helper that stringified to measure and
 * then let the framework stringify again would double the cost of the thing it
 * exists to report on.
 */

/** Whether a size line should be printed for this process. */
export function payloadLogEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.LOG_PAYLOAD_SIZE?.trim().toLowerCase() === "on") return true;
  return env.NODE_ENV !== "production";
}

/** `1.2 MB`, `48.3 KB`, `812 B` — one decimal past a kilobyte. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * `NextResponse.json`'s behaviour, plus a development-only size line.
 *
 * `label` names the route and its subject; `meta` is whatever counts make the
 * size legible — how many leagues answered, how many rosters were solved — and
 * is printed as `key=value` pairs. `startedAt` (a `performance.now()` reading
 * taken at the top of the handler) adds the route's own duration, which is the
 * other half of the same question.
 */
export function jsonWithPayloadSize(
  payload: unknown,
  label: string,
  meta: Record<string, number | string> = {},
  startedAt?: number,
): Response {
  if (!payloadLogEnabled()) {
    return Response.json(payload);
  }
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, "utf8");
  const parts = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  if (startedAt !== undefined) {
    parts.push(`ms=${Math.round(performance.now() - startedAt)}`);
  }
  const tail = parts.length > 0 ? ` (${parts.join(" ")})` : "";
  console.log(`[payload] ${label} ${formatBytes(bytes)}${tail}`);
  return new Response(body, {
    headers: { "content-type": "application/json" },
  });
}

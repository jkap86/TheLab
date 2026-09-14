import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The proxy's HTTPS wiring, pinned against its source.
 *
 * `decideHttps` is driven for real in `https.test.ts` — the redirect target,
 * the refused POST, the missing header, the retired `?key=`, the HSTS value.
 * What only `proxy.ts` can get wrong is the order and the reach: a decision
 * taken *after* the visit is logged (two rows per insecure hard load), a
 * matcher that skips the API (the session cookie unguarded on the one path
 * that carries it), or an HSTS header set on a response the policy did not
 * mark secure. `proxy.ts` imports `next/server` and cannot be loaded here, so
 * on `crawl-writes.test.ts`' terms this reads it.
 */

const proxy = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");

describe("the proxy", () => {
  test("decides HTTPS before it logs, and a redirect or refusal returns first", () => {
    const decide = proxy.indexOf("decideHttps(policy(), {");
    const redirect = proxy.indexOf('decision.kind === "redirect"');
    const refuse = proxy.indexOf('decision.kind === "refuse"');
    const log = proxy.indexOf("recordVisit({");
    assert.ok(decide !== -1 && redirect !== -1 && refuse !== -1 && log !== -1);
    assert.ok(decide < redirect && redirect < refuse && refuse < log, "decide, redirect, refuse, then log");
    assert.match(proxy, /return NextResponse\.redirect\(decision\.location, \{ status: decision\.status \}\)/);
    assert.match(proxy, /status: decision\.status, headers: \{ "Cache-Control": "no-store" \}/);
  });

  test("reads the scheme from the router's header and never from the socket or the host", () => {
    assert.match(proxy, /forwardedProto: request\.headers\.get\("x-forwarded-proto"\)/);
    assert.doesNotMatch(proxy, /request\.headers\.get\("host"\)/);
    assert.doesNotMatch(proxy, /request\.nextUrl\.origin|request\.url/);
  });

  test("sets HSTS only from the decision", () => {
    assert.match(proxy, /if \(decision\.hsts !== null\) \{\s*\n\s*response\.headers\.set\("Strict-Transport-Security", decision\.hsts\);/);
    assert.equal((proxy.match(/headers\.set\("Strict-Transport-Security"/g) ?? []).length, 1);
  });

  test("resolves the policy once and prints its warning once", () => {
    assert.match(proxy, /Symbol\.for\("thelab\.proxy\.https-policy"\)/);
    assert.match(proxy, /httpsPolicy\(process\.env, process\.env\.NODE_ENV === "production"\)/);
  });

  test("the matcher reaches the API", () => {
    const matcher = proxy.slice(proxy.indexOf("matcher: ["));
    const entry = matcher.slice(0, matcher.indexOf("]"));
    assert.doesNotMatch(entry, /api/);
    assert.match(entry, /_next\//);
    // The pattern itself: an API path and a page path both match, a chunk does not.
    const pattern = new RegExp(`^${entry.match(/"([^"]+)"/)![1]}$`);
    assert.match("/api/logs/session", pattern);
    assert.match("/api/user/x/gametime/stream", pattern);
    assert.match("/manager/jkap86", pattern);
    assert.doesNotMatch("/_next/static/chunk.js", pattern);
    assert.doesNotMatch("/favicon.ico", pattern);
  });
});

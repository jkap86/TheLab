import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The visit log's sign-in, pinned against the files a test cannot import.
 *
 * Every decision — what a session is, what the sign-in answers, what opens a
 * read — is pure and driven for real in `session.test.ts`, `login.test.ts`
 * and `access.test.ts`. What only a route or a page can get wrong is the
 * wiring: a page that read the credential off the URL again, a route that
 * took it on a header again, a body read whole before it was measured, or a
 * refusal that let a cache hold it. None of those fails a test that cannot
 * resolve `@/` — so, on `crawl-writes.test.ts`' terms, this reads the files.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const page = read("src/app/logs/page.tsx");
const api = read("src/app/api/logs/route.ts");
const session = read("src/app/api/logs/session/route.ts");
const hook = read("src/features/logs/hooks/use-visitor-logs.ts");
const home = read("src/features/logs/components/logs-home.tsx");
const login = read("src/features/logs/components/logs-login.tsx");

describe("the credential travels once, in a body", () => {
  test("no reader takes it from a URL or a header any more", () => {
    for (const [name, source] of Object.entries({ page, api, session, hook, home, login })) {
      assert.doesNotMatch(source, /x-logs-key/i, `${name} names the retired header`);
      assert.doesNotMatch(source, /\?key=/, `${name} names the retired query parameter`);
    }
    assert.doesNotMatch(page, /searchParams/);
    assert.doesNotMatch(page, /token=/);
    assert.doesNotMatch(hook, /token/i);
  });

  test("the page reads a cookie and the form posts JSON", () => {
    assert.match(page, /import \{ cookies \} from "next\/headers"/);
    assert.match(page, /store\.get\(LOGS_SESSION_COOKIE\)\?\.value/);
    assert.match(page, /if \(!access\.ok && access\.reason === "denied"\) notFound\(\);/);
    assert.match(login, /method: "POST"/);
    assert.match(login, /body: JSON\.stringify\(\{ token \}\)/);
    assert.match(login, /type="password"/);
    assert.doesNotMatch(login, /localStorage|sessionStorage/);
  });
});

describe("the sign-in route", () => {
  test("reads its body within a bound and never whole", () => {
    assert.match(session, /readJsonWithin\(request, MAX_LOGIN_BODY_BYTES\)/);
    assert.match(session, /const MAX_LOGIN_BODY_BYTES = 1024;/);
    assert.doesNotMatch(session, /request\.(text|json)\(\)/);
  });

  test("decides through `loginRequest`, keyed by the trusted client address, on process-wide throttles", () => {
    assert.match(session, /client: clientKey\(request\.headers\)/);
    assert.match(session, /loginRequest\(\{/);
    assert.match(session, /logoutRequest\(\{ production: production\(\), headers: request\.headers \}\)/);
    assert.match(session, /Symbol\.for\("thelab\.logs\.login-throttle"\)/);
  });
});

describe("the read", () => {
  test("is authenticated by the cookie alone, and a refusal is uncacheable", () => {
    assert.match(api, /sessionFromCookieHeader\(request\.headers\.get\("cookie"\)\)/);
    assert.match(api, /status: access\.reason === "denied" \? 404 : 401/);
    assert.match(api, /"Cache-Control": "private, no-store"/);
    // Every answer carries it: the refusal, the 400, the payload and the 500.
    assert.equal((api.match(/headers: NO_STORE/g) ?? []).length, 4);
  });

  test("the client refreshes to the form on a 401 rather than retrying", () => {
    assert.match(hook, /if \(res\.status === 401\) \{/);
    assert.match(hook, /setUnauthorized\(true\)/);
    assert.match(home, /if \(unauthorized\) router\.refresh\(\);/);
  });
});

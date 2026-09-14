import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The visit log's two writers, pinned against the files a test cannot import.
 *
 * The admission is `visit-admission.ts` and is driven for real; the retention
 * plan is `retention-plan.ts` and is driven for real. What only the wiring can
 * get wrong is that a writer reaches the pool without passing the admission, a
 * route reads its body whole, or the retention loop is declared and never
 * started — none of which fails a test that cannot resolve `@/`. So, on
 * `crawl-writes.test.ts`' terms, this reads the files.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const exists = (path: string) => existsSync(join(process.cwd(), path));

describe("every write is admitted", () => {
  const record = read("src/shared/logs/record.ts");

  test("`recordVisit` admits before it touches the pool and releases in a finally", () => {
    const admit = record.indexOf("gate.admit(");
    const query = record.indexOf("pool.query(");
    assert.ok(admit !== -1 && query !== -1 && admit < query);
    assert.match(record, /\} finally \{\s*\n\s*admitted\.release\(\);/);
    assert.match(record, /Symbol\.for\("thelab\.logs\.visit-admission"\)/);
  });

  test("the proxy and the beacon route are the only writers, and both write through `recordVisit`", () => {
    const proxy = read("src/proxy.ts");
    const beacon = read("src/app/api/logs/visit/route.ts");
    assert.match(proxy, /recordVisit\(\{ ip: clientIp\(request\.headers\), route \}\)/);
    assert.match(beacon, /recordVisit\(\{ ip: clientIp\(request\.headers\), route \}\)/);
    assert.doesNotMatch(proxy, /INSERT INTO visitor_logs/);
    assert.doesNotMatch(beacon, /INSERT INTO visitor_logs/);
    assert.equal((record.match(/INSERT INTO visitor_logs/g) ?? []).length, 1);
  });
});

describe("the client address is one policy", () => {
  test("both writers take it from `shared/request`, and the old module is gone", () => {
    for (const path of ["src/proxy.ts", "src/app/api/logs/visit/route.ts"]) {
      const source = read(path);
      assert.match(source, /import \{[^}]*\bclientIp\b[^}]*\} from "@\/shared\/request"/, path);
      assert.doesNotMatch(source, /x-real-ip/i, path);
    }
    assert.equal(exists("src/shared/logs/client-ip.ts"), false);
    assert.doesNotMatch(read("src/shared/logs/index.ts"), /client-ip/);
  });
});

describe("the beacon route", () => {
  const beacon = read("src/app/api/logs/visit/route.ts");

  test("reads its body within 512 bytes and never whole", () => {
    assert.match(beacon, /readJsonWithin\(request, MAX_BODY_BYTES\)/);
    assert.match(beacon, /const MAX_BODY_BYTES = 512;/);
    assert.doesNotMatch(beacon, /request\.(text|json)\(\)/);
    assert.match(beacon, /status: 413/);
  });

  test("asks the browser's own word on origin, and treats it as a forgery check", () => {
    assert.match(beacon, /sameOriginRequest\(request\.headers\)\.ok/);
    assert.match(beacon, /forgery check and not authentication/);
  });
});

describe("retention", () => {
  test("runs under its own advisory lock and is started by both entry points", () => {
    const retention = read("src/shared/logs/retention.ts");
    assert.match(retention, /withAdvisoryLock\(LOCK_KEYS\.visitorLogRetention,/);
    assert.match(retention, /pool\.query\(PRUNE_VISITOR_LOGS_SQL, \[msInterval\(retentionMs\), batch\]\)/);
    assert.match(read("src/shared/db/lock.ts"), /visitorLogRetention: \[8675309, 4\]/);
    assert.match(read("src/instrumentation.ts"), /startVisitorLogRetention\(\);/);
    assert.match(read("scripts/worker.ts"), /startVisitorLogRetention\(\);/);
  });
});

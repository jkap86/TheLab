import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  LOGGED_ROUTES,
  LOGGED_ROUTE_PREFIXES,
  loggedRoute,
} from "./routes.ts";

describe("loggedRoute", () => {
  test("records the four routes that carry no path under them", () => {
    for (const route of LOGGED_ROUTES) {
      assert.equal(loggedRoute(route), route);
    }
  });

  test("records a prefixed route only with a segment under it", () => {
    // The proxy's `:path+` is one-or-more. `/manager` on its own is a redirect
    // to `/tools` and never a page, so a row for it would be a visit to
    // something nobody could have been looking at.
    assert.equal(loggedRoute("/manager/jkap86"), "/manager/jkap86");
    assert.equal(loggedRoute("/lineupchecker/jkap86"), "/lineupchecker/jkap86");
    assert.equal(loggedRoute("/picktracker/1234"), "/picktracker/1234");
    assert.equal(loggedRoute("/manager"), null);
    assert.equal(loggedRoute("/lineupchecker"), null);
  });

  test("`/picktracker` is both, which is what the proxy's two entries say", () => {
    assert.equal(loggedRoute("/picktracker"), "/picktracker");
    assert.equal(loggedRoute("/picktracker/1234"), "/picktracker/1234");
  });

  test("one page is one row however the path was spelled", () => {
    // Two spellings of one page are two rows and a facet menu naming one
    // manager twice, which is the whole reason this answers the stored string
    // rather than a boolean.
    assert.equal(loggedRoute("/manager//jkap86"), "/manager/jkap86");
    assert.equal(loggedRoute("/manager/jkap86/"), "/manager/jkap86");
    assert.equal(loggedRoute("/tools/"), "/tools");
  });

  test("an encoded segment is stored encoded, as the proxy stores it", () => {
    // `nextUrl.pathname` and `usePathname` both hand back the encoded form, so
    // decoding here would make one visit two different rows depending on which
    // of the two writers recorded it.
    assert.equal(loggedRoute("/manager/a%20b"), "/manager/a%20b");
  });

  test("the routes this log does not keep are refused", () => {
    // `/logs` is excluded by not being named, which is how the proxy's own
    // positive list excludes it; `/` is a redirect and never a page.
    assert.equal(loggedRoute("/logs"), null);
    assert.equal(loggedRoute("/"), null);
    assert.equal(loggedRoute("/api/logs"), null);
  });

  test("nothing that is not a path this app serves gets through", () => {
    // The report arrives over HTTP from a browser this app does not control,
    // so what reaches here is attacker-supplied in `client-ip`'s own sense.
    assert.equal(loggedRoute(""), null);
    assert.equal(loggedRoute("tools"), null);
    assert.equal(loggedRoute("//evil.example.com"), null);
    assert.equal(loggedRoute("https://evil.example.com/tools"), null);
    assert.equal(loggedRoute("/manager/jkap86?x=1"), null);
    assert.equal(loggedRoute("/manager/jkap86#x"), null);
    assert.equal(loggedRoute("/manager/a b"), null);
    assert.equal(loggedRoute("/manager/" + "a".repeat(300)), null);
    assert.equal(loggedRoute("/manager/" + "a/".repeat(20)), null);
    assert.equal(loggedRoute(null), null);
    assert.equal(loggedRoute(undefined), null);
    assert.equal(loggedRoute(42), null);
    assert.equal(loggedRoute({ toString: () => "/tools" }), null);
  });
});

/**
 * The other spelling of this list, pinned textually on `process-role.test.ts`'
 * terms: `proxy.ts`'s `config.matcher` has to be static constants for Next to
 * analyse at build time, so it cannot read the arrays above — and a tool added
 * to one and forgotten in the other is a page whose hard loads are recorded and
 * whose in-app navigations are refused, or the reverse, with a green suite
 * behind it either way.
 */
describe("the proxy's matcher", () => {
  const source = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  const matcher = source.slice(source.indexOf("matcher: ["));
  const entries = [...matcher.slice(0, matcher.indexOf("]")).matchAll(/"([^"]+)"/g)].map(
    ([, entry]) => entry,
  );

  test("is read, and is a shape this test understands", () => {
    // A matcher entry in some third shape means the derivation below is
    // silently describing something else, so it fails here rather than passing
    // vacuously.
    assert.ok(entries.length > 0, "no matcher entries were found in src/proxy.ts");
    for (const entry of entries) {
      assert.match(entry, /^\/[a-z]+(\/:path\+)?$/, `unrecognised matcher entry: ${entry}`);
    }
  });

  test("names exactly the routes this module records", () => {
    const exact = entries.filter((entry) => !entry.includes(":"));
    const prefixed = entries
      .filter((entry) => entry.endsWith("/:path+"))
      .map((entry) => entry.slice(0, -"/:path+".length));

    assert.deepEqual([...exact].sort(), [...LOGGED_ROUTES].sort());
    assert.deepEqual([...prefixed].sort(), [...LOGGED_ROUTE_PREFIXES].sort());
  });

  test("and every one of them is answered by the predicate", () => {
    for (const entry of entries) {
      const route = entry.endsWith("/:path+")
        ? `${entry.slice(0, -"/:path+".length)}/subject`
        : entry;
      assert.equal(loggedRoute(route), route, `the proxy records ${route} and this does not`);
    }
  });
});

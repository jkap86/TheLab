import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";

import { loggedRoute } from "./routes.ts";

describe("loggedRoute", () => {
  test("records every page this app serves", () => {
    // Read off the filesystem rather than listed: a page added under `app/`
    // that no shape names fails here rather than going silently unrecorded,
    // which is the honest cost of a positive table. `/logs` is in here — it is
    // a page somebody visits.
    const pages = appPageRoutes();
    assert.ok(pages.length >= 8, `found only ${pages.length} pages under app/`);
    for (const page of pages) {
      assert.equal(loggedRoute(page), page, `${page} is a page and is not recorded`);
    }
  });

  test("refuses a path this app does not serve", () => {
    // An invented path used to be a row, so a scanner walking a thousand of
    // them was a thousand inserts into a table nothing pruned. Which retired
    // link a reader arrived on is the router log's to answer.
    for (const invented of [
      "/old/thelabx/path",
      "/nonsense",
      "/admin",
      "/wp-admin",
      "/Tools",
      "/tools/extra",
      "/manager",
      "/manager/jkap86/leagues",
      "/picktracker/abc",
      "/picktracker/123/extra",
      "/gametime/",
    ]) {
      assert.equal(loggedRoute(invented), null, invented);
    }
  });

  test("a subject is recorded only in the shape Sleeper issues it", () => {
    assert.equal(loggedRoute("/manager/jkap86"), "/manager/jkap86");
    assert.equal(loggedRoute("/lineupchecker/Slim_Jim99"), "/lineupchecker/Slim_Jim99");
    assert.equal(loggedRoute("/gametime/x"), "/gametime/x");
    assert.equal(loggedRoute("/picktracker/1234567890123456789"), "/picktracker/1234567890123456789");
    // Not a username: an encoded space, a dot, a hyphen, or a name too long.
    assert.equal(loggedRoute("/manager/a%20b"), null);
    assert.equal(loggedRoute("/manager/a.b"), null);
    assert.equal(loggedRoute("/manager/a-b"), null);
    assert.equal(loggedRoute("/manager/" + "a".repeat(65)), null);
    // Not a league id.
    assert.equal(loggedRoute("/picktracker/-1"), null);
    assert.equal(loggedRoute("/picktracker/1.5"), null);
  });

  test("one page is one row however the path was spelled", () => {
    // Two spellings of one page are two rows and a facet menu naming one
    // manager twice, which is the whole reason this answers the stored string
    // rather than a boolean.
    assert.equal(loggedRoute("/manager//jkap86"), "/manager/jkap86");
    assert.equal(loggedRoute("/manager/jkap86/"), "/manager/jkap86");
    assert.equal(loggedRoute("/tools/"), "/tools");
  });

  test("a namespace that is not a page is refused, bare and with a path under it", () => {
    for (const namespace of ["/api", "/_next"]) {
      assert.equal(loggedRoute(namespace), null, namespace);
      assert.equal(loggedRoute(`${namespace}/x`), null, `${namespace}/x`);
    }
    // A path is case-sensitive to a server and this is still not a page.
    assert.equal(loggedRoute("/API/logs"), null);
  });

  test("every metadata route this app generates is refused, at whatever depth", () => {
    // Read off the filesystem for the reason the page check is: a share image
    // added beside a new route must not start counting as a visit to it. The
    // nested one is what this rule exists for — a crawler unfurling a shared
    // draft link would otherwise write `/picktracker/<id>/opengraph-image`,
    // which derives to the picktracker tool and that league's id and is
    // indistinguishable from somebody opening the board.
    const generated = appMetadataRoutes();
    assert.ok(
      generated.some((route) => route.split("/").length > 2),
      "expected at least one nested metadata route; the shallow case alone would pass a first-segment test",
    );
    for (const route of generated) {
      assert.equal(loggedRoute(route), null, `${route} is a share image and is recorded as a visit`);
    }
    // Named though this app draws none, because the day it does is not a day
    // anybody will remember this file.
    assert.equal(loggedRoute("/twitter-image"), null);
    assert.equal(loggedRoute("/manager/sample/twitter-image"), null);
  });

  test("a request for a file is refused", () => {
    // Every static asset this app serves, and most of what a scanner asks a
    // strange host for. One rule covers both.
    for (const asset of [
      "/favicon.ico",
      "/icon.svg",
      "/icon1.png",
      "/apple-icon.png",
      "/legacy-avatar.png",
      "/wp-login.php",
      "/.env",
      "/config.json",
    ]) {
      assert.equal(loggedRoute(asset), null, asset);
    }
  });

  test("`/` is not a page here", () => {
    // `next.config.ts` redirects it to `/tools` and redirects are checked
    // before the proxy, so the root reaches neither writer; answering it would
    // describe a page that does not exist.
    assert.equal(loggedRoute("/"), null);
  });

  test("nothing that is not a path a browser could show gets through", () => {
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
 * The proxy's matcher, pinned textually on `process-role.test.ts`' terms.
 *
 * It used to be the second spelling of a list this module also held, and what
 * was pinned was that the two agreed. There is one list now and the matcher is
 * a coarse pre-filter in front of it, so what is pinned is the *direction*: the
 * matcher may be broader than the predicate and must never be narrower, because
 * the beacon reaches the predicate through `/api/logs/visit` without passing the
 * matcher at all. An exclusion here that the predicate does not share is a page
 * whose in-app navigations are recorded and whose hard loads are not, with a
 * green suite behind it.
 */
describe("the proxy's matcher", () => {
  const source = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  const matcher = source.slice(source.indexOf("matcher: ["));
  const entries = [
    ...matcher.slice(0, matcher.indexOf("]")).matchAll(/"([^"]+)"/g),
  ].map(([, entry]) => entry);

  test("is one catch-all, and is a shape this test understands", () => {
    // A matcher in some third shape means the checks below are silently
    // describing something else, so it fails here rather than passing
    // vacuously.
    assert.equal(entries.length, 1, "expected exactly one matcher entry");
    assert.match(entries[0], /^\/\(\(\?!.+\)\.\*\)$/, `unrecognised matcher: ${entries[0]}`);
  });

  test("excludes nothing the predicate would have recorded", () => {
    const lookahead = entries[0].slice(entries[0].indexOf("(?!") + 3, entries[0].indexOf(")."));
    const excluded = lookahead.split("|").map((name) => name.replace(/\/$/, ""));
    assert.ok(excluded.length > 0, "no exclusions were found in the matcher");

    for (const name of excluded) {
      assert.equal(
        loggedRoute(`/${name}`),
        null,
        `the matcher excludes /${name} and the predicate would record it`,
      );
    }
  });

  test("and every page this app serves reaches it", () => {
    const lookahead = entries[0].slice(entries[0].indexOf("(?!") + 3, entries[0].indexOf(")."));
    const pattern = new RegExp(`^/((?!${lookahead}).*)$`);
    for (const page of appPageRoutes()) {
      assert.match(page, pattern, `the matcher would not run for ${page}`);
    }
  });
});

/**
 * A value that satisfies each dynamic segment's shape — a league id is a
 * number, and a name where a page names a person. A segment not listed here is
 * a page whose subject `loggedRoute` has not been told the shape of, which the
 * page walk then reports.
 */
const SAMPLE_SEGMENTS: Record<string, string> = {
  "[username]": "sample_user",
  "[leagueId]": "1234567890",
};

/** Every route under `app/` that renders a page. */
function appPageRoutes(): string[] {
  return appRoutesMatching((name) =>
    name === "page.tsx" || name === "page.ts" ? "" : null,
  );
}

/**
 * Every route under `app/` whose directory holds a file `name` accepts, with a
 * sample value standing in for each dynamic segment and the file's own segment
 * — `""` for a page, the convention's name for a metadata route — appended.
 *
 * Route groups are skipped because they do not appear in a URL. There are no
 * parallel or intercepting routes here; one would need a line of its own rather
 * than being silently mapped to a path nobody can visit.
 */
function appRoutesMatching(
  segmentFor: (fileName: string) => string | null,
): string[] {
  const root = join(process.cwd(), "src", "app");
  const routes: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
        continue;
      }
      const tail = segmentFor(entry.name);
      if (tail === null) continue;

      const segments = relative(root, dir)
        .split(sep)
        .filter((segment) => segment.length > 0 && !segment.startsWith("("))
        .map((segment) => (segment.startsWith("[") ? SAMPLE_SEGMENTS[segment] ?? "sample" : segment));
      if (tail.length > 0) segments.push(tail);
      if (segments.length > 0) routes.push(`/${segments.join("/")}`);
    }
  };

  walk(root);
  return routes;
}

/**
 * Every extensionless Next metadata route under `app/` — the generated share
 * images, which are fetched by crawlers rather than visited.
 *
 * The extension-carrying conventions (`sitemap.ts`, `robots.ts`, `manifest.ts`)
 * are refused by the file rule instead and need no entry here.
 */
function appMetadataRoutes(): string[] {
  const conventions = ["opengraph-image", "twitter-image", "icon", "apple-icon"];
  return appRoutesMatching((name) => {
    const base = name.replace(/\.(tsx|ts|jsx|js)$/, "");
    return base !== name && conventions.includes(base) ? base : null;
  });
}

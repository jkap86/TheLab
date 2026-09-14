import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_HSTS_MAX_AGE_SECONDS,
  decideHttps,
  ENFORCE_HTTPS_VAR,
  HSTS_INCLUDE_SUBDOMAINS_VAR,
  HSTS_MAX_AGE_VAR,
  hstsHeader,
  httpsPolicy,
  redirectSearch,
} from "./https.ts";
import type { HttpsPolicy } from "./https.ts";

const PROD = { SITE_URL: "https://thelab.app" };

const enforced = (): HttpsPolicy => httpsPolicy(PROD, true);

const request = (over: Partial<Parameters<typeof decideHttps>[1]>) => ({
  method: "GET",
  forwardedProto: "http",
  pathname: "/tools",
  search: "",
  ...over,
});

describe("httpsPolicy", () => {
  test("is on in production with an https SITE_URL", () => {
    const policy = enforced();
    assert.equal(policy.enforce, true);
    if (policy.enforce) {
      assert.equal(policy.origin, "https://thelab.app");
      assert.equal(policy.hsts, `max-age=${DEFAULT_HSTS_MAX_AGE_SECONDS}`);
    }
  });

  test("is off outside production unless switched on", () => {
    assert.equal(httpsPolicy(PROD, false).enforce, false);
    assert.equal(httpsPolicy({ ...PROD, [ENFORCE_HTTPS_VAR]: "on" }, false).enforce, true);
  });

  test("can be switched off in production", () => {
    assert.equal(httpsPolicy({ ...PROD, [ENFORCE_HTTPS_VAR]: "off" }, true).enforce, false);
  });

  test("stands down with a warning rather than redirecting to a guess", () => {
    // No SITE_URL: nothing to redirect to that is not the request's own Host.
    const unset = httpsPolicy({}, true);
    assert.equal(unset.enforce, false);
    assert.match(unset.warning ?? "", /SITE_URL/);
    // An http:// origin cannot be the target of an https redirect.
    const plain = httpsPolicy({ SITE_URL: "http://thelab.app" }, true);
    assert.equal(plain.enforce, false);
    assert.match(plain.warning ?? "", /https/);
    // A bare host reads as https, which is usable.
    assert.equal(httpsPolicy({ SITE_URL: "thelab.app" }, true).enforce, true);
  });
});

describe("hstsHeader", () => {
  test("defaults to one day, no subdomains, never preload", () => {
    assert.equal(hstsHeader({}), "max-age=86400");
    assert.doesNotMatch(hstsHeader({ [HSTS_INCLUDE_SUBDOMAINS_VAR]: "on" }), /preload/);
  });

  test("takes a configured max-age and the subdomains switch", () => {
    assert.equal(hstsHeader({ [HSTS_MAX_AGE_VAR]: "31536000" }), "max-age=31536000");
    assert.equal(
      hstsHeader({ [HSTS_MAX_AGE_VAR]: "31536000", [HSTS_INCLUDE_SUBDOMAINS_VAR]: "on" }),
      "max-age=31536000; includeSubDomains",
    );
    // Zero is a deliberate rollback and is honoured.
    assert.equal(hstsHeader({ [HSTS_MAX_AGE_VAR]: "0" }), "max-age=0");
  });

  test("junk falls back to the default", () => {
    for (const raw of ["x", "-1", "1.5", "99999999999"]) {
      assert.equal(hstsHeader({ [HSTS_MAX_AGE_VAR]: raw }), "max-age=86400", raw);
    }
  });
});

describe("decideHttps", () => {
  test("an insecure page request is redirected to the canonical origin, path kept", () => {
    const decision = decideHttps(enforced(), request({ pathname: "/manager/jkap86", search: "?season=2025" }));
    assert.deepEqual(decision, {
      kind: "redirect",
      status: 301,
      location: "https://thelab.app/manager/jkap86?season=2025",
    });
  });

  test("an insecure API request is redirected too", () => {
    const decision = decideHttps(enforced(), request({ pathname: "/api/trades", search: "?limit=100" }));
    assert.equal(decision.kind, "redirect");
    if (decision.kind === "redirect") {
      assert.equal(decision.location, "https://thelab.app/api/trades?limit=100");
    }
  });

  test("a secure request is served and carries HSTS", () => {
    assert.deepEqual(decideHttps(enforced(), request({ forwardedProto: "https" })), {
      kind: "next",
      hsts: `max-age=${DEFAULT_HSTS_MAX_AGE_SECONDS}`,
    });
  });

  test("a redirected request does not loop: the router marks it https next time", () => {
    const first = decideHttps(enforced(), request({ pathname: "/tools" }));
    assert.equal(first.kind, "redirect");
    const second = decideHttps(enforced(), request({ pathname: "/tools", forwardedProto: "https" }));
    assert.equal(second.kind, "next");
  });

  test("a request with no forwarded scheme — local development — is served untouched", () => {
    assert.deepEqual(decideHttps(enforced(), request({ forwardedProto: null })), { kind: "next", hsts: null });
    assert.deepEqual(decideHttps(httpsPolicy({}, false), request({})), { kind: "next", hsts: null });
  });

  test("a malicious Host cannot become a redirect target", () => {
    // The decision never sees a host at all: the target is the policy's.
    const decision = decideHttps(enforced(), request({ pathname: "/tools" }));
    assert.equal(decision.kind, "redirect");
    if (decision.kind === "redirect") assert.ok(decision.location.startsWith("https://thelab.app/"));
  });

  test("a path is never allowed to escape the origin", () => {
    // A pathname that lost its leading slash, or one that looks like an
    // authority, still lands under the canonical origin.
    const decision = decideHttps(enforced(), request({ pathname: "evil.example/x" }));
    if (decision.kind === "redirect") assert.equal(decision.location, "https://thelab.app/evil.example/x");
    const authority = decideHttps(enforced(), request({ pathname: "//evil.example/x" }));
    if (authority.kind === "redirect") assert.ok(authority.location.startsWith("https://thelab.app/"));
  });

  test("an insecure POST is refused rather than redirected", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.deepEqual(decideHttps(enforced(), request({ method, pathname: "/api/logs/session" })), {
        kind: "refuse",
        status: 403,
      });
    }
    assert.equal(decideHttps(enforced(), request({ method: "HEAD" })).kind, "redirect");
  });

  test("a chain of forwarded schemes reads the client's, which is first", () => {
    assert.equal(decideHttps(enforced(), request({ forwardedProto: "http, https" })).kind, "redirect");
    assert.equal(decideHttps(enforced(), request({ forwardedProto: "https, http" })).kind, "next");
  });

  test("HSTS appears only on secure responses while enforcement is on", () => {
    const off = httpsPolicy({ ...PROD, [ENFORCE_HTTPS_VAR]: "off" }, true);
    assert.deepEqual(decideHttps(off, request({ forwardedProto: "https" })), { kind: "next", hsts: null });
    assert.deepEqual(decideHttps(enforced(), request({ forwardedProto: "http", method: "GET", pathname: "/x" })).kind, "redirect");
  });
});

describe("redirectSearch", () => {
  test("keeps an ordinary query string whole", () => {
    assert.equal(redirectSearch("/manager/jkap86", "?season=2025&league=1"), "?season=2025&league=1");
  });

  test("drops the retired logs key and keeps the rest", () => {
    assert.equal(redirectSearch("/logs", "?key=s3cret&hours=24"), "?hours=24");
    assert.equal(redirectSearch("/logs", "?key=s3cret"), "");
    assert.equal(redirectSearch("/api/logs", "?key=s3cret&hours=24"), "?hours=24");
  });
});

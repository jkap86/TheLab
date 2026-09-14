import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clientIp,
  clientIpPolicy,
  clientKey,
  DEFAULT_TRUSTED_PROXY_HOPS,
  isAddress,
  normalizeAddress,
  TRUSTED_PROXY_HOPS_VAR,
} from "./client-ip.ts";

const headers = (init: Record<string, string>) => new Headers(init);
const heroku = { trustedHops: 1 };

describe("clientIp under direct Heroku routing", () => {
  test("reads the entry the router appended — the rightmost — never the leftmost", () => {
    // The client typed `X-Forwarded-For: 203.0.113.5`; the router appended the
    // peer it actually saw. The forged entry must not be selected.
    assert.equal(
      clientIp(headers({ "x-forwarded-for": "203.0.113.5, 198.51.100.7" }), heroku),
      "198.51.100.7",
    );
    assert.equal(
      clientIp(headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 198.51.100.7" }), heroku),
      "198.51.100.7",
    );
  });

  test("a single entry is the peer itself", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "198.51.100.7" }), heroku), "198.51.100.7");
  });

  test("a forged rightmost entry cannot get past the router, so junk there is null", () => {
    // Behind the router the last entry is always the router's own reading; if
    // it is not an address the request did not come through the router.
    assert.equal(clientIp(headers({ "x-forwarded-for": "198.51.100.7, evil" }), heroku), null);
  });

  test("the default policy is one trusted hop", () => {
    assert.equal(DEFAULT_TRUSTED_PROXY_HOPS, 1);
    assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.5, 198.51.100.7" })), "198.51.100.7");
  });
});

describe("a CDN in front of Heroku is one more trusted hop", () => {
  test("hops=2 reads the entry the CDN saw", () => {
    const policy = { trustedHops: 2 };
    assert.equal(
      clientIp(headers({ "x-forwarded-for": "forged, 198.51.100.7, 203.0.113.9" }), policy),
      "198.51.100.7",
    );
  });

  test("a chain shorter than the trusted hops carries no client", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.9" }), { trustedHops: 2 }), null);
  });
});

describe("no trusted proxy", () => {
  test("hops=0 ignores the header entirely", () => {
    assert.equal(clientIp(headers({ "x-forwarded-for": "198.51.100.7" }), { trustedHops: 0 }), null);
  });
});

describe("absent or malformed forwarding information", () => {
  test("no header is null, not a sentinel", () => {
    assert.equal(clientIp(headers({}), heroku), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": "" }), heroku), null);
    assert.equal(clientIp(headers({ "x-forwarded-for": " , " }), heroku), null);
  });

  test("x-real-ip is never read", () => {
    assert.equal(clientIp(headers({ "x-real-ip": "203.0.113.9" }), heroku), null);
  });

  test("an unparseable address is refused whole rather than truncated", () => {
    for (const raw of [
      "unknown",
      "999.999.999.999",
      "1.2.3",
      "1.2.3.4.5",
      ":::",
      "[::1]",
      "198.51.100.7:443",
      "fe80::1%eth0",
      "1".repeat(500),
      `198.51.100.7${"0".repeat(40)}`,
    ]) {
      assert.equal(clientIp(headers({ "x-forwarded-for": raw }), heroku), null, raw);
    }
  });

  test("clientKey folds an absent address into one shared bucket", () => {
    assert.equal(clientKey(headers({}), heroku), "unknown");
    assert.equal(clientKey(headers({ "x-forwarded-for": "198.51.100.7" }), heroku), "198.51.100.7");
  });
});

describe("supported address forms", () => {
  test("IPv4 in range, and not out of it", () => {
    assert.equal(isAddress("255.255.255.255"), true);
    assert.equal(isAddress("0.0.0.0"), true);
    assert.equal(isAddress("256.1.1.1"), false);
  });

  test("IPv6 full and elided, lower-cased", () => {
    assert.equal(normalizeAddress("2001:DB8:85a3::8A2E:370:7334"), "2001:db8:85a3::8a2e:370:7334");
    assert.equal(isAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), true);
    assert.equal(isAddress("::1"), true);
    assert.equal(isAddress("::"), true);
  });

  test("an IPv4-mapped IPv6 address is unwrapped", () => {
    assert.equal(normalizeAddress("::ffff:203.0.113.5"), "203.0.113.5");
    assert.equal(normalizeAddress("::FFFF:203.0.113.5"), "203.0.113.5");
    assert.equal(
      clientIp(headers({ "x-forwarded-for": "::ffff:203.0.113.5" }), heroku),
      "203.0.113.5",
    );
  });

  test("surrounding whitespace is tolerated, inner whitespace is not", () => {
    assert.equal(normalizeAddress("  198.51.100.7 "), "198.51.100.7");
    assert.equal(normalizeAddress("198.51 .100.7"), null);
  });
});

describe("clientIpPolicy", () => {
  test("reads the hop count, and defaults to Heroku's one", () => {
    assert.deepEqual(clientIpPolicy({}), { trustedHops: 1 });
    assert.deepEqual(clientIpPolicy({ [TRUSTED_PROXY_HOPS_VAR]: "2" }), { trustedHops: 2 });
    assert.deepEqual(clientIpPolicy({ [TRUSTED_PROXY_HOPS_VAR]: " 0 " }), { trustedHops: 0 });
  });

  test("junk falls back to the default and says so", () => {
    for (const raw of ["x", "-1", "1.5", "99", ""]) {
      const policy = clientIpPolicy({ [TRUSTED_PROXY_HOPS_VAR]: raw });
      assert.equal(policy.trustedHops, 1, raw);
      if (raw !== "") assert.match(policy.warning ?? "", /TRUSTED_PROXY_HOPS/);
    }
  });
});

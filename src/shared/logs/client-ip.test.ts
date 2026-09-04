import assert from "node:assert/strict";
import { test } from "node:test";

import { clientIp, isAddress } from "./client-ip.ts";

const headers = (init: Record<string, string>) => new Headers(init);

test("reads the client from the head of x-forwarded-for", () => {
  // The list grows hop by hop, so the client is first and the rest are proxies.
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 10.0.0.1" })),
    "203.0.113.5",
  );
});

test("unwraps an IPv4-mapped IPv6 address", () => {
  // A dual-stack listener reports a v4 client this way; stored mapped, one
  // visitor reads as two addresses depending on which socket answered.
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "::ffff:203.0.113.5" })),
    "203.0.113.5",
  );
});

test("falls back to x-real-ip", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
});

test("no usable header is null, not a sentinel", () => {
  // The whole point of the module: the ported original returns "Unknown IP"
  // here, which fails the INET cast and silently loses the row — which is why
  // it has never recorded a local visit.
  assert.equal(clientIp(headers({})), null);
  assert.equal(clientIp(headers({ "x-forwarded-for": "" })), null);
  assert.equal(clientIp(headers({ "x-forwarded-for": "   " })), null);
});

test("an unparseable claim is null rather than passed to Postgres", () => {
  for (const raw of ["unknown", "999.999.999.999", "1.2.3", "1.2.3.4.5", ":::"]) {
    assert.equal(clientIp(headers({ "x-forwarded-for": raw })), null, raw);
  }
});

test("rejects the out-of-range octets a \\d{1,3} pattern would accept", () => {
  // The ported original's IPv4 test is /^(\d{1,3}\.){3}\d{1,3}$/, so this
  // reaches its INET column and throws there instead.
  assert.equal(isAddress("256.1.1.1"), false);
  assert.equal(isAddress("255.255.255.255"), true);
  assert.equal(isAddress("0.0.0.0"), true);
});

test("accepts real IPv6, elided and full", () => {
  assert.equal(isAddress("2001:db8:85a3::8a2e:370:7334"), true);
  assert.equal(isAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), true);
  assert.equal(isAddress("::1"), true);
  assert.equal(isAddress("::"), true);
});

test("a long claim is not an address", () => {
  // x-forwarded-for is attacker-supplied, length included.
  assert.equal(clientIp(headers({ "x-forwarded-for": "1".repeat(500) })), null);
});

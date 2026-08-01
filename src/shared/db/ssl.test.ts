import assert from "node:assert/strict";
import { test } from "node:test";

import { caCertificate, dbSsl, resolveSslMode } from "./ssl.ts";

const LOCAL = "postgres://user:pw@localhost:5432/lab";
const REMOTE = "postgres://user:pw@db.example.com:5432/lab";

test("localhost defaults to no TLS, a remote host to verify-full", () => {
  assert.equal(resolveSslMode({}, LOCAL), "disable");
  assert.equal(resolveSslMode({}, "postgres://u@127.0.0.1/lab"), "disable");
  assert.equal(resolveSslMode({}, REMOTE), "verify-full");
});

test("a remote host verifies the certificate by default — no silent downgrade", () => {
  assert.deepEqual(dbSsl(REMOTE, {}), { rejectUnauthorized: true });
});

test("localhost speaks plaintext", () => {
  assert.equal(dbSsl(LOCAL, {}), false);
});

test("an unparseable connection string is treated as remote", () => {
  assert.equal(resolveSslMode({}, "not a url"), "verify-full");
  assert.equal(resolveSslMode({}, undefined), "verify-full");
});

test("an explicit mode overrides the host default, both ways", () => {
  assert.equal(resolveSslMode({ DATABASE_SSL_MODE: "verify-full" }, LOCAL), "verify-full");
  assert.equal(resolveSslMode({ DATABASE_SSL_MODE: "disable" }, REMOTE), "disable");
});

test("insecure-require is available, and is the only mode that skips verification", () => {
  assert.deepEqual(dbSsl(REMOTE, { DATABASE_SSL_MODE: "insecure-require" }), {
    rejectUnauthorized: false,
  });
});

test("an unsupported mode fails loudly rather than falling back", () => {
  assert.throws(
    () => resolveSslMode({ DATABASE_SSL_MODE: "verifyfull" }, REMOTE),
    /Unsupported DATABASE_SSL_MODE/,
  );
  assert.throws(
    () => resolveSslMode({ DATABASE_SSL: "on" }, REMOTE),
    /Unsupported DATABASE_SSL/,
  );
});

test("the legacy DATABASE_SSL variable keeps working, under honest names", () => {
  assert.equal(resolveSslMode({ DATABASE_SSL: "disable" }, REMOTE), "disable");
  // `require` always meant "TLS without verification" — the behaviour is
  // unchanged, only what it is called.
  assert.equal(resolveSslMode({ DATABASE_SSL: "require" }, LOCAL), "insecure-require");
  assert.deepEqual(dbSsl(LOCAL, { DATABASE_SSL: "require" }), {
    rejectUnauthorized: false,
  });
});

test("DATABASE_SSL_MODE wins over the legacy variable", () => {
  const env = { DATABASE_SSL_MODE: "verify-full", DATABASE_SSL: "require" };
  assert.equal(resolveSslMode(env, REMOTE), "verify-full");
});

test("a supplied CA is attached, with escaped newlines unescaped", () => {
  const pem = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----";
  assert.equal(
    caCertificate({ DATABASE_CA_CERT: pem }),
    "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  );
  assert.deepEqual(dbSsl(REMOTE, { DATABASE_CA_CERT: pem }), {
    rejectUnauthorized: true,
    ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  });
});

test("a real multi-line CA passes through untouched", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
  assert.equal(caCertificate({ DATABASE_CA_CERT: pem }), pem);
});

test("no CA configured is undefined, not an empty string", () => {
  assert.equal(caCertificate({}), undefined);
  assert.equal(caCertificate({ DATABASE_CA_CERT: "  " }), undefined);
});

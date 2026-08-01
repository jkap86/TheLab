import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCertificateVerificationError,
  tlsAdviceFor,
  withTlsAdvice,
} from "./tls-error.ts";

const REMOTE = "postgres://user:pw@db.example.com:5432/lab";

function certError(code = "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"): Error {
  return Object.assign(new Error("unable to get local issuer certificate"), {
    code,
  });
}

test("the advice names the host, the mode and both ways out", () => {
  const advice = tlsAdviceFor(certError(), REMOTE, {});
  assert.ok(advice);
  assert.match(advice, /db\.example\.com:5432/);
  assert.match(advice, /verify-full/);
  assert.match(advice, /DATABASE_CA_CERT/);
  assert.match(advice, /DATABASE_SSL_MODE=insecure-require/);
});

test("the connection string's password never reaches the message", () => {
  const advice = tlsAdviceFor(certError(), REMOTE, {});
  assert.ok(advice && !advice.includes("pw"));
});

test("a configured CA changes the remedy rather than repeating it", () => {
  const advice = tlsAdviceFor(certError(), REMOTE, {
    DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
  });
  assert.ok(advice);
  assert.match(advice, /does not verify this certificate/);
  assert.ok(!advice.includes("Set DATABASE_CA_CERT to the provider's CA"));
});

test("a failure that isn't a certificate is left alone", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  assert.equal(isCertificateVerificationError(refused), false);
  assert.equal(tlsAdviceFor(refused, REMOTE, {}), null);
  assert.equal(withTlsAdvice(refused, REMOTE, {}), refused);
});

test("a mode that doesn't verify gets no advice about verification", () => {
  for (const DATABASE_SSL_MODE of ["insecure-require", "disable"]) {
    assert.equal(tlsAdviceFor(certError(), REMOTE, { DATABASE_SSL_MODE }), null);
  }
});

test("an unsupported mode is somebody else's error to report", () => {
  assert.equal(
    tlsAdviceFor(certError(), REMOTE, { DATABASE_SSL_MODE: "verifyfull" }),
    null,
  );
});

test("every verification code is recognised, not just the local-issuer one", () => {
  for (const code of [
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ]) {
    assert.ok(tlsAdviceFor(certError(code), REMOTE, {}), code);
  }
});

test("the original error survives as the cause", () => {
  const original = certError();
  const wrapped = withTlsAdvice(original, REMOTE, {});
  assert.ok(wrapped instanceof Error);
  assert.equal(wrapped.cause, original);
  assert.notEqual(wrapped.message, original.message);
});

test("an unparseable connection string still produces advice", () => {
  const advice = tlsAdviceFor(certError(), "not a url", {});
  assert.ok(advice);
  assert.match(advice, /the database/);
});

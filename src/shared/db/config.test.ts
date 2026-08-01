import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDatabaseUrl, DATABASE_URL_ENV } from "./config.ts";

test("a configured url resolves in both environments", () => {
  const url = "postgres://user:pw@db.example:5432/lab";
  assert.deepEqual(resolveDatabaseUrl({ DATABASE_URL: url }, true), {
    ok: true,
    url,
  });
  assert.deepEqual(resolveDatabaseUrl({ DATABASE_URL: url }, false), {
    ok: true,
    url,
  });
});

test("production without a url is fatal and names the variable", () => {
  const result = resolveDatabaseUrl({}, true);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.fatal, true);
  assert.match(
    result.ok === false ? result.message : "",
    new RegExp(DATABASE_URL_ENV),
  );
});

test("a blank url is not a url", () => {
  const result = resolveDatabaseUrl({ DATABASE_URL: "   " }, true);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.fatal, true);
});

test("development without a url warns rather than failing", () => {
  const result = resolveDatabaseUrl({}, false);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.fatal, false);
  assert.match(
    result.ok === false ? result.message : "",
    new RegExp(DATABASE_URL_ENV),
  );
});

test("surrounding whitespace is trimmed off a real url", () => {
  const result = resolveDatabaseUrl(
    { DATABASE_URL: "  postgres://localhost/lab \n" },
    true,
  );
  assert.equal(result.ok === true && result.url, "postgres://localhost/lab");
});

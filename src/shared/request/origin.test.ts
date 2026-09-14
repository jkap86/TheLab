import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sameOriginRequest } from "./origin.ts";

const headers = (init: Record<string, string>) => new Headers(init);

describe("sameOriginRequest", () => {
  test("a browser page on this host, over the scheme the router saw, passes", () => {
    const check = sameOriginRequest(
      headers({
        host: "thelab.app",
        origin: "https://thelab.app",
        "sec-fetch-site": "same-origin",
        "x-forwarded-proto": "https",
      }),
    );
    assert.deepEqual(check, { ok: true });
  });

  test("a cross-site page is refused by either header alone", () => {
    assert.equal(
      sameOriginRequest(
        headers({ host: "thelab.app", origin: "https://evil.example", "x-forwarded-proto": "https" }),
      ).ok,
      false,
    );
    assert.equal(
      sameOriginRequest(
        headers({
          host: "thelab.app",
          origin: "https://thelab.app",
          "sec-fetch-site": "cross-site",
          "x-forwarded-proto": "https",
        }),
      ).ok,
      false,
    );
  });

  test("a request with neither header is not a browser page and is refused", () => {
    assert.equal(sameOriginRequest(headers({ host: "thelab.app" })).ok, false);
  });

  test("an opaque or unreadable origin is refused", () => {
    assert.equal(sameOriginRequest(headers({ host: "thelab.app", origin: "null" })).ok, false);
    assert.equal(sameOriginRequest(headers({ host: "thelab.app", origin: "not a url" })).ok, false);
  });

  test("a downgraded origin scheme is refused", () => {
    assert.equal(
      sameOriginRequest(
        headers({ host: "thelab.app", origin: "http://thelab.app", "x-forwarded-proto": "https" }),
      ).ok,
      false,
    );
  });

  test("with no proxy in front the scheme is not compared, so development passes", () => {
    assert.deepEqual(
      sameOriginRequest(headers({ host: "localhost:3000", origin: "http://localhost:3000" })),
      { ok: true },
    );
  });

  test("x-forwarded-host is not consulted", () => {
    assert.equal(
      sameOriginRequest(
        headers({
          host: "thelab.app",
          "x-forwarded-host": "evil.example",
          origin: "https://evil.example",
          "x-forwarded-proto": "https",
        }),
      ).ok,
      false,
    );
  });

  test("the host comparison is case-insensitive", () => {
    assert.equal(
      sameOriginRequest(headers({ host: "TheLab.app", origin: "https://thelab.app", "x-forwarded-proto": "https" })).ok,
      true,
    );
  });
});

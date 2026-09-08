import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSiteUrl, SITE_URL_ENV } from "./site-url.ts";

describe("resolveSiteUrl", () => {
  test("takes a configured origin and drops any path", () => {
    const { url, warning } = resolveSiteUrl(
      { [SITE_URL_ENV]: "https://thelab.example/tools" },
      true,
    );
    assert.equal(url, "https://thelab.example");
    assert.equal(warning, undefined);
  });

  test("reads a bare hostname as https", () => {
    // The only thing it can mean in a deployment config, and `new URL` throws
    // on it rather than guessing.
    assert.equal(
      resolveSiteUrl({ [SITE_URL_ENV]: "thelab.example" }, true).url,
      "https://thelab.example",
    );
  });

  test("keeps an explicit http origin", () => {
    assert.equal(
      resolveSiteUrl({ [SITE_URL_ENV]: "http://192.168.1.4:3000" }, false).url,
      "http://192.168.1.4:3000",
    );
  });

  test("is silent about an unset variable in development", () => {
    const { url, warning } = resolveSiteUrl({}, false);
    assert.equal(url, "http://localhost:3000");
    assert.equal(warning, undefined);
  });

  test("warns about an unset variable in production, and still answers", () => {
    // Not fatal, unlike DATABASE_URL: refusing to boot over an unfurl would be
    // worse than the unfurl. But the only other symptom is a link that quietly
    // stops previewing, so it has to say so.
    const { url, warning } = resolveSiteUrl({}, true);
    assert.equal(url, "http://localhost:3000");
    assert.match(warning ?? "", new RegExp(SITE_URL_ENV));
    // And it has to name build time: a prerendered page bakes the origin then,
    // so setting the variable only in the dyno's runtime config fixes the
    // dynamic routes and leaves every static page pointing at localhost.
    assert.match(warning ?? "", /build/);
  });

  test("warns about a value that is not a URL rather than throwing", () => {
    const { url, warning } = resolveSiteUrl({ [SITE_URL_ENV]: "http://" }, true);
    assert.equal(url, "http://localhost:3000");
    assert.match(warning ?? "", new RegExp(SITE_URL_ENV));
  });

  test("treats whitespace as unset", () => {
    assert.equal(resolveSiteUrl({ [SITE_URL_ENV]: "   " }, false).url, "http://localhost:3000");
  });
});

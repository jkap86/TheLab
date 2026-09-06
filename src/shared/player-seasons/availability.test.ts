import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COMPS_SAMPLE_CORPUS_ENV, sampleCorpusAccess } from "./availability.ts";

const on = { [COMPS_SAMPLE_CORPUS_ENV]: "on" };
const off = { [COMPS_SAMPLE_CORPUS_ENV]: "off" };

/**
 * The gate that stops a deployed page quietly serving twenty-six invented
 * seasons. It is a decision rather than a consequence of an empty table
 * precisely because the failure is invisible: the board renders, the
 * percentages look plausible, and the only thing saying so is a caption.
 */
describe("sampleCorpusAccess", () => {
  test("production does not fall back to the sample by default", () => {
    const access = sampleCorpusAccess({}, true);
    assert.equal(access.allowed, false);
    // The reason names the way out, because the person who sees it is the
    // person who can run the loader.
    assert.match(access.reason, /comps:load-corpus/);
    assert.match(access.reason, new RegExp(COMPS_SAMPLE_CORPUS_ENV));
  });

  test("development does, so a checkout with no database still renders", () => {
    const access = sampleCorpusAccess({}, false);
    assert.equal(access.allowed, true);
    assert.match(access.reason, /sample corpus/);
  });

  test("`off` denies it everywhere, `on` allows it everywhere", () => {
    assert.equal(sampleCorpusAccess(off, false).allowed, false);
    assert.equal(sampleCorpusAccess(off, true).allowed, false);
    assert.equal(sampleCorpusAccess(on, false).allowed, true);
    // A demo or preview build says so out loud and gets it.
    assert.equal(sampleCorpusAccess(on, true).allowed, true);
  });

  test("case and whitespace do not change the answer", () => {
    assert.equal(sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: " ON " }, true).allowed, true);
    assert.equal(sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: "Off" }, false).allowed, false);
  });

  test("junk is not consent: it falls to the environment's default and says so", () => {
    // `COMPS_SAMPLE_CORPUS=yes` in production is a typo, and reading a typo as
    // an opt-in ships exactly what this gate exists to prevent.
    const production = sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: "yes" }, true);
    assert.equal(production.allowed, false);
    assert.match(production.reason, /not "on" or "off"/);

    const development = sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: "true" }, false);
    assert.equal(development.allowed, true);
    assert.match(development.reason, /not "on" or "off"/);
  });

  test("an empty value counts as unset", () => {
    assert.equal(sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: "   " }, true).allowed, false);
    assert.equal(sampleCorpusAccess({ [COMPS_SAMPLE_CORPUS_ENV]: "" }, false).allowed, true);
  });
});

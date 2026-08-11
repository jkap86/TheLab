import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

/**
 * **This reads `index.ts` as text rather than importing it, and it has to.**
 * That module's whole content is `localFont()` calls, which only mean anything
 * inside the bundler — `next/font/local` is a build-time transform, not a
 * function this runner could call. What is being checked is the *source*
 * anyway: the twelve calls are spelled out as literals because Turbopack parses
 * them instead of running them (see the note at the top of `index.ts`), and
 * literal repetition is exactly the thing that drifts.
 *
 * The failure it exists to catch is silent by construction. A `unicode-range`
 * that disagrees between two files of one family does not error and does not
 * warn — a character simply falls to whichever file claims it, or to the
 * fallback face if none does, on some rows of some pages for some accounts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "index.ts"), "utf8");

/**
 * The one place a subset's range is written down for the test to compare
 * against. `index.ts` cannot import this and this cannot import `index.ts`;
 * that they agree is the assertion, and it is the agreement no type can carry.
 */
const RANGES: Record<string, string> = {
  latin:
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  cyrillic: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
  "cyrillic-ext":
    "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
  vietnamese:
    "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
  symbols2: "U+2000-2001, U+2004-2008, U+200A, U+23B8-23BD, U+2500-259F",
};

/**
 * The three families, keyed by the filename prefix that identifies them.
 *
 * Nothing here names `Geist` or `Orbitron`: `next/font/local` calls a face after
 * the identifier it is assigned to, so the family names are the *export names*
 * in `index.ts`, and those are read out of the source rather than restated —
 * pinning a name here would only assert that this file and that one were typed
 * the same day. What is asserted is the linkage: a primary's identifier is what
 * its subsets must declare, and renaming the export without following it through
 * orphans four files with no error anywhere.
 */
const FAMILY_KEYS = ["geist", "geist-mono", "orbitron"] as const;

interface FontCall {
  src: string;
  /** The `font-family` declared, or null on a primary, which declares none. */
  family: string | null;
  range: string;
  weight: string;
  variable: string | null;
  preload: boolean;
  /** The file's stem, e.g. `geist-mono-latin-ext`. */
  stem: string;
  /** The family prefix of that stem, e.g. `geist-mono`. */
  familyKey: string;
  /** The subset suffix of that stem, e.g. `latin-ext`. */
  subset: string;
  /** The identifier this call is assigned to, e.g. `geistSans`. */
  binding: string;
}

/**
 * Every `localFont({ … })` in the source, read as text.
 *
 * The parse is deliberately literal-only — it matches `value: "…"` and nothing
 * else — because that is precisely the shape Turbopack accepts. A call this
 * cannot read is a call Turbopack could not read either, so an unparseable one
 * is a failure rather than a skip.
 */
function parseFontCalls(source: string): FontCall[] {
  const calls: FontCall[] = [];
  const opener = /(?:export\s+)?const\s+(\w+)\s*=\s*localFont\(\{/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    // Walk braces from the `{` of the options object to its match, so a nested
    // `declarations` array can't end the block early.
    const start = source.indexOf("{", match.index);
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(start, end + 1);

    const src = /src:\s*"([^"]+)"/.exec(body)?.[1];
    const family = /\{\s*prop:\s*"font-family",\s*value:\s*"([^"]+)"\s*\}/.exec(
      body,
    )?.[1];
    const range =
      /\{\s*prop:\s*"unicode-range",\s*value:\s*"([^"]+)"\s*\}/.exec(body)?.[1];
    const weight = /weight:\s*"([^"]+)"/.exec(body)?.[1];

    assert.ok(src, `a localFont call has no literal src:\n${body}`);
    assert.ok(range, `${src} has no literal unicode-range declaration`);
    assert.ok(weight, `${src} has no literal weight`);

    const stem = src.replace(/^\.\//, "").replace(/\.woff2$/, "");
    const familyKey = FAMILY_KEYS.filter(
      (key) => stem === key || stem.startsWith(`${key}-`),
    )
      // `geist-mono` and `geist` both prefix `geist-mono-latin`; the longer wins.
      .sort((a, b) => b.length - a.length)[0];
    assert.ok(familyKey, `${src} does not name a known family`);

    calls.push({
      src,
      family: family ?? null,
      range,
      weight,
      variable: /variable:\s*"([^"]+)"/.exec(body)?.[1] ?? null,
      preload: !/preload:\s*false/.test(body),
      stem,
      familyKey,
      subset: stem.slice(familyKey.length + 1),
      binding: match[1],
    });
  }

  return calls;
}

const CALLS = parseFontCalls(SOURCE);

describe("the self-hosted font declarations", () => {
  test("every woff2 in this folder is declared, and every declaration has its file", () => {
    const onDisk = readdirSync(HERE)
      .filter((name) => name.endsWith(".woff2"))
      .sort();
    const declared = CALLS.map((call) => `${call.stem}.woff2`).sort();

    // Both directions: an undeclared file is dead weight in the repository, and
    // a declared file that isn't there fails the build rather than the page.
    assert.deepEqual(declared, onDisk);
  });

  test("each file is a real woff2", () => {
    for (const call of CALLS) {
      const head = readFileSync(join(HERE, `${call.stem}.woff2`)).subarray(0, 4);
      assert.equal(
        head.toString("ascii"),
        "wOF2",
        `${call.src} is not a woff2 — a woff or ttf renamed will not decode`,
      );
    }
  });

  test("a subset's range is the same wherever it is spelled", () => {
    for (const call of CALLS) {
      assert.equal(
        call.range,
        RANGES[call.subset],
        `${call.src} declares a range that is not ${call.subset}'s`,
      );
    }
  });

  test("every range in the table is used, so a retired subset takes its row with it", () => {
    const used = new Set(CALLS.map((call) => call.subset));
    assert.deepEqual([...used].sort(), Object.keys(RANGES).sort());
  });

  test("each family declares exactly one variable, on its latin file", () => {
    // The variable is what `globals.css` resolves and what the markup wears, so
    // a second one for the same family is a second name for one face, and a
    // variable on a non-latin subset would tie the whole family's presence to a
    // file most readers never download.
    for (const key of FAMILY_KEYS) {
      const named = CALLS.filter(
        (call) => call.familyKey === key && call.variable !== null,
      );
      assert.equal(named.length, 1, `${key} does not declare one variable`);
      assert.equal(named[0].subset, "latin");
    }
  });

  test("a primary declares no font-family, so its variable and its face agree", () => {
    // Declaring one changes the `@font-face` and leaves the CSS variable
    // pointing at the generated name, which is the silent Arial-everywhere
    // failure argued at the top of `index.ts`.
    for (const call of CALLS.filter((c) => c.variable !== null)) {
      assert.equal(
        call.family,
        null,
        `${call.src} declares a font-family alongside ${call.variable}`,
      );
    }
  });

  test("a subset declares its own family's generated name", () => {
    // The generated name is the primary's *identifier*, so this is the one
    // agreement a rename breaks in silence: the subset keeps loading, joins a
    // family nothing references, and its characters fall to the fallback face.
    for (const key of FAMILY_KEYS) {
      const family = CALLS.find(
        (call) => call.familyKey === key && call.variable !== null,
      );
      assert.ok(family, `${key} has no primary call`);

      for (const subset of CALLS.filter(
        (call) => call.familyKey === key && call.variable === null,
      )) {
        assert.equal(
          subset.family,
          family.binding,
          `${subset.src} joins a family that is not ${family.binding}`,
        );
      }
    }
  });

  test("latin is preloaded and nothing else is", () => {
    // This is what `subsets: ["latin"]` bought under the Google loader: a page
    // that never renders a Cyrillic name never spends a request finding out.
    for (const call of CALLS) {
      assert.equal(
        call.preload,
        call.subset === "latin",
        `${call.src} is on the wrong side of the preload split`,
      );
    }
  });

  test("a family's subsets agree on the weight axis", () => {
    // One family rendered at two axes is one family drawn two ways, and it only
    // shows on the characters the odd file out covers.
    for (const key of FAMILY_KEYS) {
      const weights = new Set(
        CALLS.filter((call) => call.familyKey === key).map(
          (call) => call.weight,
        ),
      );
      assert.equal(weights.size, 1, `${key} spans two weight axes`);
    }
  });

  test("nothing imports next/font/google any more", () => {
    // The whole point of the folder. A single `next/font/google` import puts the
    // build back on a Google fetch that can 404 on a deploy carrying no font
    // change at all — so this matches an import specifier, not a mention: both
    // files argue at length about the loader they left, in prose that must stay
    // writable.
    const importsGoogleFont = /\bfrom\s*["']next\/font\/google["']/;
    const layout = readFileSync(join(HERE, "..", "layout.tsx"), "utf8");

    assert.doesNotMatch(SOURCE, importsGoogleFont);
    assert.doesNotMatch(layout, importsGoogleFont);
  });
});

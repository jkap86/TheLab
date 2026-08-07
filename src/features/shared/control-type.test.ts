import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  IOS_NO_ZOOM_PX,
  SEARCH_FIELD,
  compactInput,
  compactSelect,
  mobileInputText,
  mobileSelectText,
} from "./control-type.ts";

/**
 * The floor is a platform rule, so the interesting test is not "do the tokens
 * say 16px" — it is **"is there a control anywhere in the tree that doesn't"**.
 *
 * That is the failure this guards: the tokens are correct on the day they are
 * written and the zoom comes back the next time somebody reaches for `text-xs`
 * because a row is tight. Nothing in the type system can see it, review misses
 * it (a size on a control looks exactly like a size on a label), and the symptom
 * only appears on a phone. So the tree is read back.
 *
 * The scan is deliberately conservative about what it *exempts* rather than
 * about what it flags: an unrecognised control fails and has to be spelled, so a
 * new kind of field cannot pass by being unfamiliar.
 */

const SRC = join(import.meta.dirname, "../..");

/** Tailwind's named sizes, in px against the 16px root `globals.css` pins. */
const NAMED_SIZES: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
};

/**
 * The shared tokens, by the name a call site refers to them under.
 *
 * A `className` naming one of these has met the floor by construction — the
 * assertions below pin that — so the scan does not have to resolve the import.
 */
const TOKEN_NAMES = new Set([
  "mobileInputText",
  "mobileSelectText",
  "compactInput",
  "compactSelect",
  "SEARCH_FIELD",
]);

/**
 * Input types iOS does not zoom for, because none of them takes typed text.
 *
 * `range` is the one that actually appears here (the ADP drawer's value curve);
 * the rest are listed so a future control is exempted for the real reason rather
 * than by being overlooked.
 */
const NO_TEXT_ENTRY = new Set([
  "range",
  "checkbox",
  "radio",
  "color",
  "file",
  "hidden",
  "button",
  "submit",
  "reset",
  "image",
]);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * The opening tag starting at `from`, as source text.
 *
 * Brace- and quote-aware rather than a search for the next `>`, because these
 * tags carry handlers (`onChange={(e) => …}`) and comparisons that contain the
 * character the naive version would stop at.
 */
function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return source.slice(from, i + 1);
  }
  return source.slice(from);
}

/**
 * The source with its comments blanked out, quote- and template-aware.
 *
 * Necessary rather than fastidious: this codebase argues its decisions in prose,
 * so half the files that *draw* a `<select>` also spell one inside a JSDoc block
 * — including the two that explain this very rule. A scan that reads those finds
 * a control with no `className` and reports the documentation as the bug.
 * Blanked to spaces rather than removed, so nothing downstream has to care.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i += 1;
      }
      out += source[i] ?? "";
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Newlines are kept so any line-based reading of the result still lines up.
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Every `const NAME = "…"` / `` `…` `` in a file, so a `${NAME}` can be read. */
function localStrings(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const m of source.matchAll(re)) out.set(m[1], m[2].slice(1, -1));
  return out;
}

/** A class expression with its local `${…}` references substituted in. */
function expand(text: string, locals: Map<string, string>, depth = 0): string {
  if (depth > 3) return text;
  return text.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) => {
    const value = locals.get(name);
    return value === undefined ? whole : expand(value, locals, depth + 1);
  });
}

/** Every `text-…` size in a class expression, in px. Unparseable sizes are kept. */
function declaredSizes(classText: string): { token: string; px: number | null }[] {
  const out: { token: string; px: number | null }[] = [];
  for (const m of classText.matchAll(/(?:^|[\s`"'{}])text-\[([^\]]+)\]/g)) {
    const value = m[1];
    const px = /^([\d.]+)px$/.test(value)
      ? Number.parseFloat(value)
      : /^([\d.]+)rem$/.test(value)
        ? Number.parseFloat(value) * 16
        : null;
    out.push({ token: `text-[${value}]`, px });
  }
  for (const m of classText.matchAll(/(?:^|[\s`"'{}])text-([a-z0-9]+)(?![\w-])/g)) {
    const px = NAMED_SIZES[m[1]];
    if (px !== undefined) out.push({ token: `text-${m[1]}`, px });
  }
  return out;
}

test("the shared tokens are at or above the size iOS stops zooming at", () => {
  assert.equal(IOS_NO_ZOOM_PX, 16);
  for (const [name, token] of [
    ["mobileInputText", mobileInputText],
    ["mobileSelectText", mobileSelectText],
    ["compactInput", compactInput],
    ["compactSelect", compactSelect],
    ["SEARCH_FIELD", SEARCH_FIELD],
  ] as const) {
    const sizes = declaredSizes(` ${token} `);
    assert.equal(sizes.length, 1, `${name} should declare exactly one text size`);
    assert.ok(
      sizes[0].px !== null && sizes[0].px >= IOS_NO_ZOOM_PX,
      `${name} declares ${sizes[0].token}, under the ${IOS_NO_ZOOM_PX}px floor`,
    );
    // The height a field keeps is its line box plus its padding, and every
    // before/after measurement in `control-type.ts` rests on this being pinned
    // rather than left at the browser's `normal`.
    assert.match(token, /leading-\d/, `${name} should pin its line-height`);
  }
});

test("every focusable control in the tree is at the floor", () => {
  const offenders: string[] = [];
  const seen: string[] = [];

  for (const file of tsxFiles(SRC)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const locals = localStrings(source);

    for (const m of source.matchAll(/<(input|select|textarea)[\s/>]/g)) {
      const tag = openingTag(source, m.index);
      const where = `${file.slice(SRC.length + 1)} <${m[1]}>`;

      const type = /\btype=["']([a-z-]+)["']/.exec(tag)?.[1];
      if (type !== undefined && NO_TEXT_ENTRY.has(type)) continue;
      seen.push(where);

      const classMatch = /\bclassName=(\{`[^`]*`\}|\{[^}]*\}|"[^"]*")/.exec(tag);
      if (classMatch === null) {
        offenders.push(`${where} — no className, so it inherits and may be under the floor`);
        continue;
      }
      const classText = expand(classMatch[1], locals);

      // A token by name is the floor by construction — pinned by the test above.
      const named = [...TOKEN_NAMES].some((t) =>
        new RegExp(`(?:^|[^\\w$])${t}(?![\\w$])`).test(classText),
      );

      const sizes = declaredSizes(classText);
      const tooSmall = sizes.filter((s) => s.px === null || s.px < IOS_NO_ZOOM_PX);
      if (tooSmall.length > 0) {
        offenders.push(
          `${where} — ${tooSmall.map((s) => s.token).join(", ")} is under ${IOS_NO_ZOOM_PX}px`,
        );
      } else if (!named && sizes.length === 0) {
        offenders.push(
          `${where} — no text size and no shared token, so it inherits whatever it lands in`,
        );
      }
    }
  }

  // The scan is worthless if it silently stops finding controls — a refactor
  // that renames the elements or reshapes the tags would otherwise read as a
  // pass. The count is a floor rather than an equality so adding a field is not
  // a failing test.
  assert.ok(
    seen.length >= 14,
    `expected the scan to reach every focusable control, found ${seen.length}`,
  );
  assert.deepEqual(offenders, [], `controls under the iOS zoom floor:\n  ${offenders.join("\n  ")}`);
});

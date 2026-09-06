import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * A module resolver that reads this repo's own import conventions, so a
 * standalone script can run its source under `node` directly.
 *
 * Two things stop plain Node from loading `src/`: the `@/*` and `@thelab/http`
 * aliases, which live in `tsconfig.json` and mean nothing to a runtime, and
 * extensionless relative imports (`from "./ssl"`), which every runtime module
 * here uses because a bundler resolves them. `npm test` avoids both by
 * accident — its imports of aliased modules are type-only, and its relative
 * imports carry an explicit `.ts` — which is exactly why the failure looks
 * surprising the first time a script hits it.
 *
 * So this hook does the two things the bundler does: map the aliases, and try
 * the extensions. It is deliberately not a general TypeScript resolver — no
 * `paths` parsing, no `baseUrl`, no `exports` handling — because the two rules
 * above are the whole of what this repo relies on, and a resolver that guessed
 * more would be a second, quieter answer to "where does this import go" beside
 * the bundler's.
 *
 * `format: "module-typescript"` is what keeps Node's own `--experimental-strip-types`
 * in the loop for a `.ts` file the hook resolved. Returning a bare `"module"`
 * hands the file to the plain ESM loader, which then fails on the first `type`
 * import with a `SyntaxError` naming a line that is perfectly valid TypeScript.
 */

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const src = path.join(root, "src");

/** In the order a bundler would try them. */
const CANDIDATES = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx", "/index.js"];

const isFile = (candidate) => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

function resolveFile(base) {
  if (isFile(base)) return base;
  for (const suffix of CANDIDATES) {
    const candidate = base + suffix;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let target = null;

  if (specifier === "@thelab/http") {
    target = path.join(src, "shared/http");
  } else if (specifier.startsWith("@/")) {
    target = path.join(src, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (target) {
    const file = resolveFile(target);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true, format: formatOf(file) };
  }

  // Anything else — a bare package, and the entry module itself — resolves
  // normally and is only stamped, so a `.ts` entry passed on the command line
  // reaches the same stripping path its imports do.
  const resolved = await next(specifier, context);
  if (!resolved.format) {
    const format = formatOf(resolved.url);
    if (format) return { ...resolved, format };
  }
  return resolved;
}

function formatOf(target) {
  return target.endsWith(".ts") || target.endsWith(".tsx") || target.endsWith(".mts")
    ? "module-typescript"
    : undefined;
}

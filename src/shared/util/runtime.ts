/**
 * Which JavaScript runtime this module is being evaluated in.
 *
 * Pure — the environment arrives as an argument — because the answer decides
 * whether a background loop starts at all, and "did it start" is exactly the
 * kind of thing that must be checkable without booting a server.
 */

/** The variable Next.js sets on every server bundle it evaluates. */
export const NEXT_RUNTIME_VAR = "NEXT_RUNTIME";

/**
 * Whether this is a plain Node.js process.
 *
 * Next.js sets `NEXT_RUNTIME` on **every** server bundle it evaluates —
 * `"nodejs"` or `"edge"` — so inside Next the variable is present and its value
 * is the whole answer. Outside Next it is absent, and absent means a bare Node
 * process: `node`/`tsx` running `src/worker.ts`, or a test.
 *
 * The distinction matters because the guard this backs used to be spelled
 * `process.env.NEXT_RUNTIME !== "nodejs"`, which reads as "Node only" and
 * actually means "**Next's** Node only" — a dedicated worker, the one process
 * that exists to run these loops, would have started none of them and said
 * nothing about it. Read the absence as Node rather than as not-Node, and the
 * Edge bundle is still excluded by the only value that names it.
 */
export function isNodeRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const runtime = env[NEXT_RUNTIME_VAR]?.trim();
  return !runtime || runtime === "nodejs";
}

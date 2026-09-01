/**
 * The human-readable message for a caught value.
 *
 * `catch` binds `unknown` — almost always an `Error`, but a thrown string or
 * object is legal — so this narrows to something loggable without the
 * `instanceof` dance at every call site.
 *
 * With no `fallback`, a non-Error is returned as-is (handy for `console.error`,
 * which renders objects usefully). Pass a `fallback` when the result has to be
 * a string, e.g. a message shown to a user.
 */
export function errorMessage(error: unknown): string | unknown;
export function errorMessage(error: unknown, fallback: string): string;
export function errorMessage(error: unknown, fallback?: string): unknown {
  if (error instanceof Error) return error.message;
  return fallback ?? error;
}

import type { ApiErrorPayload } from "@/shared/contract";

/**
 * `fetch` for this app's own API routes.
 *
 * Turns a non-2xx into a thrown `Error` carrying the server's own message,
 * which every route sends as {@link ApiErrorPayload}, so callers get one
 * failure mode (a throw) instead of having to check `res.ok` and dig the
 * message out themselves.
 *
 * `fallbackError` is used only when the response carries no readable body —
 * a proxy error page or a dropped connection mid-response.
 */
export async function apiFetch(
  url: string,
  init: RequestInit & { fallbackError?: string } = {},
): Promise<Response> {
  const { fallbackError = "Request failed", ...requestInit } = init;

  const res = await fetch(url, requestInit);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
    throw new Error(body?.error ?? `${fallbackError} (${res.status})`);
  }
  return res;
}

/**
 * True for the error `fetch` rejects with when its `AbortController` fires.
 * Unmount and dependency changes abort in flight, which is expected teardown,
 * not a failure worth showing anyone.
 */
export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

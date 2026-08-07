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

/** Read one of this app's JSON routes, as every query hook does. */
export async function fetchJson<T>(
  url: string,
  fallbackError: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await apiFetch(url, { signal, fallbackError });
  return (await res.json()) as T;
}

/**
 * Read a route that may be asked either way: a GET, or a POST carrying what was
 * too long for the request line.
 *
 * **The two are one function because they must stay one *question*.** The query
 * string is identical either way and the route parses it identically; the only
 * difference is where a long list of league ids was read from. A caller never
 * chooses — the builder that produced the request did, off the size of what it
 * had to send — which is what keeps the long case from being a second code path
 * with its own bugs. `/api/trades` was the first route asked this way and
 * `/api/adp` and its two value routes are the rest.
 */
export async function fetchScoped<T>(
  path: string,
  request: { method: "GET" | "POST"; search: URLSearchParams; body: unknown },
  fallbackError: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await apiFetch(`${path}?${request.search}`, {
    signal,
    fallbackError,
    ...(request.body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        }
      : null),
  });
  return (await res.json()) as T;
}

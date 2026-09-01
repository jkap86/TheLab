/**
 * The one HTTP client every outbound request in this app goes through.
 *
 * TheLabX builds this on axios + axios-retry behind a `@thelab/http` alias. Here
 * it is native `fetch`, for two reasons. This app carries no runtime dependency
 * outside React and Next, and adding two to fetch a JSON document is a poor
 * trade. And axios-retry's ladder — three retries at 3s/5s/7s on top of a 30s
 * timeout each, `shouldResetTimeout` and all — is up to ~141s of a request's
 * life spent re-dialling an upstream; `shared/season` documents that exact
 * ladder as what made a cold season resolve unacceptable in front of a request.
 * The backoff here is bounded in milliseconds rather than minutes.
 *
 * **The shape TheLabX's callers expect is kept exactly**, because the Sleeper
 * client was ported from it verbatim: {@link get} resolves to a `{ data }`
 * envelope, and a non-2xx throws an error carrying `response.status` — which is
 * the whole of what `sleeper/missing` reads to tell "no such thing" from a
 * fault. A port back to axios would not touch a caller.
 */

/** Per-attempt ceiling. Sleeper is occasionally slow rather than down. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Attempts after the first. Three is TheLabX's number, kept. */
export const DEFAULT_RETRIES = 3;

/** Doubles per attempt: 300ms, 600ms, 1200ms. */
const RETRY_BASE_DELAY_MS = 300;

/**
 * A response the server actually sent, with a status outside 2xx.
 *
 * `response.status` is the field and the name is deliberate: it is the shape
 * `AxiosError` has, so {@link isMissingResource} and anything else reading a
 * status off a rejection works against either client unchanged.
 */
export class HttpError extends Error {
  readonly response: { status: number; statusText: string };

  constructor(status: number, statusText: string, url: string) {
    super(`Request failed with status ${status} (${statusText}): ${url}`);
    this.name = "HttpError";
    this.response = { status, statusText };
  }
}

/**
 * An attempt that ran out its own clock.
 *
 * Distinct from {@link HttpError} because it carries no response, which is the
 * distinction `sleeper/missing` turns on: nothing was learned about whether the
 * resource exists, so this must never be folded into a caller's fallback.
 */
export class HttpTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "HttpTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export type HttpResponse<T> = { data: T; status: number };

export type HttpGetOptions = {
  /** The caller's own cancellation — a request's `AbortSignal`. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Attempts after the first. Zero disables retrying. */
  retries?: number;
};

/**
 * A signal that fires when either the caller aborts or the attempt's clock
 * runs out, composed by hand rather than with `AbortSignal.any` so this does not
 * depend on a lib version.
 */
function attemptSignal(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  // Aborted *with* the timeout error, so `fetch` rejects with it and the retry
  // predicate below sees a timeout rather than a bare AbortError.
  const timer = setTimeout(
    () => controller.abort(new HttpTimeoutError(timeoutMs)),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

async function getOnce<T>(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HttpResponse<T>> {
  const attempt = attemptSignal(timeoutMs, signal);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: attempt.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, url);
    }

    // Read as text first: Sleeper's convention for "no data" is a literal `null`
    // body, and some endpoints answer 200 with nothing at all. Both must parse
    // to null for `sleeperGet` to fold them into its fallback — `response.json()`
    // throws on the empty one.
    const body = await response.text();
    return {
      data: (body ? JSON.parse(body) : null) as T,
      status: response.status,
    };
  } finally {
    attempt.done();
  }
}

/**
 * Whether another attempt could plausibly answer differently.
 *
 * A 5xx, a timeout and a connection failure are all "the server did not say",
 * so they retry. **Every 4xx is final**, which is the half that matters: a 404
 * retried three times is three requests to learn what the first one said, and a
 * 429 retried is a rate limit answered by more requests.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.response.status >= 500;
  if (error instanceof HttpTimeoutError) return true;
  // `fetch` rejects with a TypeError for DNS and connection failures.
  return error instanceof TypeError;
}

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * GET a JSON document, retrying what is worth retrying.
 *
 * The caller's `signal` ends the whole ladder, not just the attempt in flight —
 * a client that has gone should not be waited on through a backoff.
 */
export async function get<T>(
  url: string,
  options: HttpGetOptions = {},
): Promise<HttpResponse<T>> {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getOnce<T>(url, timeoutMs, signal);
    } catch (error) {
      // The caller gave up; nothing below is worth doing.
      if (signal?.aborted) throw error;
      if (attempt >= retries || !isRetryable(error)) throw error;
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
    }
  }
}

/**
 * The client itself, as an object so call sites read `http.get(...)` exactly as
 * they do in TheLabX against the axios instance.
 */
export const http = { get };

export default http;

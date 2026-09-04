/**
 * How a trades request reaches the route: a query string, or a query string
 * that would not fit on a request line.
 *
 * **The parameters are the request** — `params.ts` is the whole vocabulary and
 * every read of this board goes through it — so what this module does is
 * strictly transport: it hands `parseTradeQuery` one `URLSearchParams`
 * whichever way the caller sent it. Nothing here narrows anything, and nothing
 * downstream knows which method was used.
 *
 * **The body form exists because the league scope is not the reader's to
 * size.** The rules run in the browser and only their *answer* crosses the wire
 * (see `features/trades/league-scope`), so a filter over a corpus of two
 * thousand leagues is a thousand ids on the shorter of the include and exclude
 * lists — ~22 encoded characters each, and past a few hundred of them the
 * request line is longer than the 8KB a router will carry. Heroku's answers
 * that with a **431 and an empty body**, which reaches the page as a failed
 * fetch naming nothing: the board goes blank the moment a reader narrows it,
 * which is exactly the case the narrowing exists for. TheLabX has carried a
 * POST form for this since its own corpus grew past a request line; this is
 * that form, and this repo's crawler is what made it earn its place.
 *
 * **A body is the rest of the query string, form-encoded** — not a JSON
 * document with a vocabulary of its own. One spelling of a parameter, one
 * parser, and a key that grows unbounded later needs no new seam: the client
 * moves it off the line and the route folds it back in. `features/trades`'s
 * `tradeHttpRequest` is the matched half, the same standing arrangement
 * `tradeQueryParams` and `parseTradeQuery` already have.
 *
 * Pure, like the parser beside it — `Request`, `URL` and `TextDecoder` are web
 * globals rather than runtime dependencies — so it imports relatively with an
 * explicit `.ts` extension and its test runs under Node's own runner.
 */

/**
 * The most a trades body may carry, in bytes.
 *
 * A bound on what one request can cost rather than a tuning knob — the same
 * thing `MAX_TRADE_PAGE_SIZE` is next door. It is sized against the population
 * rather than against the reader: the longest honest body is the shorter of a
 * corpus's include and exclude lists, so half a megabyte is ~25,000 league ids
 * against a corpus that would have to reach fifty thousand leagues to write
 * one. **Past it the answer is a 413, never a truncated list**: a narrowing
 * quietly cut short is a board that shows trades the reader filtered out, with
 * nothing on screen saying so.
 */
export const MAX_TRADE_BODY_BYTES = 512 * 1024;

/** Merged parameters, or the status the route should answer with instead. */
export type TradeParams =
  | { ok: true; params: URLSearchParams }
  | { ok: false; status: number; error: string };

/**
 * The parameters one request is narrowed by, from the line and — on a POST —
 * from the body as well.
 *
 * Three decisions carry it:
 *
 * - **The body wins on a key both carry.** In practice they never do: the
 *   client moves a parameter off the line rather than duplicating it. But
 *   `list()` reads repeated keys as one list, so folding the two together would
 *   turn a stale line parameter into a *wider* scope — a narrowing that
 *   silently fails open, which is the failure this board is written to avoid
 *   everywhere.
 * - **A body that is not form-encoded is refused rather than read.**
 *   `new URLSearchParams('{"leagues":["a"]}')` parses happily into a key nobody
 *   reads, so a JSON body would arrive as *no narrowing at all* — a plausible
 *   wrong board rather than a visible failure. 415 says which half is wrong.
 * - **The declared length is not trusted; the stream is what is bounded.** A
 *   `Content-Length` header is a claim, and a chunked body carries none, so the
 *   cap is applied as the bytes arrive and the rest is cancelled unread.
 *
 * A GET never has a body to read: it returns the line's parameters untouched,
 * which is what keeps the ordinary board a plain `URL` parse.
 */
export async function readTradeParams(request: Request): Promise<TradeParams> {
  const params = new URL(request.url).searchParams;
  if (request.method !== "POST") return { ok: true, params };

  const type = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== "application/x-www-form-urlencoded") {
    return {
      ok: false,
      status: 415,
      error: "Trade filters must be sent as application/x-www-form-urlencoded.",
    };
  }

  const text = await readBounded(request, MAX_TRADE_BODY_BYTES);
  if (text === null) {
    return {
      ok: false,
      status: 413,
      error: "Trade filters are too large.",
    };
  }

  const body = new URLSearchParams(text);
  const merged = new URLSearchParams(params);
  for (const key of new Set(body.keys())) {
    merged.delete(key);
    for (const value of body.getAll(key)) merged.append(key, value);
  }
  return { ok: true, params: merged };
}

/**
 * The body as text, or null once it has sent more than `limit` bytes.
 *
 * Bounded as it arrives rather than after: `request.text()` buffers whatever
 * was sent before anything can measure it, so the cap it enforces is one the
 * dyno has already paid.
 */
async function readBounded(
  request: Request,
  limit: number,
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

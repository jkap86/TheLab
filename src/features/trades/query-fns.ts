import type { TradesStreamMessage } from "@/shared/contract";

import { apiFetch } from "../shared/api.ts";
import { takeLines } from "../shared/ndjson.ts";
import { applyTradesMessage, EMPTY_TRADES_STREAM } from "./stream.ts";
import type { TradesStreamState } from "./stream.ts";

/**
 * The function behind the trades query: the `/api/trades` stream decoded, folded
 * and published into the cache as it arrives.
 *
 * It lives apart from the hook for the reason `fetchManagerLeagues` does — a
 * function taking its inputs as arguments is one a test can call, where the same
 * logic inside a `useEffect` is only reachable through a renderer. The imports
 * are relative with a `.ts` extension for the same reason, and the fold itself
 * is next door in `./stream`, so what is here is the decoding, the cadence and
 * nothing else.
 */

/**
 * How often a partially-loaded season is handed to React.
 *
 * **The cadence is deliberate and it used to be the network's.** Publishing once
 * per network chunk sounds conservative and isn't: a gzipped NDJSON stream
 * delivers dozens of reads a second, each one re-rendering a page that re-runs
 * two filter passes and re-measures a virtualized list. The season is drawn
 * progressively either way — the reader cannot perceive the difference between
 * a list growing 40 times a second and one growing 3 times a second, and the
 * second one leaves the main thread free to scroll.
 *
 * A third of a second is the slowest cadence that still reads as *live*. Slower
 * and the count line visibly ticks; faster and the renders start costing more
 * than they show.
 */
export const TRADES_PUBLISH_INTERVAL_MS = 300;

export type TradesStreamOptions = {
  season: string;
  signal?: AbortSignal;
  /** Called with each state worth rendering — see the cadence above. */
  publish?: (state: TradesStreamState) => void;
};

/**
 * Read the whole season, publishing what has arrived as it arrives and resolving
 * with the last of it.
 *
 * **It publishes every state it reaches rather than resolving at the end**, the
 * rule `fetchManagerLeagues` follows one tool over: a season is tens of
 * thousands of trades, and a query that resolved once would sit on a loading
 * screen through a response the page could already be drawing. The value it
 * finally resolves with is the one the cache is already holding.
 *
 * Three publishes are **immediate**, and they are the three where a delay would
 * be felt rather than smoothed:
 *
 * - the **first state carrying trades**, because that is the loading spinner
 *   coming off and every millisecond of it is the number this work is about;
 * - **completion**, because the page says "still loading" until it lands and a
 *   third of a second of lying is a third of a second too many;
 * - an **error**, for the same reason.
 *
 * Everything between them is coalesced onto {@link TRADES_PUBLISH_INTERVAL_MS}.
 * A trailing timer covers the case the interval alone can't: a stream that goes
 * quiet with an unpublished change — a slow tail, a paused connection — would
 * otherwise hold that change until the next read, however long that takes.
 */
export async function fetchTrades({
  season,
  signal,
  publish,
}: TradesStreamOptions): Promise<TradesStreamState> {
  let state: TradesStreamState = EMPTY_TRADES_STREAM;
  // Accumulated here rather than read back out of the cache: chunks arrive
  // faster than React commits, so deriving the next value from the last
  // rendered one would drop whatever landed in between.
  let publishedAt = 0;
  let published: TradesStreamState | null = null;
  let trailing: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (trailing !== undefined) {
      clearTimeout(trailing);
      trailing = undefined;
    }
    if (published === state) return;
    published = state;
    publishedAt = Date.now();
    publish?.(state);
  };

  const offer = (immediate: boolean) => {
    if (published === state) return;
    if (immediate || Date.now() - publishedAt >= TRADES_PUBLISH_INTERVAL_MS) {
      flush();
      return;
    }
    // Scheduled once and left alone: re-arming it on every message is how a
    // steady stream starves its own trailing edge forever.
    trailing ??= setTimeout(flush, TRADES_PUBLISH_INTERVAL_MS);
  };

  try {
    const res = await apiFetch(`/api/trades?season=${encodeURIComponent(season)}`, {
      signal,
      fallbackError: "Failed to load trades",
    });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Failed to load trades");

    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      // `stream: true` until the end, so a network chunk that splits a
      // multi-byte character doesn't corrupt a manager's name.
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const { lines, rest } = takeLines(buffer);
      buffer = rest;

      let urgent = done;
      const hadTrades = (state.data?.trades.length ?? 0) > 0;
      for (const line of lines) {
        const message = JSON.parse(line) as TradesStreamMessage;
        state = applyTradesMessage(state, message);
        if (message.type === "error") urgent = true;
      }
      // The spinner coming off — see above.
      if (!hadTrades && (state.data?.trades.length ?? 0) > 0) urgent = true;

      offer(urgent);
      if (done) break;
    }
  } finally {
    // Runs on an abort too, which is what keeps a pending trailing timer from
    // firing into a cache entry the caller has already moved on from.
    if (trailing !== undefined) clearTimeout(trailing);
  }

  return state;
}

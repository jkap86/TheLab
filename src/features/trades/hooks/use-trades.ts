"use client";

import { useEffect, useState } from "react";

import type { TradesStreamMessage } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError, takeLines } from "@/features/shared";
import { applyTradesMessage, EMPTY_TRADES_STREAM } from "../stream";
import type { TradesStreamState } from "../stream";
import type { TradesResult } from "../types";

export type TradesState = {
  /** What has arrived so far — a real prefix of the season, newest first. */
  data: TradesResult | null;
  /** True until the first message arrives. */
  loading: boolean;
  /** True while trades are still arriving, i.e. after the first chunk. */
  streaming: boolean;
  error: string | null;
};

/**
 * Every completed trade in every crawled league, from the `/api/trades` stream.
 *
 * It takes a season and nothing else — unlike the manager tool's sub-resource
 * hooks, which take the leagues array because they read what that stream wrote.
 * This route is not scoped to an account at all, so there is nothing to wait for
 * and the leagues it names come back with it.
 *
 * **It publishes every state it reaches rather than resolving at the end**, the
 * rule `fetchManagerLeagues` follows for the same reason one layer over: a
 * season is tens of thousands of trades, and a hook that waited for the last one
 * would sit on a loading screen through a response the page could already be
 * drawing. Each chunk is merged into what is held and handed straight to the
 * page, so the newest trades are on screen while the rest of the season is still
 * in flight.
 *
 * What that merge *is* lives in `../stream`, pure and tested — the trades append
 * and the three id maps merge, because a chunk is a delta rather than a
 * snapshot. What is left here is the decoding and the React state, which decide
 * nothing; the rules are next door where a test can reach them.
 *
 * Loaded data is not blanked on a refetch, the rule the manager hooks keep: it
 * is the list the page is showing, and clearing thousands of trades to redraw
 * them nearly unchanged is worse than a moment of staleness. A changed *season*
 * is the exception, and it is handled by stamping the state with the season it
 * belongs to rather than by clearing state in an effect — a result for another
 * season is simply not this one's answer, so it reads as "not loaded yet" the
 * render the season changes, with no cascading state update to get there.
 */
export function useTrades(season: string): TradesState {
  const [state, setState] = useState<{
    season: string;
    data: TradesResult | null;
    done: boolean;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      // Accumulated in the closure rather than read back out of state: chunks
      // arrive faster than React commits, so deriving the next value from the
      // last rendered one would drop whatever landed in between.
      let stream: TradesStreamState = EMPTY_TRADES_STREAM;

      const publish = (done: boolean) => {
        if (active) {
          setState({ season, data: stream.data, done, error: stream.error });
        }
      };

      try {
        const res = await apiFetch(
          `/api/trades?season=${encodeURIComponent(season)}`,
          { signal: controller.signal, fallbackError: "Failed to load trades" },
        );
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Failed to load trades");

        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (!active) return;
          // `stream: true` until the end, so a network chunk that splits a
          // multi-byte character doesn't corrupt a manager's name.
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

          const { lines, rest } = takeLines(buffer);
          buffer = rest;
          for (const line of lines) {
            stream = applyTradesMessage(
              stream,
              JSON.parse(line) as TradesStreamMessage,
            );
          }

          // One publish per network chunk rather than per message: several whole
          // lines routinely land together, and the page re-filters everything it
          // holds on every render it is given.
          if (lines.length > 0 || done) publish(done);
          if (done) break;
        }
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          stream = {
            ...stream,
            error: errorMessage(err, "Something went wrong"),
          };
          publish(true);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [season]);

  const mine = state?.season === season ? state : null;
  return {
    data: mine?.data ?? null,
    loading: !mine,
    streaming: mine ? !mine.done : false,
    error: mine?.error ?? null,
  };
}

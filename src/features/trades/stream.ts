import type { TradesStreamMessage } from "@/shared/contract";

import type { TradesResult } from "./types";

/**
 * How the `/api/trades` stream is folded into the season the page renders.
 *
 * Kept apart from the hook that drives it, and pure, for the reason `filters` is
 * kept apart from the modal: these are rules, and they are worth reading and
 * testing without a `fetch` behind them. What the hook is left with is the
 * decoding and the React state, which have nothing to decide.
 *
 * The rules are all versions of one thing — **a chunk is a delta, not a
 * snapshot** — and each of them is a way the page breaks if it is folded in as a
 * replacement instead:
 *
 * - The trades **append**. They arrive newest-first and stay in that order, so a
 *   chunk goes on the end.
 * - The three id maps **merge**. Each chunk carries only the leagues, players and
 *   managers no earlier chunk did, so replacing them would leave every card from
 *   an earlier chunk unable to name its own players — and the effect grows the
 *   further you scroll, which is exactly where it wouldn't be noticed.
 * - A half that gained nothing keeps its **identity**. Most chunks late in a
 *   season name no new league or player at all, and the page memoises on these,
 *   so rebuilding them anyway would re-run every filter pass for no change.
 * - `meta` **opens** a season and a `chunk` before one is dropped. The route
 *   always sends `meta` first, so that is defensive rather than expected — but a
 *   chunk that built its own container would have to invent a `total`, and a
 *   progress line reading "1,000 of 0" is worse than a beat of nothing.
 */
export type TradesStreamState = {
  /** What has arrived so far, or null before the opening `meta`. */
  data: TradesResult | null;
  /** Set by an `error` message, which can arrive after real chunks. */
  error: string | null;
};

export const EMPTY_TRADES_STREAM: TradesStreamState = { data: null, error: null };

/**
 * Fold one message into the state, returning the state unchanged where the
 * message carries nothing — the identity is what the caller's memoisation reads.
 */
export function applyTradesMessage(
  state: TradesStreamState,
  message: TradesStreamMessage,
): TradesStreamState {
  switch (message.type) {
    case "meta":
      return {
        ...state,
        data: {
          season: message.season,
          total: message.total,
          trades: [],
          leagues: [],
          players: {},
          managers: {},
        },
      };

    case "chunk": {
      const { data } = state;
      if (!data) return state;
      if (
        message.trades.length === 0 &&
        message.leagues.length === 0 &&
        Object.keys(message.players).length === 0 &&
        Object.keys(message.managers).length === 0
      ) {
        return state;
      }
      return {
        ...state,
        data: {
          ...data,
          trades: message.trades.length
            ? data.trades.concat(message.trades)
            : data.trades,
          leagues: message.leagues.length
            ? data.leagues.concat(message.leagues)
            : data.leagues,
          players: Object.keys(message.players).length
            ? { ...data.players, ...message.players }
            : data.players,
          managers: Object.keys(message.managers).length
            ? { ...data.managers, ...message.managers }
            : data.managers,
        },
      };
    }

    case "error":
      // Set beside the data rather than in place of it: a failure partway
      // through leaves a real prefix of the season on screen, which beats an
      // empty page. Only a failure before the first `meta` leaves `data` null,
      // and that falls out of this rather than being a case of its own.
      return { ...state, error: message.error };
  }
}

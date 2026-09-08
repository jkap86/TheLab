/**
 * The pick tracker's wire types.
 *
 * Declared here rather than beside the domain, and imported *back* by
 * `shared/picktracker` — the direction `trades.ts` sets out and for the same
 * reason: the board is a `"use client"` module and must name its payload
 * without pulling the Sleeper client into the browser.
 *
 * `PlaceholderPick` deliberately stays a domain type rather than being widened
 * to cover both. It carries a Sleeper avatar **id**, where everything on this
 * wire carries a resolved URL — the route's one transformation — and a single
 * type spanning that seam would have every reader ask which half it held.
 */

/** One kicker pick, renumbered into the rookie pick it stands for. */
export type PicktrackerPickPayload = {
  /** Round.slot in the placeholder sequence, e.g. "1.03". */
  pick: string;
  player_id: string;
  player_name: string;
  /** Null for an autopick — Sleeper carries no user id on one. */
  picked_by: {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
};

/** A tracked draft's whole board. */
export type PicktrackerPayload = {
  league: { league_id: string; name: string; avatar_url: string | null };
  draft_id: string;
  /** Sleeper's own word: `pre_draft`, `drafting`, `complete`. */
  draft_status: string;
  /** Teams per round — what the labels count against. */
  teams: number;
  picks: PicktrackerPickPayload[];
  /** The next placeholder up, or null once the draft is complete. */
  next_pick: string | null;
};

/**
 * What the SSE route sends, discriminated so `if (m.type === "board")` is also
 * the type guard.
 *
 * **`stale` and `error` are two different claims and must not be merged.**
 * `stale` is a tick failing *behind* a board already on screen — the reader
 * keeps what they have and is told it has stopped moving. `error` is terminal:
 * there is no board and there never will be for this league id, so the client
 * must close the `EventSource` rather than let it reconnect forever. That is
 * the same distinction `useManagerLeagues` draws between `refreshError` and
 * `error`, and here it also decides whether a browser retries.
 */
export type PicktrackerStreamMessage =
  | { type: "board"; payload: PicktrackerPayload }
  | { type: "stale"; error: string }
  | { type: "error"; error: string };

/**
 * What the Open Graph card draws — the unfurl a link to a tracked draft
 * renders as in a text thread, Sleeper chat, Slack, Discord or X.
 *
 * **Deliberately holds nothing that moves.** An unfurl is a static PNG the
 * client scrapes once and then caches against the URL, hard and for a long
 * time — so the next pick, the manager on the clock and any countdown are all
 * claims that are false minutes after the image renders, and stale-but-
 * plausible is worse than obviously old. Every field here is fixed the moment
 * the draft is set up, which is what lets the image route cache for an hour.
 *
 * If a live reading is ever added to the card, that `revalidate` has to come
 * down — and the card is still wrong in every message already posted, which is
 * the argument for not adding one.
 */
export type PicktrackerCardPayload = {
  /** `avatar_url` is resolved, as everywhere else on this wire. */
  league: { name: string; avatar_url: string | null };
  season: string;
  teams: number;
  rounds: number;
};

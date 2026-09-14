import type { GametimeStreamMessage, ManagerGametimePayload } from "@/shared/contract";

// The helper's own module, reached relatively with its extension so this file
// resolves under Node's runner — `shared/projections/slots.ts`' exception,
// for its reason: the `features/shared` barrel in front of it drags every
// client component into the graph, the api folder's own barrel names its
// siblings without extensions, and the runner knows nothing of the `@/*`
// aliases.
import { isAbortError } from "../../shared/api/abort-error.ts";
import type { GametimeConnection } from "../helpers/connection.ts";

/** The first backoff after a stream that will not stay open, and the ceiling. */
export const RETRY_BASE_MS = 10_000;
export const RETRY_MAX_MS = 2 * 60_000;
/**
 * Up to this much is added to every backoff, at random. Twenty-five readers
 * whose streams were all shed by one deploy would otherwise all retry on the
 * same tick of the same ladder, which is the herd the shedding exists to break.
 */
export const RETRY_JITTER_MS = 3_000;
/**
 * The least time between two snapshot fetches on one follow.
 *
 * A snapshot is a full solve of the reader's week — the most expensive read
 * this app makes — and a fatal close can recur every ten seconds while the
 * server is shedding load. Fetching one per close would turn every refused
 * stream into exactly the request the refusal exists to spare the server; one
 * per minute stands the last answer in and lets the backoff do the trying.
 */
export const SNAPSHOT_COOLDOWN_MS = 60_000;
/**
 * The longest a `Retry-After` on a shed snapshot is honoured for. A header is
 * the server's word, and a server that asked for an hour is not one this page
 * should sit silent against — it retries at this ceiling instead.
 */
export const RETRY_AFTER_MAX_MS = 10 * 60_000;

/** The two statuses that mean "not now" rather than "not ever". */
const SHED_STATUSES = new Set([429, 503]);

/** The one message the server sends that is an ending rather than a fault. */
export const NO_WEEK = "No week left to follow";

/**
 * `EventSource.CLOSED`, spelled rather than read off the global: the value is
 * the spec's, and Node's runner has no `EventSource` to read it from.
 */
export const SOURCE_CLOSED = 2;

/** What `useGametime` follows. */
export type LiveSubject = { username: string; season: string; week: number | null };

/** A `useState` setter's shape: a value, or a function of the held one. */
export type Updater<T> = T | ((held: T) => T);

/**
 * Where the answer goes — the hook's three setters, and nothing that reads
 * them back. The controller keeps what it needs to decide with itself, so a
 * decision never waits on a render.
 */
export type LiveSink = {
  setPayload: (update: Updater<ManagerGametimePayload | null>) => void;
  setConnection: (update: Updater<GametimeConnection>) => void;
  setStale: (update: Updater<string | null>) => void;
};

/** The five things an `EventSource` is, to this controller. */
export type LiveSource = Pick<
  EventSource,
  "readyState" | "onopen" | "onmessage" | "onerror" | "close"
>;

export type LiveTimer = ReturnType<typeof setTimeout>;

/**
 * What the controller reaches, named so a test can hand in each — the
 * browser's own in `useGametime`, scripted ones in `live-connection.test.ts`.
 */
export type LiveEnv = {
  openSource: (url: string) => LiveSource;
  fetch: (
    url: string,
    init: { signal: AbortSignal },
  ) => Promise<
    Pick<Response, "ok" | "status" | "json"> & { headers?: { get(name: string): string | null } }
  >;
  setTimeout: (callback: () => void, ms: number) => LiveTimer;
  clearTimeout: (timer: LiveTimer) => void;
  /** The clock the snapshot cooldown and the retry are measured on. */
  now: () => number;
  /** In `[0, 1)`; what jitters the backoff. */
  random: () => number;
};

/**
 * Follow one manager's week over the stream, standing a snapshot in where the
 * stream will not stay open — the whole of `useGametime`'s effect, as a
 * function of what it reaches rather than of the browser, so that the races
 * in it can be driven under Node's own runner. Returns what stops it.
 *
 * **`EventSource` rather than `fetch` + a reader**, on `usePicktracker`'s
 * argument: its automatic reconnect is exactly what a page watched for three
 * hours wants, and the cost — that reconnection has to be *stopped* by hand —
 * is what the terminal `error` message is for.
 *
 * **The payload is never cleared by a reconnect.** A phone changing cell must
 * not flash an empty page; a dropped stream is a note beside the last answer
 * the server gave, which is still the best one there is. Only the caller
 * blanks it, on a change of subject, by stopping this and starting another.
 *
 * **A stream that will not stay open falls back to one snapshot, never to a
 * poll.** `EventSource` gives up for good on some failures — an HTTP status
 * rather than a dropped socket — and that would leave the page on whatever it
 * happened to be holding, which for a first visit is nothing at all. So a
 * fatal close fetches the plain route **once**, shows what it answers marked
 * `snapshot` (real numbers, not moving), and re-opens the stream on a widening
 * backoff. What this deliberately is not is a timer that re-fetches: the solve
 * behind that body is the most expensive read this app makes, and a page of
 * them every few seconds is the cost the stream exists to avoid. Nor is a
 * snapshot fetched on an ordinary first load, where it would be a second full
 * solve for an answer the stream is already about to push.
 *
 * **A snapshot is owned, and the owner is whoever has the newest word.** A
 * fetch started for one failed attempt can land after the *next* attempt has
 * already delivered a live payload — the snapshot is a full solve and the
 * reconnect is ten seconds out — and committed then it would replace fresh
 * numbers with older ones, flip the page to `snapshot`, and hand the deltas
 * that follow a baseline the server never sent. So a fallback carries a token,
 * a usable frame off the stream (a payload, or a delta with something to fold
 * onto) **retires** whatever fallback is pending — aborting the request, and
 * disowning it, because an abort alone does not stop a response that is
 * already parsing — and a fallback that is not the current owner when it
 * completes changes nothing, success or failure. Only one is ever in flight,
 * so two cannot commit out of order; a completed one clears the slot so the
 * next fatal close may ask again.
 *
 * **A refused stream is not answered with a solve.** A server shedding load
 * refuses a stream with a 429 or a 503 before it opens, which `EventSource`
 * reports as a fatal close and nothing more — the status is invisible from
 * script. So the snapshot that stands in for a fatal close is fetched **at most
 * once a minute** per follow, however many closes there are in that minute;
 * the ones in between re-arm the backoff and keep whatever is on screen. And
 * the snapshot is the one place the server's word *is* visible: a 429 or a 503
 * on it carrying `Retry-After` pushes the next stream attempt out to at least
 * that far, so a page told to wait waits, rather than trying again on its own
 * ladder into the same refusal. Every wait carries a little jitter, so a
 * roomful of readers shed together does not come back together.
 *
 * **Opening is not recovery.** The server opens the stream and *then* answers
 * — the manager, the season and the week resolve before a byte is written,
 * but the reader's Postgres read happens after — so a stream can open and
 * close on a terminal fault every time. `onopen` therefore says nothing here:
 * the connection reads `live` and the backoff resets only on a usable frame,
 * which is what keeps a run of open-then-fail cycles backing off toward the
 * cap rather than asking the plain route every ten seconds for as long as the
 * tab is open.
 *
 * **One source, one retry, and a superseded source is deaf.** Every handler
 * asks whether the source it was written for is still the current one before
 * it acts, so a stale `onerror` cannot close a stream that replaced it or arm
 * a second retry beside the one already scheduled.
 */
export function followGametime(subject: LiveSubject, sink: LiveSink, env: LiveEnv): () => void {
  const query = new URLSearchParams({ season: subject.season });
  if (subject.week !== null) query.set("week", String(subject.week));
  const base = `/api/user/${encodeURIComponent(subject.username)}/gametime`;

  let source: LiveSource | null = null;
  let retry: LiveTimer | null = null;
  let attempts = 0;
  let stopped = false;
  /**
   * Whether a payload is held — off the stream or off a snapshot — and so
   * whether a delta has anything to fold onto. Kept here rather than read
   * back through React, because the decision is made in the frame's own
   * handler and a setter's updater runs later.
   */
  let holding = false;
  /** The fallback in flight, if any: its token is its ownership. */
  let fallback: { token: number; controller: AbortController } | null = null;
  let fallbackSeq = 0;
  /** When the last snapshot was *asked for*, on `env.now`'s clock. */
  let lastSnapshotAt = Number.NEGATIVE_INFINITY;
  /** When the armed retry fires, on the same clock. */
  let retryAt = 0;

  const clearRetry = () => {
    if (retry !== null) {
      env.clearTimeout(retry);
      retry = null;
    }
  };

  /** Arm the one retry, `wait` from now. */
  const armRetry = (wait: number) => {
    clearRetry();
    retryAt = env.now() + wait;
    retry = env.setTimeout(() => {
      retry = null;
      if (!stopped) open();
    }, wait);
  };

  /**
   * The server said how long to wait: push the armed retry out to at least
   * that far. Never pulled in — the backoff already chose a longer wait for a
   * reason of its own — and never past the ceiling.
   */
  const honourRetryAfter = (seconds: number) => {
    const wait = Math.min(RETRY_AFTER_MAX_MS, seconds * 1000);
    if (retry === null || retryAt - env.now() >= wait) return;
    armRetry(wait);
  };

  /** Disown and abort the pending fallback, if any — nothing it does afterwards counts. */
  const retireFallback = () => {
    if (fallback === null) return;
    fallback.controller.abort();
    fallback = null;
  };

  /** A usable frame arrived off the stream: this is the recovery the backoff waits for. */
  const recovered = () => {
    attempts = 0;
    retireFallback();
  };

  /**
   * One plain-route body, at most one in flight. It is deliberately not
   * retried on its own: the stream's own backoff is what tries again, and a
   * second expensive solve for a page already showing one buys nothing.
   */
  const fetchSnapshot = async () => {
    if (fallback !== null) return;
    const now = env.now();
    if (now - lastSnapshotAt < SNAPSHOT_COOLDOWN_MS) return;
    lastSnapshotAt = now;
    const token = ++fallbackSeq;
    const controller = new AbortController();
    fallback = { token, controller };
    const owns = () => !stopped && fallback !== null && fallback.token === token;
    try {
      const res = await env.fetch(`${base}?${query}`, { signal: controller.signal });
      if (!res.ok) {
        if (owns() && SHED_STATUSES.has(res.status)) {
          const seconds = Number(res.headers?.get("retry-after") ?? "");
          if (Number.isFinite(seconds) && seconds > 0) honourRetryAfter(seconds);
        }
        throw new Error(String(res.status));
      }
      const body = (await res.json()) as ManagerGametimePayload;
      if (!owns()) return;
      fallback = null;
      holding = true;
      sink.setPayload(body);
      sink.setConnection("snapshot");
    } catch (error: unknown) {
      if (isAbortError(error) || !owns()) return;
      fallback = null;
      // Nothing to show and nothing in flight — the backoff is the only thing
      // still trying.
      sink.setConnection((held) => (held === "snapshot" ? held : "failed"));
    }
  };

  /** A stream that will not stay open: stand in for it, and try again later. */
  const giveUp = (es: LiveSource) => {
    if (es !== source) return;
    es.close();
    source = null;
    if (stopped) return;
    sink.setConnection((held) => (held === "snapshot" ? held : "failed"));
    const wait =
      Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts) +
      Math.floor(env.random() * RETRY_JITTER_MS);
    attempts += 1;
    // Armed before the snapshot is asked for, so a `Retry-After` on the
    // snapshot's answer has a retry to push out.
    armRetry(wait);
    void fetchSnapshot();
  };

  const open = () => {
    if (stopped) return;
    source?.close();
    const es = env.openSource(`${base}/stream?${query}`);
    source = es;
    // A reader holding a snapshot keeps reading it while the next attempt is
    // made; one whose stream has already failed once is *re*-connecting, and
    // only a first attempt is plain connecting.
    sink.setConnection((held) =>
      held === "snapshot" ? held : held === "failed" ? "reconnecting" : "connecting",
    );

    // Transport only. Nothing is known until a frame lands — see the note
    // above on why opening is not recovery.
    es.onopen = null;

    es.onmessage = (event: MessageEvent<string>) => {
      if (es !== source) return;
      let message: GametimeStreamMessage;
      try {
        message = JSON.parse(event.data) as GametimeStreamMessage;
      } catch {
        return;
      }

      if (message.type === "payload") {
        holding = true;
        sink.setPayload(message.payload);
        sink.setConnection("live");
        sink.setStale(null);
        recovered();
        return;
      }
      if (message.type === "delta") {
        // A delta with nothing held is dropped rather than presented as a page
        // of a handful of leagues — the room only ever sends one to a reader
        // whose full payload it saw accepted, so this is a guard rather than a
        // case — and it is not the recovery a payload is, either.
        if (!holding) return;
        // Folded over what is held: the header replaces, and each of the two
        // diffed collections has its named entries replaced and its removed
        // ones dropped while the rest stand.
        const { leagues, removed, players, removed_players, ...header } = message.delta;
        sink.setPayload((prev) => {
          if (!prev) return prev;
          const next = { ...prev.leagues, ...leagues };
          for (const id of removed) delete next[id];
          const board = { ...prev.players, ...players };
          for (const id of removed_players) delete board[id];
          return { ...prev, ...header, leagues: next, players: board };
        });
        sink.setConnection("live");
        sink.setStale(null);
        recovered();
        return;
      }
      if (message.type === "stale") {
        sink.setStale(message.error);
        return;
      }
      // Terminal. Close by hand, or the browser reconnects into the same
      // refusal for as long as the tab is open.
      if (message.error === NO_WEEK) {
        es.close();
        source = null;
        // An ending, not a fault: nothing to retry, and nothing to stand in
        // for — a snapshot landing now would put a week under a season that
        // has none.
        clearRetry();
        retireFallback();
        sink.setConnection("complete");
        sink.setStale(null);
        return;
      }
      // Any other ending is a fault the server has named: keep the reason
      // beside whatever is on screen, and fall back like a fatal close.
      sink.setStale((held) => held ?? message.error);
      giveUp(es);
    };

    es.onerror = () => {
      if (es !== source) return;
      // `readyState` is the only thing that says which case this is — see
      // `usePicktracker`. A closed source will never answer on its own, so
      // the fallback is ours to run; a connecting one is the browser's own
      // reconnect, which is exactly what this transport was chosen for.
      if (es.readyState === SOURCE_CLOSED) {
        giveUp(es);
      } else {
        sink.setConnection((held) => (held === "snapshot" ? held : "reconnecting"));
      }
    };
  };

  open();

  return () => {
    stopped = true;
    source?.close();
    source = null;
    clearRetry();
    retireFallback();
  };
}

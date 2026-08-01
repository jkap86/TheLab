import type {
  LeaguematePayload,
  TradesStreamMessage,
} from "@/shared/contract";
import { getKtcValuesBySleeperId } from "@/shared/ktc";
import { getLeaguesByIds } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { countAllTrades, getTradeManagers, streamAllTrades } from "@/shared/trades";

import { startTradesTiming } from "./timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every completed trade in every crawled league for a season, streamed as
 * newline-delimited JSON — see {@link TradesStreamMessage}.
 *
 * It sits at the top level rather than under `/api/user/[username]` because it
 * asks nothing about a manager: the page it serves is a window on the whole
 * market this database has seen, and narrowing to one account's leagues is what
 * its managers filter does afterwards. That also makes it the plainest kind of
 * cache-backed route — no username to resolve, so a season nothing has been
 * crawled for comes back empty rather than syncing anything.
 *
 * Every filter the trades page offers is applied on the client, which is why
 * this takes no query string beyond the season. The narrowing is a filter *set*
 * whose options are read off the trades themselves (which players moved, which
 * managers dealt) and off the leagues they happened in, so the client needs the
 * unnarrowed list in hand either way; filtering here would cost a round trip per
 * chip and hand back an option list that had shrunk to the selection.
 *
 * **Which is why it streams rather than answering once.** Needing the whole
 * season client-side is a fact about the filters and not something to design
 * away, but a busy season is ~20MB of JSON — as one body, a spinner until the
 * last byte and one blocking parse at the end of it. This is the same read paid
 * for progressively: the first chunk is on screen in the time the old route was
 * still counting rows, and nothing is capped. It follows the leagues stream's
 * protocol for that reason — one JSON object per line, discriminated by `type` —
 * so the client decodes it with the same `takeLines`.
 *
 * **Three things travel independently, and that is the shape of this handler.**
 * The trades, the count, and the names the trades' ids stand for used to be one
 * message, which meant the first card on screen waited for the slowest of the
 * three. They are separated now, each on its own message:
 *
 * - the **trades** go out the moment a cursor read returns, before anything is
 *   resolved about them;
 * - the **names** — leagues, players, managers, KTC prices — follow as four
 *   parallel lookups, and the card draws unresolved ids in the meantime, which
 *   it already knew how to do (a league falls back to its id, a player to his, a
 *   side to its roster number);
 * - the **total** is a separate query started alongside the walk and sent
 *   whenever it lands.
 *
 * **An abandoned request stops the work rather than finishing it into a closed
 * socket.** The reader who opens this page and navigates away two seconds later
 * is the common case, not the edge one — a season is tens of thousands of trades
 * and several seconds of walking. `request.signal` is watched throughout: the
 * generator is aborted through the same signal, the loop is checked at every
 * boundary, and `return()`ing the iterator runs its `finally`, which closes the
 * cursor and hands the connection back. Before this, navigating away left this
 * handler reading the rest of the season and pricing players for it, holding a
 * pooled connection the whole time, with every byte it produced thrown away.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  const timing = startTradesTiming(season);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (message: TradesStreamMessage) => {
        if (closed) return;
        try {
          const bytes = encoder.encode(JSON.stringify(message) + "\n");
          controller.enqueue(bytes);
          timing.count("bytes", bytes.byteLength);
        } catch {
          closed = true; // client disconnected
        }
      };

      // The walk is driven by hand rather than by `for await`, because the two
      // ways out of it need different treatment: draining runs the generator's
      // own `finally`, and abandoning it needs `return()` called explicitly.
      const trades = streamAllTrades(season, { signal: request.signal });

      // Fired once, and the handler is removed in the `finally` below — a
      // listener left on a long-lived signal is the leak this shape is for.
      // It only sets the flag and closes the walk; nothing in here writes to
      // the controller, since the reason it is running is that nobody is
      // reading.
      const onAbort = () => {
        closed = true;
        // Not awaited — an abort handler is not a place to hold a promise, and
        // the generator's own `finally` releases the connection either way —
        // but caught, since an unawaited rejection here would take the process
        // down over a connection that was being discarded anyway.
        void trades.return(undefined).catch(() => {});
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      // What has already crossed the wire, so each chunk carries only what is
      // new. Held per request rather than per chunk: a season names a few
      // hundred leagues and a few thousand players in its first chunks and then
      // repeats them for the rest of the stream, which is the difference between
      // resolving each once and resolving each forty-nine times.
      const sentLeagues = new Set<string>();
      const sentPlayers = new Set<string>();
      const sentManagers = new Set<string>();

      // Started before the walk and never awaited inline: the page meters
      // against this number and is not built out of it, so the trades must not
      // queue behind it. A failure costs the progress line its denominator and
      // nothing else, which is why it is caught here rather than left to reject
      // an unhandled promise once the request is gone.
      const counted = timing
        .phase("count", () => countAllTrades(season))
        .then((total) => {
          timing.mark("total-known");
          timing.count("trades-total", total);
          send({ type: "total", total });
        })
        .catch((error) => {
          console.error("[trades] count failed:", error);
        });

      let outcome: "complete" | "aborted" | "failed" = "complete";

      try {
        // Sent before anything is read, so the page has a container to fill and
        // can draw its own loading state against a season it knows.
        send({ type: "meta", season });

        for (;;) {
          if (request.signal.aborted) break;

          const next = await timing.phase("db-read", () => trades.next());
          timing.mark("first-row");
          if (next.done || request.signal.aborted) break;

          const chunk = next.value.trades;
          if (chunk.length === 0) continue;

          // The trades, before anything is known about the ids in them. This is
          // the message the page's first paint waits on and the whole reason
          // the names are a message of their own.
          timing.phase("serialize", async () => send({ type: "chunk", trades: chunk }));
          timing.mark("first-chunk");
          timing.count("trades", chunk.length);

          const leagueIds: string[] = [];
          const playerIds: string[] = [];
          const managerIds: string[] = [];
          const take = (id: string, seen: Set<string>, out: string[]) => {
            if (seen.has(id)) return;
            seen.add(id);
            out.push(id);
          };

          for (const trade of chunk) {
            take(trade.league_id, sentLeagues, leagueIds);
            for (const side of trade.sides) {
              side.players.forEach((id) => take(id, sentPlayers, playerIds));
              if (side.user_id) take(side.user_id, sentManagers, managerIds);
            }
          }

          timing.count("players", playerIds.length);
          timing.count("leagues", leagueIds.length);
          timing.count("managers", managerIds.length);

          // Nothing new to name is the common case late in a season, and it is
          // worth skipping rather than sending an empty message the client has
          // to decode to learn it was empty.
          if (!playerIds.length && !managerIds.length && !leagueIds.length) {
            continue;
          }

          // Independent of each other, and each a no-op on an id set this chunk
          // added nothing to. Timed individually as well as together: they run
          // concurrently, so the four phase totals are what says which of them
          // the request was actually waiting on.
          const [players, managers, leagues, ktc] = await Promise.all([
            playerIds.length
              ? timing.phase("lookup-players", () => getPlayersByIds(playerIds))
              : {},
            managerIds.length
              ? timing.phase("lookup-managers", () =>
                  getTradeManagers(managerIds),
                )
              : new Map(),
            leagueIds.length
              ? timing.phase("lookup-leagues", () => getLeaguesByIds(leagueIds))
              : [],
            // Keyed on the same new-ids list as the names, so a player priced
            // once is priced once for the whole stream. Both boards travel,
            // because which one a trade reads is its *league's* question and one
            // stream spans every crawled league.
            playerIds.length
              ? timing.phase("lookup-ktc", () =>
                  getKtcValuesBySleeperId(playerIds),
                )
              : { values: {}, updated_at: null },
          ]);

          // Checked again on the far side of four round trips: they are the
          // longest a chunk waits, so this is the likeliest place for a reader
          // to have left, and there is no point serialising ~1MB of names into
          // a socket nobody is holding.
          if (request.signal.aborted) break;

          const resolvedManagers: Record<string, LeaguematePayload> = {};
          for (const [id, m] of managers) {
            resolvedManagers[id] = {
              user_id: id,
              display_name: m.display_name,
              avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
            };
          }

          timing.phase("serialize", async () =>
            send({
              type: "names",
              leagues,
              players,
              managers: resolvedManagers,
              ktc: ktc.values,
            }),
          );
          timing.mark("first-names");
        }

        if (request.signal.aborted) outcome = "aborted";
      } catch (error) {
        outcome = "failed";
        console.error("[trades] query failed:", error);
        // Sent down the stream rather than raised as a status, because by now
        // the response is a 200 with chunks already in it: a failure partway
        // through leaves the client holding a real prefix of the season, and
        // saying so beats discarding what arrived.
        send({ type: "error", error: "Failed to load trades" });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        // Unconditional, and not only on the abort path: a `break` out of the
        // loop above leaves the generator suspended mid-walk, holding the
        // cursor and its connection until it is collected. `return()` runs its
        // `finally` now.
        await trades.return(undefined).catch(() => {});
        // Awaited so the count's own connection is accounted for before the
        // request is called done; it is already caught, so this cannot throw.
        await counted;
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
        timing.report(outcome);
      }
    },
  });

  // **Compressed here rather than left to the platform.** A season is ~13MB of
  // NDJSON and ~0.6MB gzipped — a 20x ratio, because this is the most repetitive
  // JSON in the app: the same dozen keys and the same league and roster ids, tens
  // of thousands of times. Nothing else was going to apply it. Next does not
  // compress a streamed response, and `no-transform` below tells any proxy that
  // might have not to bother — which is the right instruction *once the body is
  // already encoded*, and was silently costing 12MB when it wasn't.
  //
  // It does not undo the streaming: a gzip stream emits as it goes, so the first
  // chunk still leaves before the last row is read. Brotli would compress better
  // and `CompressionStream` doesn't offer it, which is the whole reason this is
  // gzip.
  const encode = (request.headers.get("accept-encoding") ?? "").includes("gzip");
  const body = encode
    ? stream.pipeThrough(
        // `CompressionStream.writable` is typed `WritableStream<BufferSource>`,
        // which is the wider — and correct — parameter type, and which
        // `pipeThrough` rejects anyway against a `ReadableStream<Uint8Array>`.
        // A variance wart in the lib types rather than a mismatch: every byte
        // enqueued above is a `Uint8Array`.
        new CompressionStream("gzip") as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >,
      )
    : stream;

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      ...(encode ? { "Content-Encoding": "gzip" } : {}),
      // Sent whether or not this response is encoded: a cache keyed without it
      // would serve a gzipped body to the next client that couldn't read one.
      Vary: "Accept-Encoding",
      // `no-transform` matters more here than on the leagues stream: a proxy
      // that buffers to re-encode would hold the whole season back and undo the
      // streaming entirely.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

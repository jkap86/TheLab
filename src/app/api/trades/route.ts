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
import { getTradeManagers, streamAllTrades } from "@/shared/trades";

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
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (message: TradesStreamMessage) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"));
        } catch {
          closed = true; // client disconnected
        }
      };

      // What has already crossed the wire, so each chunk carries only what is
      // new. Held per request rather than per chunk: a season names a few
      // hundred leagues and a few thousand players in its first chunks and then
      // repeats them for the rest of the stream, which is the difference between
      // resolving each once and resolving each forty-nine times.
      const sentLeagues = new Set<string>();
      const sentPlayers = new Set<string>();
      const sentManagers = new Set<string>();

      try {
        for await (const { trades, total } of streamAllTrades(season)) {
          // The total rides on the first chunk, and the meta message goes out
          // before that chunk's trades so the page has a target to meter
          // against from its very first render.
          if (total !== undefined) send({ type: "meta", season, total });
          if (trades.length === 0) continue;

          const leagueIds: string[] = [];
          const playerIds: string[] = [];
          const managerIds: string[] = [];
          const take = (id: string, seen: Set<string>, out: string[]) => {
            if (seen.has(id)) return;
            seen.add(id);
            out.push(id);
          };

          for (const trade of trades) {
            take(trade.league_id, sentLeagues, leagueIds);
            for (const side of trade.sides) {
              side.players.forEach((id) => take(id, sentPlayers, playerIds));
              if (side.user_id) take(side.user_id, sentManagers, managerIds);
            }
          }

          // Independent of each other, and each a no-op on an id set this chunk
          // added nothing to — which is most chunks, late in a season.
          const [players, managers, leagues, ktc] = await Promise.all([
            playerIds.length ? getPlayersByIds(playerIds) : {},
            managerIds.length ? getTradeManagers(managerIds) : new Map(),
            leagueIds.length ? getLeaguesByIds(leagueIds) : [],
            // Keyed on the same new-ids list as the names, so a player priced
            // once is priced once for the whole stream. Both boards travel,
            // because which one a trade reads is its *league's* question and one
            // stream spans every crawled league.
            playerIds.length
              ? getKtcValuesBySleeperId(playerIds)
              : { values: {}, updated_at: null },
          ]);

          const resolvedManagers: Record<string, LeaguematePayload> = {};
          for (const [id, m] of managers) {
            resolvedManagers[id] = {
              user_id: id,
              display_name: m.display_name,
              avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
            };
          }

          send({
            type: "chunk",
            trades,
            leagues,
            players,
            managers: resolvedManagers,
            ktc: ktc.values,
          });
        }
      } catch (error) {
        console.error("[trades] query failed:", error);
        // Sent down the stream rather than raised as a status, because by now
        // the response is a 200 with chunks already in it: a failure partway
        // through leaves the client holding a real prefix of the season, and
        // saying so beats discarding what arrived.
        send({ type: "error", error: "Failed to load trades" });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
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

import type { QueryClient } from "@tanstack/react-query";

import { apiFetch, fetchJson } from "../shared/api.ts";
import { takeLines } from "../shared/ndjson.ts";
import { dependentManagerQueryKeys } from "./query-keys.ts";
import type { LeaguesResult, ManagerLeague, SyncProgress } from "./types";
import type { LeaguesStreamMessage } from "@/shared/contract";

/**
 * The functions behind the manager queries: one read per resource, and the
 * leagues stream decoded into something a query can resolve with.
 *
 * They live apart from the hooks for the reason `shares` and `record` do — a
 * function taking its inputs as arguments is one the test runner can call, where
 * the same logic inside a `useEffect` is only reachable through a renderer. The
 * imports are relative and carry a `.ts` extension for the same reason (the
 * `@/shared/contract` one is `import type` and erased), and everything here does
 * exactly one thing: I/O plus the decoding, with no React and no cache policy —
 * how long an answer stays fresh is `query-config`, and where it is filed is
 * `query-keys`.
 */

// Re-exported under its old name: this module's own consumers (the tests,
// `fetchManagerResource` below) already import it from here, the same
// mover's-rule habit `adp-controls` keeps for `todayIso`.
export { fetchJson };

/** One of the manager's cached sub-resources: rosters, membership, ranks, values. */
export function fetchManagerResource<T>(
  searched: string,
  path: string,
  fallbackError: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJson<T>(
    `/api/user/${encodeURIComponent(searched)}/${path}`,
    fallbackError,
    signal,
  );
}

/**
 * What one leagues query holds: the last valid payload, whatever the stream is
 * doing to it, and the revision dependent queries watch.
 *
 * The stream is stale-while-revalidate — a cached payload, then a refreshed one
 * over the same connection — so a query that resolved only at the end would sit
 * on a loading screen through a sync the server had already answered. The
 * fetcher publishes each of these as it learns it (see `publish`), which is what
 * puts the cached leagues on screen while the refresh runs.
 *
 * `refreshError` rides *in* the data rather than being thrown, and that is the
 * point of the shape: a refresh that fails after the cached payload arrived has
 * not invalidated the payload, so throwing would put the query in an error state
 * whose data the components would then have to be careful to keep showing. A
 * failure with nothing to show still throws — there the query's own error is the
 * honest answer.
 */
export type ManagerLeaguesData = {
  /**
   * Null only before the first payload — a cold account, where the sync runs in
   * the foreground and there is nothing cached to send first. The progress
   * beside it is what the loading screen counts up, which is why this is
   * published at all rather than the query simply staying pending.
   */
  result: LeaguesResult | null;
  /** Per-league sync progress while a sync is running, else null. */
  progress: SyncProgress | null;
  /** True between the cached payload and the refreshed one. */
  refreshing: boolean;
  /** A refresh that failed behind a payload worth keeping. */
  refreshError: string | null;
  /** See {@link leaguesRevision} — changes when dependent reads are behind. */
  revision: string;
};

/**
 * A fingerprint of what the dependent routes would now answer differently.
 *
 * Those routes (`players`, `ranks`, `ktc`, `leaguemates`, `adp-value`) read the
 * rosters and membership this stream writes, and the old hooks re-fetched them
 * on the *identity* of the leagues array — so every re-render that rebuilt the
 * array cost five requests, and a refresh that changed nothing cost five more.
 * The revision is the replacement: a value that changes when the answer would,
 * and holds still when it wouldn't.
 *
 * Two halves, because one alone is wrong in a way that shows:
 *
 * - The **content digest** covers what a `ManagerLeague` actually carries — the
 *   ids, the records, the status. A league joined, left or won since the last
 *   read is a different list, whatever the array identity says.
 * - The **refresh sequence** covers what it doesn't. Rosters are not on this
 *   payload at all, so a sync that persisted a waiver claim changes nothing
 *   visible here while making every dependent read stale. A completed refresh
 *   (a `result` carrying a `summary`) bumps the counter, and the counter carries
 *   forward from the previous revision so a re-run of the query can't rewind it.
 */
export function leaguesRevision(
  leagues: readonly ManagerLeague[],
  season: string,
  refreshSeq: number,
): string {
  const digest = leagues
    .map((league) => {
      const record = league.record
        ? `${league.record.wins}-${league.record.losses}-${league.record.ties}`
        : "";
      return `${league.league_id}:${league.status}:${record}`;
    })
    .sort()
    .join(",");
  return `${refreshSeq}|${season}|${digest}`;
}

/** The counter half of a revision, so a re-run continues rather than restarts. */
export function refreshSeqOf(revision: string | undefined): number {
  const seq = Number(revision?.split("|", 1)[0]);
  return Number.isFinite(seq) ? seq : 0;
}

export type LeaguesStreamOptions = {
  searched: string;
  /**
   * `?refresh=1` — asks the server to sync even when its own cache is still
   * fresh. Honoured only for an internally authorized caller; from a browser the
   * parameter is ignored and the stream is simply re-read. See
   * `useManagerLeagues`.
   */
  refresh?: boolean;
  signal?: AbortSignal;
  /** The revision the cache already holds, so the sequence continues from it. */
  previousRevision?: string;
  /** Called with every state the stream reaches, newest last. */
  publish?: (data: ManagerLeaguesData) => void;
};

/**
 * Decode `/api/user/[username]/leagues` into the query's data.
 *
 * Resolves with the last valid payload the stream produced, having published
 * each one on the way — so a caller writing `publish` into the query cache gets
 * the cached leagues on screen at the first message rather than at the last.
 * Only a stream that produced *no* payload rejects; anything after the first one
 * is a refresh failure, which is a field on the data and not the end of it.
 */
export async function fetchManagerLeagues({
  searched,
  refresh,
  signal,
  previousRevision,
  publish,
}: LeaguesStreamOptions): Promise<ManagerLeaguesData> {
  let refreshSeq = refreshSeqOf(previousRevision);
  // A holder rather than a bare `let`, so the state written inside `update` is
  // still typed where it is read after it — a closure-assigned local narrows to
  // its initialiser everywhere the compiler can't see the write.
  const state: { current: ManagerLeaguesData | null } = { current: null };

  const update = (patch: Partial<ManagerLeaguesData>) => {
    const result = patch.result ?? state.current?.result ?? null;
    state.current = {
      result,
      progress: patch.progress ?? null,
      refreshing: patch.refreshing ?? false,
      refreshError: patch.refreshError ?? state.current?.refreshError ?? null,
      revision: result
        ? leaguesRevision(result.leagues, result.season, refreshSeq)
        : "",
    };
    publish?.(state.current);
  };

  const url = `/api/user/${encodeURIComponent(searched)}/leagues${refresh ? "?refresh=1" : ""}`;

  try {
    const res = await apiFetch(url, { signal, fallbackError: "Failed to load leagues" });
    if (!res.body) throw new Error("Failed to load leagues");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { lines, rest } = takeLines(buffer);
      buffer = rest;

      for (const line of lines) {
        const message = JSON.parse(line) as LeaguesStreamMessage;
        if (message.type === "progress") {
          update({
            progress: message,
            refreshing: state.current?.refreshing ?? false,
          });
        } else if (message.type === "result") {
          // A `summary` rides only on the post-refresh payload, which is exactly
          // the message after which the rosters behind the dependent routes may
          // have moved. See {@link leaguesRevision}.
          if (message.summary) refreshSeq += 1;
          update({
            result: message,
            refreshing: message.refreshing,
            progress: message.refreshing ? (state.current?.progress ?? null) : null,
          });
        } else if (hasResult(state.current)) {
          // Keep the payload and say the refresh failed — the cached leagues on
          // screen are still the ones the server sent.
          update({ refreshError: message.error });
        } else {
          throw new Error(message.error);
        }
      }
    }
  } catch (error: unknown) {
    // Nothing usable arrived: the query's own error state is the honest answer.
    if (!hasResult(state.current)) throw error;
    // Something did: a dropped connection mid-refresh costs the refresh, not
    // the leagues.
    update({ refreshError: messageOf(error) });
  }

  if (!hasResult(state.current)) throw new Error("Failed to load leagues");
  // The stream can end without its closing `result` — a proxy cutting a long
  // sync — and only a message clears these, so without this the header spins
  // "Refreshing…" forever. On a clean finish it is a no-op.
  update({ refreshing: false, progress: null });
  return state.current;
}

/** A published state that carries a payload — the query can resolve with it. */
const hasResult = (
  data: ManagerLeaguesData | null,
): data is ManagerLeaguesData & { result: LeaguesResult } => Boolean(data?.result);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

/**
 * Mark the reads that follow a manager's leagues as stale.
 *
 * Called when — and only when — a stream result carries a new revision, so a
 * refresh that changed nothing costs nothing. It addresses the ADP valuation by
 * its prefix, so every steepness already in the cache goes with it; a curve is
 * not re-derivable from a stale roster just because nobody has touched the
 * slider.
 */
export function invalidateManagerDependents(
  queryClient: QueryClient,
  searched: string,
  season?: string,
): void {
  for (const queryKey of dependentManagerQueryKeys(searched, season)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

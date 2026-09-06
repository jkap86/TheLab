import type { CompPlayersPayload, CompsPayload } from "@/shared/contract";

import { compsQueryParams } from "../../shared/comps/params.ts";
import type { CompsRequest } from "../../shared/comps/params.ts";
import { apiFetch } from "../shared/api/api-fetch.ts";

/**
 * The two reads the comps page is built from, apart from the hooks for the
 * reason `features/trades/query-fns` is: a function taking its inputs as
 * arguments is one a test can call. Both are plain GETs — the request is the
 * whole question, serialised once by `compsQueryParams`, which is also what
 * the paging hook keys on.
 */

/** Every subject and the corpus's bounds — once per page. */
export async function fetchCompPlayers({
  signal,
}: {
  signal?: AbortSignal;
}): Promise<CompPlayersPayload> {
  const res = await apiFetch("/api/comps/players", {
    signal,
    fallbackError: "Failed to load players",
  });
  return (await res.json()) as CompPlayersPayload;
}

/** The ranked comps for one request. */
export async function fetchComps({
  request,
  signal,
}: {
  request: CompsRequest;
  signal?: AbortSignal;
}): Promise<CompsPayload> {
  const res = await apiFetch(`/api/comps?${compsQueryParams(request)}`, {
    signal,
    fallbackError: "Failed to run the comp",
  });
  return (await res.json()) as CompsPayload;
}

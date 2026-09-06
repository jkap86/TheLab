import { http } from "@/shared/http";

import { DRAFT_SOURCE_URL, parseDraftCapital } from "./draft-source.ts";
import type { KnownDraftCapital } from "./draft-source.ts";

/**
 * The draft-capital crosswalk, fetched and read. The one line of
 * `./draft-source` that reaches the network, kept apart so the reading stays
 * resolvable under Node's own runner — the split `./sleeper-source` and
 * `./season-line` already make.
 *
 * Through {@link http} rather than a bare `fetch` for the retry ladder and the
 * timeout, and as `"text"` because a CSV is not JSON. Not through the Sleeper
 * limiter: this is GitHub, and the bound is Sleeper's.
 */
export async function fetchDraftCapital(): Promise<ReadonlyMap<string, KnownDraftCapital>> {
  const { data } = await http.get<string>(DRAFT_SOURCE_URL, { responseType: "text" });
  return parseDraftCapital(data).capital;
}

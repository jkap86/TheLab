import http from "@thelab/http";

import { parseNflDraftPicks } from "./parse";

import type { NflDraftParse } from "./parse";

/**
 * The DynastyProcess player-id crosswalk — the third external host this app
 * reads, after Sleeper and KeepTradeCut.
 *
 * **This is the exact file `nfl_data_py.import_ids()` reads.** That function is
 * one `pandas.read_csv` of this URL and nothing else, which is why the ingest
 * is an axios GET here rather than a Python runtime in the deploy for a single
 * CSV fetch. `scripts/nfl-draft-picks.py` does the same read through the
 * library, and is how to check this path against the library's own answer when
 * the source changes.
 *
 * Why this file and not `nflverse`'s own draft release: the nflverse draft
 * table keys on `gsis_id`/`pfr_id` and carries no Sleeper id, so using it would
 * put this app back in KeepTradeCut's position — resolving players by name,
 * which is the most error-prone code in the repo. This crosswalk carries
 * `sleeper_id` directly. It is not a downgrade in accuracy: its `draft_ovr`
 * agrees with the authoritative PFR draft record on 100% of the 3,167 players
 * the two can be cross-matched on.
 */
export const NFL_DRAFT_IDS_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/**
 * Fetch and parse the crosswalk (~2.6MB, ~12,500 rows).
 *
 * `responseType: "text"` is load-bearing: axios sniffs JSON by default and a
 * CSV body would arrive as a string anyway, but saying so keeps a future
 * content-type change from handing the parser something that isn't text.
 */
export async function fetchNflDraftPicks(): Promise<NflDraftParse> {
  const { data } = await http.get<string>(NFL_DRAFT_IDS_URL, {
    responseType: "text",
  });
  return parseNflDraftPicks(data);
}

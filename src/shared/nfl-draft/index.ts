/**
 * Where a player was taken in the **NFL** draft — the real one, not the fantasy
 * drafts `shared/manager` crawls.
 *
 * Sleeper publishes no draft position at all, so this is a second non-Sleeper
 * source alongside KeepTradeCut, read from the DynastyProcess crosswalk that
 * `nfl_data_py.import_ids()` reads (see `client.ts` for why that is an axios GET
 * and not a Python process, and `scripts/nfl-draft-picks.py` for the same read
 * done through the library).
 *
 * The split is this package's usual one: `parse`, `capital`, `validate` and
 * `refresh-tick` are pure and tested — they hold every rule about what a scraped
 * row *means* and what a scheduled run asks for — and `client`, `queries`,
 * `sync` and `scheduler` are the thin I/O around them.
 */

export { fetchNflDraftPicks, NFL_DRAFT_IDS_URL } from "./client";
export {
  DRAFT_CAPITAL_HALF_LIFE,
  DRAFT_CAPITAL_PEAK,
  NFL_DRAFT_LAST_PICK,
  UNDRAFTED_SLOT,
  draftCapital,
  draftPickLabel,
  pickCapital,
} from "./capital";
export { parseNflDraftPicks } from "./parse";
export {
  countNflDraftPicks,
  getNflDraftClassIds,
  getNflDraftPicks,
} from "./queries";
export { startNflDraftScheduler } from "./scheduler";
export { NFL_DRAFT_TTL_MS, syncNflDraftPicks } from "./sync";
export { validateNflDraftPicks } from "./validate";

export type { NflDraftParse, NflDraftRejection } from "./parse";
export type { NflDraftSyncSummary } from "./sync";
export type { NflDraftPick } from "./types";
export type { NflDraftValidation } from "./validate";

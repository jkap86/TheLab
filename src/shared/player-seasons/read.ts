import { buildCorpus } from "./corpus";
import type { CompCorpus } from "./corpus";
import { readStoredSeasons } from "./queries";
import { SAMPLE_CORPUS } from "./sample";

/**
 * The corpus the comps routes answer from, held in process between reads.
 *
 * **The stored table where it has rows, the sample where it has none**, and
 * the payload says which. That is a fallback on one condition only — an
 * empty table, which is the state a checkout is in until a loader runs — and
 * never on a failure: a database that cannot be read is a 500 from the route,
 * because answering the sample in its place would put twenty-six invented
 * comps under a page that looks healthy.
 *
 * Cached on `projections/ros-read`'s terms: a TTL, a failed read evicted
 * rather than cached, and one slot on `globalThis` so a dev reload does not
 * re-read a few thousand rows per edit. The TTL is generous because the
 * table changes only when somebody loads it, and a loader that wants its
 * rows read at once has a fifteen-minute wait or a restart.
 */
export const CORPUS_TTL_MS = 15 * 60 * 1000;

type Entry = { at: number; corpus: Promise<CompCorpus> };

const CACHE_KEY = Symbol.for("thelab.comps.corpus");
const globalScope = globalThis as typeof globalThis & { [CACHE_KEY]?: Entry };

export function getCompCorpus(): Promise<CompCorpus> {
  const cached = globalScope[CACHE_KEY];
  if (cached && Date.now() - cached.at < CORPUS_TTL_MS) return cached.corpus;

  const entry: Entry = { at: Date.now(), corpus: readCorpus() };
  globalScope[CACHE_KEY] = entry;
  entry.corpus.catch(() => {
    if (globalScope[CACHE_KEY] === entry) delete globalScope[CACHE_KEY];
  });
  return entry.corpus;
}

async function readCorpus(): Promise<CompCorpus> {
  const rows = await readStoredSeasons();
  if (rows.length === 0) return SAMPLE_CORPUS;
  return buildCorpus(rows, "stored");
}

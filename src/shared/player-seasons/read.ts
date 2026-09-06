import type { CompCorpusInfo, CompCorpusMeta } from "@/shared/contract";

import { sampleCorpusAccess } from "./availability";
import { buildCorpus } from "./corpus";
import type { CompCorpus } from "./corpus";
import { probeCorpus, readStoredSeasons } from "./queries";
import type { CorpusProbe } from "./queries";
import { SAMPLE_CORPUS } from "./sample";

/**
 * The corpus the comps routes answer from, held in process between reads.
 *
 * **The stored table where it has rows; the sample only where this deployment
 * has said it may.** That gate is `./availability`, and it is the difference
 * between a development checkout that renders and a production page quietly
 * serving twenty-six invented seasons. Where neither is available the corpus
 * is `unavailable` — an empty corpus the routes answer 200 with, so the page
 * can say what is wrong in its own words. A database that cannot be *read* is
 * still a rejection here and a 500 from the route: "we have no corpus" and
 * "we could not ask" are different sentences.
 *
 * **It is keyed by the corpus's version rather than by a clock**, which is the
 * one thing this cache does that the ROS board's does not. A historical corpus
 * changes when somebody loads it and at no other time, so rebuilding it every
 * fifteen minutes is a few thousand rows re-read and re-shaped for an answer
 * that cannot have moved. What is re-read on a clock is the *version* — one
 * statement, one round trip, a metadata row and a `count(*)` — and the built
 * corpus is reused whenever that comes back the same. A load therefore lands
 * within {@link CORPUS_META_TTL_MS} rather than within a quarter of an hour,
 * and a quiet corpus costs one cheap probe a minute however many requests
 * arrive.
 *
 * **Single-flighted**: the promise is registered before the read is awaited,
 * with nothing between the miss and the insert, so concurrent cold requests
 * share one read rather than each fetching the corpus for themselves. A
 * rejection evicts, on `projections/ros-read`'s rule — an error remembered for
 * the TTL is an outage extended by the mechanism meant to absorb one.
 */

/** How often the corpus's version is re-probed. */
export const CORPUS_META_TTL_MS = 60 * 1000;

/**
 * How long a build may be reused without its version being confirmed.
 *
 * The probe is what normally decides, and this is the ceiling for the case
 * where the probe itself keeps failing: a build older than this is rebuilt
 * rather than served indefinitely on the strength of a check that has not
 * succeeded since.
 */
export const CORPUS_TTL_MS = 15 * 60 * 1000;

/**
 * A corpus and the provenance that describes it, which every caller wants
 * together: a payload quotes the version the ranking ran against, and the two
 * coming from separate reads is how a page could name one load's scoring basis
 * over another load's rows.
 */
export type CorpusRead = {
  corpus: CompCorpus;
  info: CompCorpusInfo;
};

type Entry = {
  version: string;
  /** When the build was started. */
  at: number;
  /** When the version behind it was last confirmed. */
  checkedAt: number;
  read: Promise<CorpusRead>;
};

const CACHE_KEY = Symbol.for("thelab.comps.corpus");
const globalScope = globalThis as typeof globalThis & { [CACHE_KEY]?: Entry };

/** Drop the held corpus, so the next read rebuilds. For a loader and its tests. */
export function refreshCompCorpus(): void {
  delete globalScope[CACHE_KEY];
}

export async function getCompCorpus(): Promise<CorpusRead> {
  const now = Date.now();
  const cached = globalScope[CACHE_KEY];
  if (cached && now - cached.checkedAt < CORPUS_META_TTL_MS) return cached.read;

  let probe: CorpusProbe;
  try {
    probe = await probeCorpus();
  } catch (error) {
    // A probe that fails over a build we already hold is a reason to keep
    // serving it, not to throw the reader's page away: the rows behind it have
    // not stopped being what they were. Past the hard TTL there is nothing left
    // to stand on and the failure is the caller's.
    if (cached && Date.now() - cached.at < CORPUS_TTL_MS) return cached.read;
    throw error;
  }

  const version = corpusVersion(probe);
  const current = globalScope[CACHE_KEY];
  if (current && current.version === version) {
    current.checkedAt = Date.now();
    return current.read;
  }

  const entry: Entry = {
    version,
    at: Date.now(),
    checkedAt: Date.now(),
    read: buildFrom(probe, version),
  };
  globalScope[CACHE_KEY] = entry;
  entry.read.catch(() => {
    if (globalScope[CACHE_KEY] === entry) delete globalScope[CACHE_KEY];
  });
  return entry.read;
}

/**
 * The string a build is keyed by. It has to move whenever the rows do and
 * nowhere else.
 *
 * A loaded corpus is identified by its metadata row — the load's instant and
 * the count it wrote — which moves on every load and on nothing else. A table
 * with rows and no metadata row (an older loader, a restore, a hand load) is
 * identified by its fingerprint instead, so it still caches and still notices
 * a reload; that is a weaker identity, because a load that replaced a row
 * without changing the count or the season bounds would not move it, which is
 * why the loader writes the metadata row.
 */
function corpusVersion(probe: CorpusProbe): string {
  if (probe.rows === 0) return "empty";
  if (probe.meta) {
    return `stored:${probe.meta.loaded_at}:${probe.meta.rows}:${probe.meta.loader_version}`;
  }
  return `rows:${probe.rows}:${probe.min_season ?? "-"}:${probe.max_season ?? "-"}`;
}

async function buildFrom(
  probe: CorpusProbe,
  version: string,
): Promise<CorpusRead> {
  if (probe.rows === 0) {
    const access = sampleCorpusAccess(
      process.env,
      process.env.NODE_ENV === "production",
    );
    if (!access.allowed) {
      console.warn(`[comps] ${access.reason}`);
      return read(UNAVAILABLE_CORPUS, version, null);
    }
    return read(SAMPLE_CORPUS, version, null);
  }

  const rows = await readStoredSeasons();
  // The rows can be gone between the probe and the read — a `TRUNCATE`, a
  // reload mid-flight — and an empty build is the honest answer to that rather
  // than a silent sample; the next probe will see the new version and rebuild.
  if (rows.length === 0) return read(UNAVAILABLE_CORPUS, version, null);

  const corpus = buildCorpus(rows, "stored", {
    coveredSeasons: probe.meta?.seasons,
    maxCompletedSeason: probe.meta?.max_completed_season,
  });
  return read(corpus, version, probe.meta);
}

/**
 * The corpus a deployment with no loaded rows and no sample answers from.
 *
 * Empty rather than absent, so every caller shapes an ordinary payload out of
 * it and the page reads `source: "unavailable"` rather than an error string it
 * cannot act on.
 */
const UNAVAILABLE_CORPUS: CompCorpus = {
  source: "unavailable",
  subject_season: 0,
  covered_seasons: [],
  max_completed_season: 0,
  seasons: [],
  subjects: [],
};

/**
 * A corpus paired with the provenance a payload quotes for it.
 *
 * `version` is stamped from the probe that decided the build rather than
 * re-derived, so two payloads built from one corpus quote one version whatever
 * the table has done since. `meta` is null for the sample and for a table with
 * no metadata row — a corpus that cannot state its own scoring basis says so
 * rather than guessing at one.
 */
function read(
  corpus: CompCorpus,
  version: string,
  meta: CompCorpusMeta | null,
): CorpusRead {
  return {
    corpus,
    info: {
      source: corpus.source,
      version,
      through_season:
        corpus.max_completed_season > 0 ? corpus.max_completed_season : null,
      meta,
    },
  };
}

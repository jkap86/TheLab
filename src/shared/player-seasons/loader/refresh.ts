import type { CompCorpusMeta } from "@/shared/contract";

import { EARLIEST_SEASON } from "./plan.ts";
import { DEFAULT_SCORING, isCompsScoring } from "./season-line.ts";
import type { CompsScoring } from "./season-line.ts";

/**
 * Whether the stored corpus is missing anything, and what.
 *
 * **This is the gate that makes the corpus load a boot task rather than a boot
 * cost.** `./load` is a whole-span fetch — eighteen weeks of Sleeper per
 * season — and running it every time a server starts would be minutes of
 * upstream traffic on every deploy to rewrite rows that have not changed since
 * the last one. So the boot loop asks this first, and this answers from the
 * corpus's own metadata row: what a load *wrote* is the record of what is
 * there, exactly as `manager_syncs.synced_at` is for a league graph.
 *
 * Pure, with the probe and the state's answer as arguments, so every arm is
 * testable without a database or a network — and every arm is one that renders
 * a perfectly ordinary console line while being wrong.
 *
 * Four decisions carry it.
 *
 * **The corpus extends forward and never backfills below its own floor.** An
 * operator who loaded `--from 2020` chose that span, and a boot hook that read
 * {@link EARLIEST_SEASON} as a floor would re-fetch 2018 and 2019 on every
 * boot, for ever, against their decision. So the floor is the earliest season
 * the corpus *has*, and only a corpus with nothing in it takes the default.
 *
 * **Interior gaps are still due.** The floor decides where to start looking and
 * not what to ask for: the answer is every season in the span the metadata row
 * does not claim. A season that failed its load leaves a hole, and asking only
 * for seasons past the newest stored one is how that hole would become
 * permanent the moment a later season succeeded — with the covered-season list
 * still reporting a healthy corpus, and every player of the season before the
 * hole reading as a retirement.
 *
 * **The scoring basis is read from the corpus, never compared against it.**
 * Nothing downstream requires {@link DEFAULT_SCORING} — the page prints
 * whichever basis the metadata row names — so a corpus loaded on PPR is a
 * deliberate choice rather than a mismatch, and treating it as one would have
 * the boot loop rewrite the whole thing in half-PPR on every single boot. What
 * the decision carries instead is the basis to *extend* it on, because a corpus
 * whose seasons are on two scoring bases is not comparable to itself.
 *
 * **A loader version that moved is a full reload, and that one is deliberate.**
 * {@link LOADER_VERSION} moves when the meaning of a written row changes, so
 * the stored rows and the ones this build would write are different
 * measurements; extending across them would be the same fault as mixing two
 * scorings. It fires once per version bump, because a load that succeeds
 * writes the new version.
 */

/** The corpus facts a decision is made from — `probeCorpus`'s own answer. */
export type CorpusRefreshProbe = {
  meta: CompCorpusMeta | null;
  rows: number;
  min_season: number | null;
  max_season: number | null;
};

export type CorpusRefreshInputs = {
  /** The latest season known to be complete — `latestCompleteSeason`'s answer. */
  latestComplete: number;
  /** The version this build's loader writes. */
  loaderVersion: string;
  /** The floor for a corpus that has nothing in it. */
  earliestSeason?: number;
};

/**
 * What the boot loop does with the answer. `due: false` is a skip and a log
 * line; `due: true` names the seasons to ask for and the basis to fold them on,
 * and the reason is what the operator reads either way.
 */
export type CorpusRefreshDecision =
  | { due: false; reason: string }
  | { due: true; reason: string; seasons: number[]; scoring: CompsScoring };

export function corpusRefresh(
  probe: CorpusRefreshProbe,
  { latestComplete, loaderVersion, earliestSeason = EARLIEST_SEASON }: CorpusRefreshInputs,
): CorpusRefreshDecision {
  // Nothing is known to be complete, so nothing can be loaded — including on
  // an empty corpus, where the honest answer is still "not yet" rather than a
  // fetch of seasons nobody has finished playing. `latestCompleteSeason`
  // answers 0 both for an unreadable state and for a Sleeper outage.
  if (!Number.isInteger(latestComplete) || latestComplete <= 0) {
    return {
      due: false,
      reason: "no season is known to be complete (the NFL state could not be read)",
    };
  }

  const { meta } = probe;

  if (probe.rows === 0) {
    return due(
      span(earliestSeason, latestComplete),
      DEFAULT_SCORING,
      "no corpus is loaded",
    );
  }

  // Rows with no metadata row cannot come from this loader — it writes both in
  // one transaction, or neither — so this is a restore, a hand load or a
  // corpus written before the metadata table existed. Its coverage is unknown,
  // which is precisely what the did-not-play rule reads, so it is reloaded
  // rather than trusted. One successful load ends it.
  if (!meta) {
    return due(
      span(probe.min_season ?? earliestSeason, latestComplete),
      DEFAULT_SCORING,
      "the corpus has rows but no metadata row, so its coverage is unknown",
    );
  }

  const scoring = isCompsScoring(meta.scoring) ? meta.scoring : DEFAULT_SCORING;
  const floor = corpusFloor(probe, meta, earliestSeason);

  if (meta.loader_version !== loaderVersion) {
    return due(
      span(floor, latestComplete),
      scoring,
      `the corpus was written by loader ${meta.loader_version} and this build writes ${loaderVersion}`,
    );
  }

  const covered = new Set(meta.seasons);
  const missing = span(floor, latestComplete).filter((s) => !covered.has(s));
  if (missing.length === 0) {
    return {
      due: false,
      reason: `${meta.seasons.length} season${meta.seasons.length === 1 ? "" : "s"} on file through ${latestComplete}`,
    };
  }

  return due(missing, scoring, `missing ${missing.join(", ")}`);
}

/**
 * The earliest season the corpus is answerable for.
 *
 * The metadata row's own list first, since that is what an operator's `--from`
 * produced; the rows' own minimum second, for a metadata row whose list is
 * somehow empty; the default last. Never lower than what is stored, which is
 * the "extends forward" rule above.
 */
function corpusFloor(
  probe: CorpusRefreshProbe,
  meta: CompCorpusMeta,
  earliestSeason: number,
): number {
  if (meta.seasons.length > 0) return Math.min(...meta.seasons);
  return probe.min_season ?? earliestSeason;
}

/** Every season in `[from, to]`, ascending. Empty where `from` is past `to`. */
function span(from: number, to: number): number[] {
  const seasons: number[] = [];
  for (let season = from; season <= to; season++) seasons.push(season);
  return seasons;
}

/**
 * A due answer, or the skip an empty span collapses to.
 *
 * A span can be empty — a corpus whose floor is already past the latest
 * complete season, which is what a `--from 2030` load would leave behind — and
 * a due decision naming no seasons would have the loop log a load it never
 * ran.
 */
function due(
  seasons: number[],
  scoring: CompsScoring,
  reason: string,
): CorpusRefreshDecision {
  if (seasons.length === 0) {
    return { due: false, reason: `${reason}, but no season is loadable` };
  }
  return { due: true, reason, seasons, scoring };
}

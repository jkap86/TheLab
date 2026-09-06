import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompCorpusMeta } from "@/shared/contract";

import { corpusRefresh } from "./refresh.ts";
import type { CorpusRefreshDecision, CorpusRefreshProbe } from "./refresh.ts";

const LOADER = "1";

function meta(overrides: Partial<CompCorpusMeta> = {}): CompCorpusMeta {
  return {
    source: "sleeper",
    source_version: null,
    scoring: "half_ppr",
    loader_version: LOADER,
    loaded_at: "2026-02-01T00:00:00.000Z",
    seasons: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    max_completed_season: 2024,
    rows: 4000,
    players: 900,
    ...overrides,
  };
}

function probe(overrides: Partial<CorpusRefreshProbe> = {}): CorpusRefreshProbe {
  return { meta: meta(), rows: 4000, min_season: 2018, max_season: 2024, ...overrides };
}

function decide(
  p: CorpusRefreshProbe,
  latestComplete: number,
  earliestSeason?: number,
): CorpusRefreshDecision {
  return corpusRefresh(p, { latestComplete, loaderVersion: LOADER, earliestSeason });
}

function seasonsOf(decision: CorpusRefreshDecision): number[] {
  assert.equal(decision.due, true, `expected a due decision, got: ${decision.reason}`);
  return decision.due ? decision.seasons : [];
}

describe("corpusRefresh", () => {
  it("is not due when the corpus already covers every complete season", () => {
    const decision = decide(probe(), 2024);
    assert.equal(decision.due, false);
    assert.match(decision.reason, /through 2024/);
  });

  it("loads the default span when nothing is stored", () => {
    const decision = decide({ meta: null, rows: 0, min_season: null, max_season: null }, 2020, 2018);
    assert.deepEqual(seasonsOf(decision), [2018, 2019, 2020]);
    assert.equal(decision.due && decision.scoring, "half_ppr");
  });

  it("loads only the season that has finished since the last load", () => {
    const decision = decide(probe(), 2025);
    assert.deepEqual(seasonsOf(decision), [2025]);
  });

  it("does not backfill below the corpus's own floor", () => {
    // An operator who loaded `--from 2021` chose that span; reading the
    // default floor here would re-fetch 2018-2020 on every single boot.
    const narrow = probe({
      meta: meta({ seasons: [2021, 2022, 2023, 2024] }),
      min_season: 2021,
    });
    const decision = decide(narrow, 2024, 2018);
    assert.equal(decision.due, false);
  });

  it("still retries an interior gap a failed season left behind", () => {
    // Asking only for seasons past the newest stored one is how a hole becomes
    // permanent the moment a later season succeeds.
    const holed = probe({ meta: meta({ seasons: [2018, 2019, 2021, 2022] }), max_season: 2022 });
    assert.deepEqual(seasonsOf(decide(holed, 2023)), [2020, 2023]);
  });

  it("extends a corpus on its own scoring basis, never the build's default", () => {
    const ppr = probe({ meta: meta({ scoring: "ppr" }) });
    const decision = decide(ppr, 2025);
    assert.equal(decision.due && decision.scoring, "ppr");
  });

  it("does not treat a non-default scoring basis as a reason to reload", () => {
    const ppr = probe({ meta: meta({ scoring: "ppr" }) });
    assert.equal(decide(ppr, 2024).due, false);
  });

  it("falls back to the default basis when the stored one is unreadable", () => {
    const junk = probe({ meta: meta({ scoring: "wildcard", seasons: [2018] }), min_season: 2018 });
    const decision = decide(junk, 2019);
    assert.equal(decision.due && decision.scoring, "half_ppr");
  });

  it("reloads the whole corpus when the loader version has moved", () => {
    const older = probe({ meta: meta({ loader_version: "0" }) });
    const decision = decide(older, 2024);
    assert.deepEqual(seasonsOf(decision), [2018, 2019, 2020, 2021, 2022, 2023, 2024]);
    assert.match(decision.reason, /loader 0/);
  });

  it("reloads rows that carry no metadata row, from their own floor", () => {
    const orphaned = probe({ meta: null, min_season: 2020, max_season: 2024 });
    const decision = decide(orphaned, 2024, 2018);
    assert.deepEqual(seasonsOf(decision), [2020, 2021, 2022, 2023, 2024]);
    assert.match(decision.reason, /no metadata row/);
  });

  it("loads nothing at all when no season is known to be complete", () => {
    // Including on an empty corpus: an unreadable state is not a licence to
    // fetch seasons nobody has finished playing.
    for (const p of [probe(), { meta: null, rows: 0, min_season: null, max_season: null }]) {
      const decision = corpusRefresh(p, { latestComplete: 0, loaderVersion: LOADER });
      assert.equal(decision.due, false);
      assert.match(decision.reason, /no season is known to be complete/);
    }
  });

  it("collapses to a skip when a due span turns out to name no season", () => {
    // A version bump is a reload of the corpus's whole span, and a corpus
    // whose floor is already past the latest complete season has no span. The
    // guard is what stops the loop logging a load it never ran.
    const future = probe({
      meta: meta({ seasons: [2030], loader_version: "0" }),
      min_season: 2030,
      max_season: 2030,
    });
    const decision = decide(future, 2024);
    assert.equal(decision.due, false);
    assert.match(decision.reason, /no season is loadable/);
  });

  it("never asks for a season past the latest complete one", () => {
    for (const latest of [2019, 2024, 2025, 2026]) {
      const decision = decide({ meta: null, rows: 0, min_season: null, max_season: null }, latest);
      for (const season of seasonsOf(decision)) assert.ok(season <= latest);
    }
  });
});

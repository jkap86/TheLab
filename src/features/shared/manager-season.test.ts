import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FIRST_SLEEPER_SEASON,
  seasonParam,
  stepSeason,
} from "./manager-season.ts";

describe("stepSeason", () => {
  test("steps back and forward a year at a time", () => {
    assert.equal(stepSeason("2026", -1, "2026"), "2025");
    assert.equal(stepSeason("2024", 1, "2026"), "2025");
  });

  test("will not step past the app's current season", () => {
    // A league year Sleeper has not rolled over to holds no leagues for anyone,
    // so the ceiling is a fact about the app rather than about the account.
    assert.equal(stepSeason("2026", 1, "2026"), null);
    assert.equal(stepSeason("2025", 1, "2026"), "2026");
  });

  test("will not step below Sleeper's first season", () => {
    assert.equal(stepSeason(FIRST_SLEEPER_SEASON, -1, "2026"), null);
    assert.equal(stepSeason("2018", -1, "2026"), FIRST_SLEEPER_SEASON);
  });

  test("fails closed on anything that isn't a four-digit year", () => {
    // Both directions, and for either bound as well as the season itself: an
    // inert stepper is visible, where a season nothing can resolve comes back as
    // an empty league list and reads as "this manager has none".
    for (const by of [-1, 1]) {
      assert.equal(stepSeason("all", by, "2026"), null);
      assert.equal(stepSeason("26", by, "2026"), null);
      assert.equal(stepSeason("", by, "2026"), null);
      assert.equal(stepSeason("2026", by, "later"), null);
      assert.equal(stepSeason("2026", by, "2026", "nope"), null);
    }
  });

  test("a season outside the ladder can still step back into it", () => {
    // Nothing writes one — but a stored selection outliving a rollover is the
    // shape of thing that produces one, and stranding the reader on a season
    // with both keys dead would be the worst answer available.
    assert.equal(stepSeason("2027", -1, "2026"), "2026");
    assert.equal(stepSeason("2027", 1, "2026"), null);
  });
});

describe("seasonParam", () => {
  test("omits the current season so the shared leagues entry is one entry", () => {
    // The pick tracker and the lineup checker read the stream with no season at
    // all, which `managerQueryKeys` files under `"default"`. Naming it here
    // would file the identical answer under a second key.
    assert.equal(seasonParam("2026", "2026"), undefined);
  });

  test("names a past season, which is a different selection", () => {
    assert.equal(seasonParam("2025", "2026"), "2025");
  });
});

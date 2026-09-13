import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Pinned textually, on `crawl-writes.test.ts`' terms: the route imports through
 * the `@/` alias, which Node's own runner cannot resolve, and the decision below
 * lives in which variable one call is handed — nothing *fails* when it is wrong.
 * What it looks like wrong is every trade from somebody else's league opening
 * onto "no rosters read for this league yet", beside a perfectly healthy 200.
 */
const source = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

describe("the per-league lineup route", () => {
  test("solves for the reader only where they hold a roster", () => {
    // `solveLeagueEntry` answers null for a named manager with no roster, so
    // the resolved id may reach it only through the membership check.
    assert.match(
      source,
      /league\.rosters\.some\(\s*\(roster\) => roster\.owner_id === managerUserId\s*\)/,
    );
    assert.match(source, /solveLeagueEntry\(\s*league,\s*holder,/);
    assert.doesNotMatch(source, /solveLeagueEntry\(\s*league,\s*managerUserId,/);
  });

  test("still prices the ADP board off the reader's own drafts", () => {
    // The board is theirs in any league; only the mark is narrowed.
    assert.match(source, /readAdp\(managerUserId, season, superflex\)/);
  });
});

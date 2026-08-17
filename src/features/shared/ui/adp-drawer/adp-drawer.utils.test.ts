import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/manager";
import type { AdpAuctionStats, AdpBoardStats } from "@/shared/manager";

import {
  DEFAULT_ADP_RANGE,
  DEFAULT_ADP_ROUNDS,
  defaultAdpControls,
  seedFromLeague,
} from "../../adp-controls.ts";
import { ROUNDS_SEGMENT } from "./adp-drawer.constants.ts";
import {
  adpCellTitle,
  auctionCellTitle,
  auctionShare,
  auctionTitle,
  boardTitle,
  soleBoardOf,
  takenShare,
  takenTitle,
  valueTitle,
  withLeagueFilters,
  withSeason,
  withSeededLeague,
} from "./adp-drawer.utils.ts";

const controls = defaultAdpControls("2026");

const league = (id: string, teams: number): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2025",
  status: "in_season",
  total_rosters: teams,
  avatar: null,
  record: null,
  settings: { type: 2, best_ball: 1 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"],
  scoring_settings: { rec: 0.5 },
});

const stats = (over: Partial<AdpBoardStats> = {}): AdpBoardStats => ({
  picks: 46,
  adp: 3.2,
  min_pick: 1,
  max_pick: 12,
  stdev: 2.35,
  ...over,
});

const bid = (over: Partial<AdpAuctionStats> = {}): AdpAuctionStats => ({
  buys: 9,
  share: 24.5,
  min_share: 12,
  max_share: 38.5,
  stdev: 7.25,
  ...over,
});

describe("the draft-kind row", () => {
  test("it offers the three buckets the query string knows how to send", () => {
    // The vocabulary the route parses, one side of a matched pair with no
    // compiler link: a value dropped here is a filter that silently stops
    // narrowing rather than a type error.
    assert.deepEqual(
      ROUNDS_SEGMENT.options.map((o) => o.value),
      ["all", "full", "rookie"],
    );
  });

  test("Reset returns it to the board's own default, not to the first option", () => {
    // The board opens on startups, which is not "All drafts" — see
    // `DEFAULT_ADP_ROUNDS` for why an unnarrowed default is the wrong one here.
    assert.equal(ROUNDS_SEGMENT.defaultValue, DEFAULT_ADP_ROUNDS);
    assert.notEqual(ROUNDS_SEGMENT.defaultValue, ROUNDS_SEGMENT.options[0].value);
  });
});

describe("the control writes", () => {
  test("a season change drops the window with it", () => {
    const narrowed = {
      ...controls,
      season: "2026",
      range: { preset: "30d" as const, from: null, to: null },
    };
    const next = withSeason(narrowed, "2024");
    assert.equal(next.season, "2024");
    // A date range is a cut *inside* a season, so the same dates against
    // another one are a window that mostly isn't there. It lands on the whole
    // season and *not* on `DEFAULT_ADP_RANGE`, which is a relative fortnight —
    // exactly the window a season that ended a year ago does not contain.
    assert.deepEqual(next.range, { preset: "all", from: null, to: null });
    assert.notDeepEqual(next.range, DEFAULT_ADP_RANGE);
  });

  test("a season change touches nothing else", () => {
    const rules = { ...controls.leagueRules, bestBall: "yes" as const };
    const next = withSeason({ ...controls, leagueRules: rules }, "2025");
    assert.deepEqual(next.leagueRules, rules);
    assert.equal(next.rounds, controls.rounds);
    assert.equal(next.boards, controls.boards);
  });

  test("the Leagues bay lands both of its halves in one object", () => {
    // The regression this exists for: the rules and the draft kind used to be
    // applied as two calls closing over the same stored controls, so the second
    // reverted the first's field. Changing either alone worked, which is why it
    // survived — so the case worth pinning is changing *both*.
    const rules = {
      ...controls.leagueRules,
      settings: [{ key: "teams", op: "eq" as const, value: 12 }],
    };
    const next = withLeagueFilters(controls, rules, "rookie");
    assert.deepEqual(next.leagueRules, rules);
    assert.equal(next.rounds, "rookie");
  });

  test("committing the Leagues bay moves nothing the other bays own", () => {
    const narrowed = {
      ...controls,
      season: "2024",
      range: { preset: "30d" as const, from: null, to: null },
      steepness: 4,
      boards: "dynasty" as const,
    };
    const next = withLeagueFilters(narrowed, controls.leagueRules, "all");
    assert.equal(next.season, "2024");
    assert.deepEqual(next.range, narrowed.range);
    assert.equal(next.steepness, 4);
    assert.equal(next.boards, "dynasty");
  });

  test("seeding by id is exactly seedFromLeague", () => {
    const leagues = [league("a", 12), league("b", 10)];
    assert.deepEqual(
      withSeededLeague(controls, leagues, "b"),
      seedFromLeague(controls, leagues[1]),
    );
  });

  test("an id nothing matches writes nothing", () => {
    assert.equal(withSeededLeague(controls, [league("a", 12)], "zzz"), null);
    assert.equal(withSeededLeague(controls, [], "a"), null);
  });
});

describe("the board's own wording", () => {
  test("the sole board is redraft unless dynasty is the one shown", () => {
    assert.equal(soleBoardOf("redraft"), "redraft");
    assert.equal(soleBoardOf("dynasty"), "dynasty");
    assert.equal(soleBoardOf("both"), "redraft");
  });

  test("a heading names its population, with the count when there is one", () => {
    assert.equal(
      boardTitle("redraft", null),
      "Average draft position over drafts in redraft and keeper leagues",
    );
    assert.equal(
      boardTitle("dynasty", 1204),
      "Average draft position over 1,204 drafts in dynasty leagues",
    );
    assert.match(takenTitle("redraft"), /redraft board’s drafts/);
    assert.match(valueTitle(controls.leagueRules), /slot startable pool/);
    // The premise is the pool an exact size *rule* implies, not a constant.
    const sized = (teams: number) => ({
      ...controls.leagueRules,
      settings: [{ key: "teams", op: "eq" as const, value: teams }],
    });
    assert.notEqual(valueTitle(sized(10)), valueTitle(sized(12)));
    // A bound is a range of pools rather than one, so it falls back rather than
    // guessing at an end of it — see `previewDraftTeams`.
    assert.equal(
      valueTitle({
        ...controls.leagueRules,
        settings: [{ key: "teams", op: "gte", value: 14 }],
      }),
      valueTitle(controls.leagueRules),
    );
  });

  test("an ADP cell's hover carries the spread and the sample", () => {
    assert.equal(
      adpCellTitle(stats({ picks: 1 }), "redraft", 1204),
      "Picks 1–12 · taken in 1 of 1,204 redraft draft · ±2.4",
    );
    assert.equal(
      adpCellTitle(stats(), "dynasty", null),
      "Picks 1–12 · taken in 46 dynasty drafts · ±2.4",
    );
  });

  test("the taken share is of this board's drafts, and an em dash otherwise", () => {
    assert.equal(takenShare(stats({ picks: 46 }), 100), "46%");
    assert.equal(takenShare(null, 100), "—");
    assert.equal(takenShare(stats(), null), "—");
    // A board with no drafts is a missing denominator, never a 0%.
    assert.equal(takenShare(stats(), 0), "—");
  });

  test("an ADP cell's hover carries the bid too, and only where there is one", () => {
    // The Bid column is absent with both boards up and on a narrow panel, so
    // this hover is the only place the reading is stated at those sizes. It must
    // not append a clause when there is nothing to say — that would be a note
    // about auctions on nearly every row of a board where none is the norm.
    assert.ok(
      adpCellTitle(stats(), "redraft", 1204, bid({ share: 24.5 })).endsWith(
        "· 24.5% of budget at auction",
      ),
    );
    assert.ok(!adpCellTitle(stats(), "redraft", 1204).includes("auction"));
    assert.ok(!adpCellTitle(stats(), "redraft", 1204, null).includes("auction"));
  });
});

describe("the auction column's wording", () => {
  test("the share is written at the precision a 36px track holds", () => {
    // Four characters is the bound, and it is also the right reading: a tenth of
    // a percent on a 58% player is noise, and a whole percent on a $1 flier is
    // zero.
    assert.equal(auctionShare(bid({ share: 58.4 })), "58%");
    assert.equal(auctionShare(bid({ share: 100 })), "100%");
    assert.equal(auctionShare(bid({ share: 9.96 })), "10.0%");
    assert.equal(auctionShare(bid({ share: 0.5 })), "0.5%");
    for (const share of [0.5, 9.9, 10, 58.4, 100]) {
      assert.ok(auctionShare(bid({ share }))!.length <= 5);
    }
  });

  test("no reading is an em dash, never a 0%", () => {
    // A player the crawled auctions never bought is a gap in the sample rather
    // than a free player — the cell draws the dash, so this answers null.
    assert.equal(auctionShare(null), null);
  });

  test("the heading names its population and says it is not the ADP's", () => {
    const titled = auctionTitle("redraft", 48);
    assert.ok(titled.includes("48 crawled redraft auctions"));
    assert.ok(titled.includes("budget"));
    // The claim the column cannot make on its own face, and the one a reader
    // would otherwise get wrong: these are not the drafts beside it.
    assert.ok(titled.includes("never includes auctions"));
    // Singular, and no invented denominator where the count has not arrived.
    assert.ok(auctionTitle("dynasty", 1).includes("1 crawled dynasty auction "));
    assert.ok(!auctionTitle("dynasty", null).includes("0"));
  });

  test("a cell's hover carries the spread and the sample behind the share", () => {
    assert.equal(
      auctionCellTitle(bid(), "redraft", 1204),
      "Bids 12.0%–38.5% · bought in 9 of 1,204 redraft auctions · ±7.3%",
    );
    assert.equal(
      auctionCellTitle(bid({ buys: 1, stdev: 0 }), "dynasty", null),
      "Bids 12.0%–38.5% · bought in 1 dynasty auction · ±0.0%",
    );
  });
});

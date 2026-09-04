import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DYNASTY_LEAGUE_TYPE,
  dynastyPickGrid,
  leagueRosterPicks,
  ownedDraftPicks,
  snakePickInRound,
} from "./draft-picks.ts";
import type {
  DraftPickAsset,
  LeagueDraft,
  LeagueDraftRow,
  PickLeague,
  TradedPick,
} from "./draft-picks.ts";

const pick = (
  season: string,
  round: number,
  roster_id: number,
  owner_id: number,
): TradedPick => ({ season, round, roster_id, owner_id });

const draft = (
  draft_id: string,
  season: string,
  status: string | null,
  start_time: number | null,
  rounds: number | null,
): LeagueDraft => ({ draft_id, season, status, start_time, rounds });

/** "season round(from origin)" for a compact assertion of a roster's picks. */
const describePick = (p: DraftPickAsset): string =>
  `${p.season} R${p.round}<-${p.original_roster_id}`;

describe("ownedDraftPicks", () => {
  test("no traded picks yields no picks at all", () => {
    assert.equal(ownedDraftPicks([], [1, 2, 3], "2026").size, 0);
  });

  test("fills the whole grid for every seen season and round from originals", () => {
    // Only one 2026 R2 pick was traded, but the grid is 2026 rounds 1..2 for all
    // three rosters — a roster with no trade still owns its own picks.
    const owned = ownedDraftPicks([pick("2026", 2, 1, 2)], [1, 2, 3], "2026");

    assert.deepEqual(owned.get(3)?.map(describePick), [
      "2026 R1<-3",
      "2026 R2<-3",
    ]);
  });

  test("a traded pick leaves the giver and joins the receiver", () => {
    // Roster 1's 2026 first goes to roster 2.
    const owned = ownedDraftPicks([pick("2026", 1, 1, 2)], [1, 2], "2026");

    // 1 owns nothing now (absent, which the caller reads as an empty list); 2
    // holds its own first plus the acquired one.
    assert.equal(owned.has(1), false);
    assert.deepEqual(owned.get(2)?.map(describePick), [
      "2026 R1<-2", // own pick first
      "2026 R1<-1", // acquired, tagged with its origin
    ]);
  });

  test("rounds run 1..deepest round anyone traded", () => {
    // A 2026 R3 pick was traded, so the grid is rounds 1..3 even though rounds 1
    // and 2 saw no trade.
    const owned = ownedDraftPicks([pick("2026", 3, 2, 1)], [1, 2], "2026");
    assert.deepEqual(owned.get(1)?.map((p) => p.round), [1, 2, 3, 3]);
  });

  test("only seasons that appear in trades are enumerated", () => {
    const owned = ownedDraftPicks([pick("2027", 1, 1, 2)], [1, 2], "2026");
    const seasons = new Set([...owned.values()].flat().map((p) => p.season));
    assert.deepEqual([...seasons], ["2027"]);
  });

  test("past-season rows before minSeason are dropped", () => {
    const owned = ownedDraftPicks(
      [pick("2025", 1, 1, 2), pick("2026", 1, 1, 2)],
      [1, 2],
      "2026",
    );
    const seasons = new Set([...owned.values()].flat().map((p) => p.season));
    assert.deepEqual([...seasons], ["2026"]);
  });

  test("a grid enumerates its own seasons whether or not picks moved there", () => {
    // Nothing has ever been traded, so the derived grid is empty; the dynasty
    // grid still lays out three seasons two rounds deep for both rosters.
    const owned = ownedDraftPicks([], [1, 2], "2026", {
      seasons: ["2026", "2027", "2028"],
      rounds: null,
      minRounds: 2,
    });

    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2026 R1<-1",
      "2026 R2<-1",
      "2027 R1<-1",
      "2027 R2<-1",
      "2028 R1<-1",
      "2028 R2<-1",
    ]);
  });

  test("a grid's seasons replace the traded ones entirely", () => {
    // The 2026 pick is outside the window: its cell is never enumerated, so it
    // moves nobody, and 2029 is listed despite no pick there ever moving.
    const owned = ownedDraftPicks([pick("2026", 1, 1, 2)], [1, 2], "2026", {
      seasons: ["2027", "2028", "2029"],
      rounds: null,
      minRounds: 1,
    });

    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2027 R1<-1",
      "2028 R1<-1",
      "2029 R1<-1",
    ]);
  });

  test("a traded pick still deepens a grid, from any season in range", () => {
    // A 2026 third proves the league's rookie drafts run three rounds, so the
    // 2027-2029 window runs that deep too even though `minRounds` says one.
    const owned = ownedDraftPicks([pick("2026", 3, 1, 2)], [1], "2026", {
      seasons: ["2027"],
      rounds: null,
      minRounds: 1,
    });
    assert.deepEqual(owned.get(1)?.map((p) => p.round), [1, 2, 3]);
  });

  test("an exact round count is exact: trades neither deepen nor shrink it", () => {
    // The league now drafts two rounds. A traded third is a relic of a deeper
    // era and falls off the board; the second round is enumerated regardless.
    const owned = ownedDraftPicks([pick("2027", 3, 1, 2)], [1], "2026", {
      seasons: ["2027"],
      rounds: 2,
      minRounds: 1,
    });
    assert.deepEqual(owned.get(1)?.map((p) => p.round), [1, 2]);
  });

  test("a grid with no depth at all yields nothing", () => {
    // An inaugural dynasty league that has only run its startup: no rookie
    // draft to measure and no pick traded, so there is no honest round count.
    const owned = ownedDraftPicks([], [1, 2], "2026", {
      seasons: ["2026", "2027", "2028"],
      rounds: null,
      minRounds: null,
    });
    assert.equal(owned.size, 0);
  });

  test("picks sort by season, then round, own before acquired", () => {
    const owned = ownedDraftPicks(
      [pick("2027", 1, 2, 1), pick("2026", 1, 3, 1)],
      [1, 2, 3],
      "2026",
    );
    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2026 R1<-1", // own 2026 first
      "2026 R1<-3", // acquired 2026 from roster 3
      "2027 R1<-1", // own 2027
      "2027 R1<-2", // acquired 2027 from roster 2
    ]);
  });
});

describe("dynastyPickGrid", () => {
  test("an untaken class opens the window on the league's own season", () => {
    // The 2026 rookie draft is scheduled and unfinished, so its picks are still
    // live: 2026-2028.
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "drafting", 1_777_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
  });

  test("a completed class rolls the window forward", () => {
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "complete", 1_777_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
  });

  test("a season the sync has never seen keeps the nearer year", () => {
    // No draft stored for 2026 at all. Absent is not evidence the class was
    // taken, and showing a pick that exists beats hiding one.
    const grid = dynastyPickGrid(
      "2026",
      [draft("d25", "2025", "complete", 1_745_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
  });

  test("a completed startup does not count as this year's rookie class", () => {
    // Inaugural league: the startup ended in August, the rookie draft has not
    // happened, so 2026 picks are still tradable.
    const grid = dynastyPickGrid(
      "2026",
      [draft("startup", "2026", "complete", 1_755_000_000_000, 25)],
      null,
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
    // ...and the startup's 25 rounds say nothing about how deep next May runs.
    assert.equal(grid?.minRounds, null);
  });

  test("an inaugural league's rookie draft is read past its startup", () => {
    const grid = dynastyPickGrid(
      "2026",
      [
        draft("startup", "2026", "complete", 1_750_000_000_000, 25),
        draft("rookie", "2026", "complete", 1_755_000_000_000, 4),
      ],
      "",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
    assert.equal(grid?.minRounds, 4);
  });

  test("a continuing league's earliest draft is a rookie draft, not a startup", () => {
    // Sleeper spells "no previous season" three ways; a real id is none of
    // them, so nothing here is excluded as a startup.
    const grid = dynastyPickGrid(
      "2026",
      [
        draft("d25", "2025", "complete", 1_745_000_000_000, 3),
        draft("d26", "2026", "complete", 1_777_000_000_000, 4),
      ],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
    // Depth comes from the most recent rookie draft, not the oldest.
    assert.equal(grid?.minRounds, 4);
  });

  test("'0' and '' read as inaugural, like null", () => {
    for (const previous of [null, "", "0"]) {
      const grid = dynastyPickGrid(
        "2026",
        [draft("startup", "2026", "complete", 1_750_000_000_000, 25)],
        previous,
      );
      assert.deepEqual(
        grid?.seasons,
        ["2026", "2027", "2028"],
        `previous_league_id ${JSON.stringify(previous)}`,
      );
    }
  });

  test("depth is unknown rather than zero when Sleeper sent no round count", () => {
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "complete", 1_777_000_000_000, null)],
      "prev-league",
    );
    assert.equal(grid?.minRounds, null);
  });

  test("the league's own draft_rounds setting is carried as the exact depth", () => {
    // The measured five-round draft is history; the setting is what next May's
    // draft will be created from.
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "complete", 1_777_000_000_000, 5)],
      "prev-league",
      3,
    );
    assert.equal(grid?.rounds, 3);
    assert.equal(grid?.minRounds, 5);
  });

  test("a junk zero from settings reads as no exact depth, not zero rounds", () => {
    const grid = dynastyPickGrid("2026", [], "prev-league", 0);
    assert.equal(grid?.rounds, null);
  });

  test("a season that isn't a year has no window", () => {
    assert.equal(dynastyPickGrid("", [], "prev-league"), null);
    assert.equal(dynastyPickGrid("nfl", [], "prev-league"), null);
  });
});

describe("snakePickInRound", () => {
  test("even rounds flip around the board's width, odd rounds run forward", () => {
    assert.equal(snakePickInRound(5, 1, 12, null), 5);
    assert.equal(snakePickInRound(5, 2, 12, null), 8);
    assert.equal(snakePickInRound(5, 3, 12, null), 5);
    // Sleeper spells "no reversal" as 0.
    assert.equal(snakePickInRound(5, 2, 12, 0), 8);
  });

  test("third-round reversal repeats round 2 before alternation resumes", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((round) => snakePickInRound(5, round, 12, 3)),
      [5, 8, 8, 5, 8],
    );
  });

  test("a slot off the board names nothing", () => {
    assert.equal(snakePickInRound(13, 2, 12, null), null);
  });
});

describe("leagueRosterPicks", () => {
  const orderedDraft = (
    season: string,
    draft_order: Record<string, unknown> | null,
    overrides: Partial<LeagueDraftRow> = {},
  ): LeagueDraftRow => ({
    draft_id: `d${season}`,
    season,
    status: "pre_draft",
    type: "linear",
    start_time: 1_777_000_000_000,
    rounds: null,
    teams: null,
    reversal_round: null,
    draft_order,
    ...overrides,
  });

  /** A two-roster keeper league, so the grid derives from the trades alone. */
  const base = (overrides: Partial<PickLeague> = {}): PickLeague => ({
    league_type: 1,
    draft_rounds: null,
    previous_league_id: "prev",
    traded_picks: [],
    drafts: [],
    users: [
      { user_id: "me", display_name: "Me", team_name: null },
      { user_id: "t2", display_name: "Slim", team_name: null },
    ],
    rosters: [
      { roster_id: 1, owner_id: "me" },
      { roster_id: 2, owner_id: "t2" },
    ],
    ...overrides,
  });

  /** Roster 1's picks — the perspective most tests read the league from. */
  const rosterOne = (league: PickLeague, season: string) =>
    leagueRosterPicks(league, season).get(1) ?? [];

  test("an own pick has no origin; an acquired one names its original owner", () => {
    const league = base({ traded_picks: [pick("2027", 1, 2, 1)] });
    const picks = rosterOne(league, "2026");

    assert.deepEqual(picks, [
      { season: "2027", round: 1, slot: null, from: null, value: null },
      { season: "2027", round: 1, slot: null, from: "Slim", value: null },
    ]);
  });

  test("the origin is relative to each portfolio, off one shared grid", () => {
    // Rosters swap picks across rounds: each portfolio must read its own
    // acquisition as "from" the other and its kept pick as origin-less.
    const league = base({
      traded_picks: [pick("2027", 1, 2, 1), pick("2027", 2, 1, 2)],
    });
    const byRoster = leagueRosterPicks(league, "2026");

    assert.deepEqual(byRoster.get(1), [
      { season: "2027", round: 1, slot: null, from: null, value: null },
      { season: "2027", round: 1, slot: null, from: "Slim", value: null },
    ]);
    assert.deepEqual(byRoster.get(2), [
      { season: "2027", round: 2, slot: null, from: null, value: null },
      { season: "2027", round: 2, slot: null, from: "Me", value: null },
    ]);
  });

  test("a set draft order names the slot, through the original roster's owner", () => {
    // Roster 2 (Slim) picks first, so the pick acquired FROM roster 2 is 1.01
    // and the manager's own is 1.02 — the slot follows the origin, not the
    // holder.
    const league = base({
      traded_picks: [pick("2026", 1, 2, 1)],
      drafts: [orderedDraft("2026", { me: 2, t2: 1 })],
    });
    const picks = rosterOne(league, "2026");

    assert.deepEqual(picks, [
      { season: "2026", round: 1, slot: 2, from: null, value: null },
      { season: "2026", round: 1, slot: 1, from: "Slim", value: null },
    ]);
  });

  test("a snake draft flips the board on even rounds", () => {
    // Slot 1 of 2 picks first in round 1 and last in round 2 — and the second
    // acquired from slot 2 comes right back around at 2.01.
    const league = base({
      traded_picks: [pick("2026", 2, 2, 1)],
      drafts: [
        orderedDraft("2026", { me: 1, t2: 2 }, { type: "snake", teams: 2 }),
      ],
    });
    assert.deepEqual(
      rosterOne(league, "2026").map((p) => `${p.round}.${p.slot}`),
      ["1.1", "2.2", "2.1"],
    );
  });

  test("a snake board's width falls back to the order blob, departed users included", () => {
    // No settings.teams, and slot 3's user holds no roster any more — the raw
    // order still proves the board is three wide, so round 2 flips around 3.
    const league = base({
      traded_picks: [pick("2026", 2, 2, 1)],
      drafts: [
        orderedDraft("2026", { me: 1, t2: 2, gone: 3 }, { type: "snake" }),
      ],
    });
    assert.deepEqual(
      rosterOne(league, "2026").map((p) => p.slot),
      [1, 3, 2],
    );
  });

  test("an unordered or absent draft leaves the slot null", () => {
    const league = base({
      traded_picks: [pick("2026", 1, 2, 1), pick("2027", 1, 2, 1)],
      drafts: [orderedDraft("2026", null)],
    });
    const picks = rosterOne(league, "2026");

    // 2026's draft exists but has no order; 2027's doesn't exist at all.
    assert.deepEqual(
      picks.map((p) => p.slot),
      [null, null, null, null],
    );
  });

  test("an auction's order is nomination order, not a slot", () => {
    const league = base({
      traded_picks: [pick("2026", 1, 2, 1)],
      drafts: [orderedDraft("2026", { me: 1, t2: 2 }, { type: "auction" })],
    });
    assert.deepEqual(
      rosterOne(league, "2026").map((p) => p.slot),
      [null, null],
    );
  });

  test("the season's latest draft wins, chosen before its order is read", () => {
    // An inaugural league: the ordered startup ran first, the rookie draft is
    // later and unordered. Its picks must not borrow the startup's slots.
    const league = base({
      previous_league_id: null,
      traded_picks: [pick("2026", 1, 2, 1)],
      drafts: [
        orderedDraft("2026", { me: 1, t2: 2 }, {
          draft_id: "startup",
          start_time: 1_750_000_000_000,
        }),
        orderedDraft("2026", null, {
          draft_id: "rookie",
          start_time: 1_777_000_000_000,
        }),
      ],
    });
    assert.deepEqual(
      rosterOne(league, "2026").map((p) => p.slot),
      [null, null],
    );
  });

  test("an orphan origin falls back to its roster number, with no slot", () => {
    const league = base({
      traded_picks: [pick("2026", 1, 3, 1)],
      drafts: [orderedDraft("2026", { me: 1, t2: 2 })],
      rosters: [
        { roster_id: 1, owner_id: "me" },
        { roster_id: 2, owner_id: "t2" },
        { roster_id: 3, owner_id: null },
      ],
    });
    const acquired = rosterOne(league, "2026").at(-1);

    assert.deepEqual(acquired, {
      season: "2026",
      round: 1,
      slot: null,
      from: "Roster 3",
      value: null,
    });
  });

  test("a dynasty league lays out its horizon with nothing traded", () => {
    const league = base({
      league_type: DYNASTY_LEAGUE_TYPE,
      drafts: [
        orderedDraft("2026", null, {
          draft_id: "rookie26",
          status: "complete",
          rounds: 2,
        }),
      ],
    });
    const picks = rosterOne(league, "2026");

    // The 2026 class is taken, so the window is 2027-2029, two rounds deep.
    assert.deepEqual(
      picks.map((p) => `${p.season} R${p.round}`),
      ["2027 R1", "2027 R2", "2028 R1", "2028 R2", "2029 R1", "2029 R2"],
    );
    assert.ok(picks.every((p) => p.from === null && p.slot === null));
  });

  test("a dynasty league's depth is its draft_rounds setting, exactly", () => {
    // Settings say two rounds. The stale rookie draft measured five, and a
    // traded 2027 third would otherwise prove a third round — both lose.
    const league = base({
      league_type: DYNASTY_LEAGUE_TYPE,
      draft_rounds: 2,
      traded_picks: [pick("2027", 3, 2, 1)],
      drafts: [
        orderedDraft("2026", null, {
          draft_id: "rookie26",
          status: "complete",
          rounds: 5,
        }),
      ],
    });
    const picks = rosterOne(league, "2026");

    assert.deepEqual(
      picks.map((p) => `${p.season} R${p.round}`),
      ["2027 R1", "2027 R2", "2028 R1", "2028 R2", "2029 R1", "2029 R2"],
    );
  });

  test("a redraft league with no pick trades owns no pick assets", () => {
    assert.equal(leagueRosterPicks(base(), "2026").size, 0);
  });

  test("a roster that owns nothing is absent, not present-and-empty", () => {
    // Roster 2's only pick in the derived grid was dealt to roster 1.
    const league = base({ traded_picks: [pick("2026", 1, 2, 1)] });
    const byRoster = leagueRosterPicks(league, "2026");

    assert.equal(byRoster.has(2), false);
    assert.equal(byRoster.get(1)?.length, 2);
  });
});

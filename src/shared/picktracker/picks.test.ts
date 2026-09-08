import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  draftTeamCount,
  findPlaceholderDraft,
  leagueTeamCount,
  nextPickLabel,
  pickLabel,
  placeholderPicks,
  placeholderRounds,
} from "./picks.ts";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
} from "@/shared/sleeper";

const draft = (overrides: Partial<SleeperDraft> = {}): SleeperDraft => ({
  draft_id: "d1",
  league_id: "l1",
  season: "2026",
  status: "drafting",
  type: "snake",
  start_time: null,
  last_picked: null,
  draft_order: null,
  settings: { teams: 12, slots_k: 1 },
  metadata: null,
  ...overrides,
});

const kicker = (
  pickNo: number,
  overrides: Partial<SleeperDraftPick> = {},
): SleeperDraftPick => ({
  draft_id: "d1",
  pick_no: pickNo,
  round: Math.ceil(pickNo / 12),
  roster_id: 1,
  player_id: `k${pickNo}`,
  picked_by: "u1",
  metadata: { position: "K", first_name: "Justin", last_name: "Tucker" },
  ...overrides,
});

const users: SleeperLeagueUser[] = [
  {
    user_id: "u1",
    display_name: "alice",
    avatar: "abc",
    is_owner: true,
    is_bot: false,
    league_id: "l1",
    metadata: null,
  },
];

describe("findPlaceholderDraft", () => {
  test("picks the first draft with a kicker slot", () => {
    const noKicker = draft({ draft_id: "d0", settings: { teams: 12 } });
    const withKicker = draft({ draft_id: "d2" });
    assert.equal(findPlaceholderDraft([noKicker, withKicker]), withKicker);
  });

  test("survives null and junk settings", () => {
    const junk = draft({ settings: { slots_k: "1" as unknown as number } });
    assert.equal(findPlaceholderDraft([draft({ settings: null }), junk]), null);
  });
});

describe("draftTeamCount", () => {
  test("prefers settings.teams", () => {
    const d = draft({ draft_order: { u1: 1, u2: 2 } });
    assert.equal(draftTeamCount(d), 12);
  });

  test("falls back to draft_order, then zero", () => {
    assert.equal(
      draftTeamCount(draft({ settings: null, draft_order: { u1: 1, u2: 2 } })),
      2,
    );
    assert.equal(draftTeamCount(draft({ settings: null })), 0);
  });
});

describe("pickLabel", () => {
  test("labels round.slot with a padded slot", () => {
    assert.equal(pickLabel(0, 12), "1.01");
    assert.equal(pickLabel(4, 12), "1.05");
    assert.equal(pickLabel(11, 12), "1.12");
    assert.equal(pickLabel(12, 12), "2.01");
  });
});

describe("placeholderPicks", () => {
  test("numbers by place in the kicker sequence, not the startup slot", () => {
    // Kickers went at startup picks 7, 20 and 31 of a 12-teamer; as
    // placeholders they are rookie picks 1.01, 1.02 and 1.03.
    const picks = [kicker(7), kicker(20), kicker(31)];
    const result = placeholderPicks(picks, users, 12);
    assert.deepEqual(
      result.map((p) => p.pick),
      ["1.01", "1.02", "1.03"],
    );
  });

  test("sorts by pick_no before numbering", () => {
    const result = placeholderPicks([kicker(20), kicker(7)], users, 12);
    assert.deepEqual(
      result.map((p) => p.player_id),
      ["k7", "k20"],
    );
  });

  test("ignores every other position", () => {
    const rb = kicker(1, {
      metadata: { position: "RB", first_name: "Bijan", last_name: "Robinson" },
    });
    assert.equal(placeholderPicks([rb, kicker(2)], users, 12).length, 1);
  });

  test("rolls into later rounds by team count", () => {
    const picks = [1, 2, 3].map((n) => kicker(n));
    assert.deepEqual(
      placeholderPicks(picks, users, 2).map((p) => p.pick),
      ["1.01", "1.02", "2.01"],
    );
  });

  test("resolves the picking manager, and leaves autopicks null", () => {
    const auto = kicker(2, { picked_by: "" });
    const unknown = kicker(3, { picked_by: "ghost" });
    const [manual, autoPick, unknownPick] = placeholderPicks(
      [kicker(1), auto, unknown],
      users,
      12,
    );
    assert.equal(manual.picked_by?.display_name, "alice");
    assert.equal(autoPick.picked_by, null);
    assert.equal(unknownPick.picked_by, null);
  });

  test("falls back to the player id when metadata has no name", () => {
    const nameless = kicker(1, { metadata: { position: "K" } });
    assert.equal(placeholderPicks([nameless], users, 12)[0].player_name, "k1");
  });
});

describe("nextPickLabel", () => {
  test("names the slot after the picks already made", () => {
    assert.equal(nextPickLabel(draft(), 13, 12), "2.02");
  });

  test("is null once the draft is complete", () => {
    assert.equal(nextPickLabel(draft({ status: "complete" }), 24, 12), null);
  });
});

/**
 * The two readings the Open Graph card states, which the card's own module
 * cannot be tested through: it imports the Sleeper client for `sleeperAvatarUrl`
 * and so does not resolve under Node's runner. Both are silent when wrong — the
 * card renders, the numbers look plausible, and only somebody who knows the
 * draft can tell.
 */
const league = (overrides: Partial<SleeperLeague> = {}): SleeperLeague => ({
  league_id: "l1",
  name: "Dynasty Warehouse",
  season: "2025",
  sport: "nfl",
  status: "in_season",
  total_rosters: 12,
  avatar: "abc123",
  previous_league_id: null,
  draft_id: "d1",
  roster_positions: null,
  settings: null,
  scoring_settings: null,
  metadata: null,
  ...overrides,
});

describe("leagueTeamCount", () => {
  test("takes the draft's own team count", () => {
    assert.equal(leagueTeamCount(draft({ settings: { teams: 10 } }), league()), 10);
  });

  test("falls back to the league's rosters, never to the draft order", () => {
    // The trap `draftTeamCount` documents: two managers have claimed a slot in
    // a twelve-team league, and twelve is what a card describing the league
    // has to say.
    const pre = draft({ settings: { slots_k: 3 }, draft_order: { u1: 1, u2: 2 } });
    assert.equal(draftTeamCount(pre), 2);
    assert.equal(leagueTeamCount(pre, league()), 12);
  });
});

describe("placeholderRounds", () => {
  test("counts kicker slots, not the startup draft's own rounds", () => {
    // A 22-round startup standing in for a 3-round rookie draft. Reading
    // `settings.rounds` here would put "22 rounds" on a card headed "rookie
    // pick tracker".
    const startup = draft({ settings: { teams: 12, slots_k: 3, rounds: 22 } });
    assert.equal(placeholderRounds(startup), 3);
  });

  test("is positive for any draft findPlaceholderDraft returned", () => {
    const found = findPlaceholderDraft([draft({ settings: { teams: 12, rounds: 22 } }), draft()]);
    assert.ok(found);
    assert.ok(placeholderRounds(found) > 0);
  });

  test("is zero where the setting is absent or not a number", () => {
    assert.equal(placeholderRounds(draft({ settings: null })), 0);
    assert.equal(placeholderRounds(draft({ settings: { slots_k: "3" } })), 0);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  draftTeamCount,
  findPlaceholderDraft,
  nextPickLabel,
  pickLabel,
  placeholderPicks,
} from "./picks.ts";
import type {
  SleeperDraft,
  SleeperDraftPick,
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

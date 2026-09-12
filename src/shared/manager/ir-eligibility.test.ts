import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  IR_TOGGLES,
  irAllowedStatuses,
  irEligible,
  irReading,
} from "./ir-eligibility.ts";
import type { PlayerStatusMap, RosterIds } from "./ir-eligibility.ts";

const OPEN_ONLY = { reserve_allow_out: 1 };

function ids(over: Partial<RosterIds> = {}): RosterIds {
  return {
    held: ["qb", "rb", "wr", "bench", "stash", "hurt", "taxied"],
    reserve: ["hurt"],
    taxi: ["taxied"],
    ...over,
  };
}

function statuses(over: PlayerStatusMap = {}): PlayerStatusMap {
  return {
    qb: { name: "Quarter Back", injury_status: null },
    rb: { name: "Running Back", injury_status: "Questionable" },
    wr: { name: "Wide Out", injury_status: null },
    bench: { name: "Bench Guy", injury_status: null },
    stash: { name: "Stash Able", injury_status: "Out" },
    hurt: { name: "Long Term", injury_status: "IR" },
    taxied: { name: "Taxi Rookie", injury_status: "Out" },
    ...over,
  };
}

const NO_BOARD = {};
const NO_LOCKS = new Set<string>();

describe("irAllowedStatuses", () => {
  test("no settings is no rule", () => {
    assert.equal(irAllowedStatuses(null), null);
  });

  test("a league with no toggles admits IR and PUP alone", () => {
    assert.deepEqual([...irAllowedStatuses({})!].sort(), ["IR", "PUP"]);
  });

  test("a toggle is on at 1 or a digit string, and off at anything else", () => {
    assert.ok(irAllowedStatuses({ reserve_allow_out: 1 })!.has("Out"));
    assert.ok(irAllowedStatuses({ reserve_allow_out: "1" })!.has("Out"));
    for (const raw of [0, "0", true, "yes", null, undefined, 2]) {
      assert.ok(
        !irAllowedStatuses({ reserve_allow_out: raw })!.has("Out"),
        `${String(raw)} must not admit Out`,
      );
    }
  });

  test("each of the six toggles admits exactly its own designation", () => {
    for (const { key, status } of IR_TOGGLES) {
      const allowed = irAllowedStatuses({ [key]: 1 })!;
      assert.deepEqual([...allowed].sort(), ["IR", "PUP", status].sort());
    }
  });
});

describe("irEligible", () => {
  const strict = irAllowedStatuses({})!;
  const everything = irAllowedStatuses(
    Object.fromEntries(IR_TOGGLES.map((toggle) => [toggle.key, 1])),
  )!;

  test("healthy is not eligible — a fit player on IR is the case to catch", () => {
    assert.equal(irEligible(null, strict), false);
    assert.equal(irEligible("", strict), false);
  });

  test("IR and PUP are eligible whatever the toggles say", () => {
    assert.equal(irEligible("IR", strict), true);
    assert.equal(irEligible("PUP", strict), true);
  });

  test("Questionable is never eligible, even with every toggle on", () => {
    assert.equal(irEligible("Questionable", everything), false);
  });

  test("a toggled designation is gated by its toggle", () => {
    for (const { key, status } of IR_TOGGLES) {
      assert.equal(irEligible(status, strict), false, `${status} off`);
      assert.equal(irEligible(status, irAllowedStatuses({ [key]: 1 })!), true, `${status} on`);
    }
  });

  test("a designation this build does not know is no claim either way", () => {
    assert.equal(irEligible("Emergency", everything), null);
    // Exact match: a case variant is a spelling, not a verdict.
    assert.equal(irEligible("out", everything), null);
  });
});

describe("irReading", () => {
  test("no settings is no reading", () => {
    assert.equal(irReading(ids(), null, statuses(), NO_BOARD, NO_LOCKS), null);
  });

  test("a failed status read is no reading", () => {
    assert.equal(irReading(ids(), OPEN_ONLY, null, NO_BOARD, NO_LOCKS), null);
  });

  test("a healthy player on IR is judged ineligible and named", () => {
    const reading = irReading(
      ids({ reserve: ["bench"] }),
      OPEN_ONLY,
      statuses(),
      NO_BOARD,
      NO_LOCKS,
    )!;
    assert.deepEqual(reading.reserve, [
      { player_id: "bench", name: "Bench Guy", status: null, eligible: false, locked: false },
    ]);
  });

  test("an eligible player on IR may stay", () => {
    const reading = irReading(ids(), OPEN_ONLY, statuses(), NO_BOARD, NO_LOCKS)!;
    assert.equal(reading.reserve[0].eligible, true);
    assert.equal(reading.reserve[0].status, "IR");
  });

  test("stashable is the active roster the league admits — never taxi, never IR", () => {
    const reading = irReading(ids(), OPEN_ONLY, statuses(), NO_BOARD, NO_LOCKS)!;
    assert.deepEqual(
      reading.stashable.map((player) => player.player_id),
      ["stash"],
    );
    // The same roster with the toggle off has nobody to stash: `Out` is the
    // only designation on it that a toggle decides.
    assert.deepEqual(irReading(ids(), {}, statuses(), NO_BOARD, NO_LOCKS)!.stashable, []);
  });

  test("a player on both reserve and taxi is an IR player and not a stash", () => {
    const reading = irReading(
      ids({ reserve: ["taxied"], taxi: ["taxied"] }),
      OPEN_ONLY,
      statuses(),
      NO_BOARD,
      NO_LOCKS,
    )!;
    assert.deepEqual(
      reading.reserve.map((player) => player.player_id),
      ["taxied"],
    );
    assert.ok(!reading.stashable.some((player) => player.player_id === "taxied"));
  });

  test("an id the map has no row for is unknown, not healthy", () => {
    const reading = irReading(
      ids({ reserve: ["ghost"] }),
      OPEN_ONLY,
      statuses(),
      NO_BOARD,
      NO_LOCKS,
    )!;
    assert.deepEqual(reading.reserve, [
      { player_id: "ghost", name: null, status: null, eligible: null, locked: false },
    ]);
    assert.equal(reading.unknown, 1);
  });

  test("an unrecognised designation on the active roster is unknown and not stashable", () => {
    const reading = irReading(
      ids(),
      OPEN_ONLY,
      statuses({ bench: { name: "Bench Guy", injury_status: "Emergency" } }),
      NO_BOARD,
      NO_LOCKS,
    )!;
    assert.ok(!reading.stashable.some((player) => player.player_id === "bench"));
    assert.equal(reading.unknown, 1);
  });

  test("names come off the board first, then the map, then nothing — never the id", () => {
    const reading = irReading(
      ids({ reserve: ["hurt", "ghost"] }),
      OPEN_ONLY,
      statuses(),
      { hurt: { name: "BOARD NAME" } },
      NO_LOCKS,
    )!;
    assert.equal(reading.reserve[0].name, "BOARD NAME");
    assert.equal(reading.reserve[1].name, null);
  });

  test("an empty map is every player unknown, and still a reading", () => {
    const reading = irReading(ids(), OPEN_ONLY, {}, NO_BOARD, NO_LOCKS)!;
    assert.notEqual(reading, null);
    assert.equal(reading.unknown, ids().held.length - ids().taxi.length);
    assert.deepEqual(reading.stashable, []);
  });

  test("the lock rides the player and narrows nothing here", () => {
    // A locked candidate is still on the list with his designation — the
    // client's `irMoves` is what leaves him out of the stash — so the fact and
    // the rule that reads it stay in two places that cannot silently agree.
    const reading = irReading(ids(), OPEN_ONLY, statuses(), NO_BOARD, new Set(["stash"]))!;
    assert.deepEqual(
      reading.stashable.map((player) => [player.player_id, player.locked]),
      [["stash", true]],
    );
  });

  test("the reserve list keeps Sleeper's own order", () => {
    const reading = irReading(
      ids({ reserve: ["hurt", "stash", "bench"] }),
      OPEN_ONLY,
      statuses(),
      NO_BOARD,
      NO_LOCKS,
    )!;
    assert.deepEqual(
      reading.reserve.map((player) => player.player_id),
      ["hurt", "stash", "bench"],
    );
  });
});

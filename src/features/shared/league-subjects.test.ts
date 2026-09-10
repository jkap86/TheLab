import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canonicalReadings,
  clearSubjectReadings,
  leaguematePlayerId,
  matchesSubjects,
  NO_SUBJECTS,
  parseLeaguematePlayerId,
  pickedSubject,
  removeSubject,
  setSubjectMode,
  subjectKey,
  subjectSlot,
  toggleSubject,
  toggleSubjectReading,
  type LeagueSubjects,
  type Subject,
  type SubjectRolls,
  type WeekReading,
} from "./league-subjects.ts";

const ROSTERS = { a: ["p1", "p2"], b: ["p1"], c: [] as string[] };
const MEMBERS = { a: ["me", "u1"], b: ["me"], c: ["me", "u1"] };

/** The two maps a manager page answers with, behind the resolver. */
const rolls =
  (
    rosters: Record<string, readonly string[]> | null,
    members: Record<string, readonly string[]> | null,
  ): SubjectRolls =>
  (kind) =>
    kind === "player" ? rosters : members;

const BOTH = rolls(ROSTERS, MEMBERS);

function picked(
  ids: Subject[],
  match: "all" | "any" = "all",
): LeagueSubjects {
  return { subjects: ids, match };
}

describe("toggleSubject", () => {
  test("adds, then removes the same subject", () => {
    const one = toggleSubject(NO_SUBJECTS, { kind: "player", id: "p1" });
    assert.equal(one.subjects.length, 1);
    const none = toggleSubject(one, { kind: "player", id: "p1" });
    assert.deepEqual(none.subjects, []);
  });

  test("a player and a leaguemate sharing an id are two subjects", () => {
    const state = toggleSubject(
      toggleSubject(NO_SUBJECTS, { kind: "player", id: "x" }),
      { kind: "leaguemate", id: "x" },
    );
    assert.equal(state.subjects.length, 2);
    assert.notEqual(
      subjectKey({ kind: "player", id: "x" }),
      subjectKey({ kind: "leaguemate", id: "x" }),
    );
  });

  test("the match mode survives a toggle", () => {
    const state = toggleSubject(picked([], "any"), { kind: "player", id: "p1" });
    assert.equal(state.match, "any");
  });

  test("removeSubject drops without adding back", () => {
    const state = removeSubject(
      picked([{ kind: "player", id: "p1" }]),
      { kind: "player", id: "p1" },
    );
    assert.deepEqual(state.subjects, []);
    // Removing something that was never there is a no-op, not an add.
    assert.deepEqual(removeSubject(state, { kind: "player", id: "p1" }).subjects, []);
  });
});

describe("matchesSubjects", () => {
  test("an empty selection is not a narrowing", () => {
    for (const id of ["a", "b", "c"]) {
      assert.equal(matchesSubjects(id, NO_SUBJECTS, BOTH), true);
    }
  });

  test("all requires every subject; any requires one", () => {
    const both = [
      { kind: "player" as const, id: "p1" },
      { kind: "player" as const, id: "p2" },
    ];
    assert.equal(matchesSubjects("a", picked(both, "all"), BOTH), true);
    assert.equal(matchesSubjects("b", picked(both, "all"), BOTH), false);
    assert.equal(matchesSubjects("b", picked(both, "any"), BOTH), true);
    assert.equal(matchesSubjects("c", picked(both, "any"), BOTH), false);
  });

  test("players and leaguemates combine in one selection", () => {
    const mixed = [
      { kind: "player" as const, id: "p1" },
      { kind: "leaguemate" as const, id: "u1" },
    ];
    // a holds both; b holds the player but not the person.
    assert.equal(matchesSubjects("a", picked(mixed, "all"), BOTH), true);
    assert.equal(matchesSubjects("b", picked(mixed, "all"), BOTH), false);
    assert.equal(matchesSubjects("b", picked(mixed, "any"), BOTH), true);
  });

  test("a league missing from a map that IS loaded does not match", () => {
    // The map can answer: it has no row for this league, so the league does not
    // hold them. This is the case that must not be confused with the next one.
    assert.equal(
      matchesSubjects("zz", picked([{ kind: "player", id: "p1" }]), BOTH),
      false,
    );
  });

  test("a subject whose map has not arrived is ignored, not failed", () => {
    // Failing it closed empties the grid while a payload is in flight; failing
    // it open would leave a lit token above a list it did not narrow.
    assert.equal(
      matchesSubjects("a", picked([{ kind: "player", id: "p1" }]), rolls(null, MEMBERS)),
      true,
    );
    // The answerable half still narrows: the player is ignored, the person is not.
    const mixed = picked([
      { kind: "player", id: "p1" },
      { kind: "leaguemate", id: "u1" },
    ]);
    assert.equal(matchesSubjects("a", mixed, rolls(null, MEMBERS)), true);
    assert.equal(matchesSubjects("b", mixed, rolls(null, MEMBERS)), false);
  });

  test("an empty roster holds nobody", () => {
    assert.equal(
      matchesSubjects("c", picked([{ kind: "player", id: "p1" }]), BOTH),
      false,
    );
  });
});

/**
 * The three player modes, the composite id, and the two identities.
 *
 * Every rule below renders a perfectly ordinary board while being wrong, which
 * is why they are pinned here rather than left to a render: a mode read off the
 * wrong map narrows to the wrong leagues under a token that names the right
 * one, and a league nobody has stored reading as *available* is a claim made
 * out of an absence.
 */

/** Every roster in the league, and every roster that is not the manager's. */
const EVERYONE = { a: ["p1", "p2", "p9"], b: ["p1"] };
const OTHERS = { a: ["p9"], b: ["p1"] };

const modal =
  (): SubjectRolls =>
  (kind, mode) => {
    if (kind !== "player") return null;
    if (mode === "taken") return OTHERS;
    if (mode === "available") return EVERYONE;
    return ROSTERS;
  };

describe("subject identity", () => {
  test("the slot ignores the mode and the key does not", () => {
    const owned = { kind: "player" as const, id: "p1" };
    const taken = { kind: "player" as const, id: "p1", mode: "taken" as const };
    assert.equal(subjectSlot(owned), subjectSlot(taken));
    assert.notEqual(subjectKey(owned), subjectKey(taken));
  });

  test("absent and `owned` are one narrowing, so one key", () => {
    assert.equal(
      subjectKey({ kind: "player", id: "p1" }),
      subjectKey({ kind: "player", id: "p1", mode: "owned" }),
    );
  });

  test("a press clears the row whatever mode it is on", () => {
    // The bug this exists for: toggling on the key would miss the moded
    // subject and add a second pick for the same row.
    const state = picked([{ kind: "player", id: "p1" }]);
    const moded = setSubjectMode(state, "player", "p1", "taken");
    assert.equal(moded.subjects[0]?.mode, "taken");
    assert.deepEqual(
      toggleSubject(moded, { kind: "player", id: "p1" }).subjects,
      [],
    );
  });

  test("setSubjectMode moves the pick in place and leaves the rest", () => {
    const state = picked([
      { kind: "player", id: "p1" },
      { kind: "player", id: "p2" },
    ]);
    const next = setSubjectMode(state, "player", "p1", "available");
    assert.deepEqual(
      next.subjects.map((s) => [s.id, s.mode]),
      [
        ["p1", "available"],
        ["p2", undefined],
      ],
    );
  });

  test("setSubjectMode on an unpicked row changes nothing", () => {
    const state = picked([{ kind: "player", id: "p1" }]);
    assert.deepEqual(setSubjectMode(state, "player", "zz", "taken"), state);
  });

  test("pickedSubject finds the row whatever mode it carries", () => {
    const state = setSubjectMode(
      picked([{ kind: "player", id: "p1" }]),
      "player",
      "p1",
      "taken",
    );
    assert.equal(pickedSubject(state, "player", "p1")?.mode, "taken");
    assert.equal(pickedSubject(state, "player", "p2"), undefined);
    // A user and a player could share an id — the kind is what tells them apart.
    assert.equal(pickedSubject(state, "leaguemate", "p1"), undefined);
  });
});

describe("player modes", () => {
  test("owned reads the manager's own rosters, as it always did", () => {
    const one = picked([{ kind: "player", id: "p1", mode: "owned" }]);
    assert.equal(matchesSubjects("a", one, modal()), true);
    assert.equal(matchesSubjects("b", one, modal()), true);
    assert.equal(matchesSubjects("c", one, modal()), false);
  });

  test("taken reads somebody else's roster, never the manager's", () => {
    const one = picked([{ kind: "player", id: "p1", mode: "taken" }]);
    // `a` is the manager's own — held, but not *taken*.
    assert.equal(matchesSubjects("a", one, modal()), false);
    assert.equal(matchesSubjects("b", one, modal()), true);
  });

  test("available is the inversion, and only where a roster was stored", () => {
    const one = picked([{ kind: "player", id: "p2", mode: "available" }]);
    // `a` names him, so he is not free there.
    assert.equal(matchesSubjects("a", one, modal()), false);
    // `b` has stored rosters and none of them names him.
    assert.equal(matchesSubjects("b", one, modal()), true);
    // **`z` has no stored rosters at all.** Read as a match it would sweep
    // every unsynced league into the answer.
    assert.equal(matchesSubjects("z", one, modal()), false);
  });

  test("a blank id never matches, `available` included", () => {
    const blank = picked([{ kind: "player", id: "", mode: "available" }]);
    assert.equal(matchesSubjects("a", blank, modal()), false);
  });

  test("two picks can sit on two modes", () => {
    const both = picked(
      [
        { kind: "player", id: "p1", mode: "owned" },
        { kind: "player", id: "p9", mode: "taken" },
      ],
      "all",
    );
    // `a`: the manager holds p1 and somebody else holds p9.
    assert.equal(matchesSubjects("a", both, modal()), true);
    // `b`: the manager holds p1, but nobody else holds p9.
    assert.equal(matchesSubjects("b", both, modal()), false);
  });

  test("a mode whose map has not arrived is ignored, not failed", () => {
    const rolls: SubjectRolls = (kind, mode) =>
      kind === "player" && mode === "owned" ? ROSTERS : null;
    const one = picked([{ kind: "player", id: "p1", mode: "taken" }]);
    assert.equal(matchesSubjects("c", one, rolls), true);
  });
});

describe("leaguematePlayerId", () => {
  test("round-trips a pair", () => {
    const id = leaguematePlayerId("u1", "p1");
    assert.deepEqual(parseLeaguematePlayerId(id), {
      userId: "u1",
      playerId: "p1",
    });
  });

  test("splits on the first separator, so a team code survives", () => {
    assert.deepEqual(parseLeaguematePlayerId("u1:PHI"), {
      userId: "u1",
      playerId: "PHI",
    });
  });

  test("a half of a pair is not one", () => {
    for (const id of ["", "u1", ":p1", "u1:"]) {
      assert.equal(parseLeaguematePlayerId(id), null);
    }
  });

  test("a combo narrows on its own map, keyed by the pair", () => {
    const combos = { a: ["u1:p1"], b: [] as string[] };
    const rolls: SubjectRolls = (kind) =>
      kind === "leaguemate-player" ? combos : null;
    const one = picked([
      { kind: "leaguemate-player", id: leaguematePlayerId("u1", "p1") },
    ]);
    assert.equal(matchesSubjects("a", one, rolls), true);
    assert.equal(matchesSubjects("b", one, rolls), false);
  });
});

/**
 * The week row's four readings, and the one rule that is silent when it is
 * wrong: they are **unioned**, because every intersection of two of them is
 * empty by construction and a narrowing that could only ever empty the grid is
 * not one a reader could learn from.
 */
describe("a week row's readings", () => {
  // The four populations one league contributed: two rosters, split into who
  // each side started and who each side sat.
  const WEEK: Record<string, Record<string, string[]>> = {
    start: { a: ["p1"], b: ["p2"] },
    bench: { a: ["p2"], b: ["p1"] },
    "opp-start": { a: ["p3"], b: ["p1"] },
    "opp-bench": { a: ["p1"], b: ["p3"] },
    either: { a: ["p1", "p2", "p3"], b: ["p1", "p2", "p3"] },
  };
  const weekRolls: SubjectRolls = (kind, _mode, reading) =>
    kind === "week" ? (WEEK[reading ?? "either"] ?? null) : null;

  const week = (id: string, readings?: readonly WeekReading[]) =>
    picked([{ kind: "week" as const, id, ...(readings ? { readings } : {}) }]);

  test("no reading picked is the resting one: fielded either side", () => {
    // What pressing a row has always meant, and it must keep meaning it.
    assert.equal(matchesSubjects("a", week("p1"), weekRolls), true);
    assert.equal(matchesSubjects("a", week("p9"), weekRolls), false);
  });

  test("one reading reads that population alone", () => {
    assert.equal(matchesSubjects("a", week("p1", ["start"]), weekRolls), true);
    assert.equal(matchesSubjects("b", week("p1", ["start"]), weekRolls), false);
    assert.equal(matchesSubjects("b", week("p1", ["bench"]), weekRolls), true);
  });

  test("two readings are a union, and it is the only operator with anything to say", () => {
    // A player sits on one roster per league, so `start ∧ opp-start` is empty
    // in every league there is — an intersecting selection would empty the grid
    // whatever was picked.
    const both = week("p1", ["start", "opp-start"]);
    assert.equal(matchesSubjects("a", both, weekRolls), true);
    assert.equal(matchesSubjects("b", both, weekRolls), true);
    // And a union of two readings neither of which names him is still no.
    assert.equal(
      matchesSubjects("a", week("p2", ["opp-start", "opp-bench"]), weekRolls),
      false,
    );
  });

  test("a reading whose map has not arrived is skipped, not counted against the row", () => {
    // The three-state rule this module keeps one grain out, applied per
    // population: a half-answered narrowing answers on the half it has.
    const half: SubjectRolls = (kind, _mode, reading) =>
      kind === "week" && reading === "start" ? WEEK.start : null;
    assert.equal(matchesSubjects("a", week("p1", ["start", "opp-start"]), half), true);
    assert.equal(matchesSubjects("b", week("p1", ["start", "opp-start"]), half), false);
  });

  test("a row whose every reading is unanswerable is ignored, not failed", () => {
    // Failing it closed would empty the grid while a payload is in flight.
    const none: SubjectRolls = () => null;
    assert.equal(matchesSubjects("a", week("p1", ["start"]), none), true);
  });

  test("an empty reading list is the resting reading, not a narrowing that matches nothing", () => {
    assert.equal(matchesSubjects("a", week("p1", []), weekRolls), true);
  });
});

describe("canonicalReadings", () => {
  test("deduped, and in the vocabulary's order rather than the presses'", () => {
    // Which is what lets `subjectKey` compare two selections at all: a reader
    // who pressed Bench then Start has the same narrowing as one who did not.
    assert.deepEqual(
      canonicalReadings(["opp-bench", "start", "start"]),
      ["start", "opp-bench"],
    );
    assert.deepEqual(canonicalReadings(undefined), []);
    assert.deepEqual(canonicalReadings([]), []);
  });
});

describe("subjectKey and the readings", () => {
  test("two readings of one row are two narrowings and two keys", () => {
    const row = { kind: "week" as const, id: "p1" };
    assert.notEqual(
      subjectKey({ ...row, readings: ["start"] }),
      subjectKey({ ...row, readings: ["bench"] }),
    );
    // ...and the same two readings in either order are one.
    assert.equal(
      subjectKey({ ...row, readings: ["start", "opp-start"] }),
      subjectKey({ ...row, readings: ["opp-start", "start"] }),
    );
  });

  test("the resting reading keys as the bare slot, so nothing changed for it", () => {
    const row = { kind: "week" as const, id: "p1" };
    assert.equal(subjectKey(row), subjectSlot(row));
    assert.equal(subjectKey({ ...row, readings: [] }), subjectSlot(row));
  });

  test("the slot is the row whatever is picked inside it", () => {
    // Which is what lets a press on the row clear it however it is narrowed.
    const row: Subject = { kind: "week", id: "p1" };
    const narrowed: Subject = { ...row, readings: ["start", "opp-bench"] };
    assert.equal(subjectSlot(narrowed), subjectSlot(row));
  });
});

describe("toggleSubjectReading", () => {
  const state = picked([
    { kind: "week", id: "p1", readings: ["start"] },
    { kind: "week", id: "p2" },
  ]);

  test("adds a reading, and a second press takes it off", () => {
    const added = toggleSubjectReading(state, "week", "p1", "opp-start");
    assert.deepEqual(added.subjects[0].readings, ["start", "opp-start"]);
    const removed = toggleSubjectReading(added, "week", "p1", "start");
    assert.deepEqual(removed.subjects[0].readings, ["opp-start"]);
  });

  test("clearing the last reading leaves the row picked on its resting one", () => {
    // The row's own press is where a reader reaches to clear the row.
    const bare = toggleSubjectReading(state, "week", "p1", "start");
    assert.deepEqual(bare.subjects[0].readings, []);
    assert.equal(bare.subjects.length, 2);
  });

  test("in place, so refining a row does not send it to the end of the tray", () => {
    const moved = toggleSubjectReading(state, "week", "p1", "bench");
    assert.deepEqual(
      moved.subjects.map((s) => s.id),
      ["p1", "p2"],
    );
  });

  test("a row that is not picked is left alone", () => {
    assert.deepEqual(toggleSubjectReading(state, "week", "p9", "start"), state);
  });
});

describe("clearSubjectReadings", () => {
  test("drops the readings and keeps the row", () => {
    const state = picked([
      { kind: "week", id: "p1", readings: ["start", "opp-bench"] },
    ]);
    const cleared = clearSubjectReadings(state, "week", "p1");
    assert.deepEqual(cleared.subjects[0].readings, []);
    assert.equal(cleared.subjects.length, 1);
  });
});

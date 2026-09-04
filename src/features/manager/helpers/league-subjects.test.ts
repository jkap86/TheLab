import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  matchesSubjects,
  NO_SUBJECTS,
  removeSubject,
  subjectKey,
  toggleSubject,
  type LeagueSubjects,
} from "./league-subjects.ts";

const ROSTERS = { a: ["p1", "p2"], b: ["p1"], c: [] as string[] };
const MEMBERS = { a: ["me", "u1"], b: ["me"], c: ["me", "u1"] };

function picked(
  ids: { kind: "player" | "leaguemate"; id: string }[],
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
      assert.equal(matchesSubjects(id, NO_SUBJECTS, ROSTERS, MEMBERS), true);
    }
  });

  test("all requires every subject; any requires one", () => {
    const both = [
      { kind: "player" as const, id: "p1" },
      { kind: "player" as const, id: "p2" },
    ];
    assert.equal(matchesSubjects("a", picked(both, "all"), ROSTERS, MEMBERS), true);
    assert.equal(matchesSubjects("b", picked(both, "all"), ROSTERS, MEMBERS), false);
    assert.equal(matchesSubjects("b", picked(both, "any"), ROSTERS, MEMBERS), true);
    assert.equal(matchesSubjects("c", picked(both, "any"), ROSTERS, MEMBERS), false);
  });

  test("players and leaguemates combine in one selection", () => {
    const mixed = [
      { kind: "player" as const, id: "p1" },
      { kind: "leaguemate" as const, id: "u1" },
    ];
    // a holds both; b holds the player but not the person.
    assert.equal(matchesSubjects("a", picked(mixed, "all"), ROSTERS, MEMBERS), true);
    assert.equal(matchesSubjects("b", picked(mixed, "all"), ROSTERS, MEMBERS), false);
    assert.equal(matchesSubjects("b", picked(mixed, "any"), ROSTERS, MEMBERS), true);
  });

  test("a league missing from a map that IS loaded does not match", () => {
    // The map can answer: it has no row for this league, so the league does not
    // hold them. This is the case that must not be confused with the next one.
    assert.equal(
      matchesSubjects("zz", picked([{ kind: "player", id: "p1" }]), ROSTERS, MEMBERS),
      false,
    );
  });

  test("a subject whose map has not arrived is ignored, not failed", () => {
    // Failing it closed empties the grid while a payload is in flight; failing
    // it open would leave a lit token above a list it did not narrow.
    assert.equal(
      matchesSubjects("a", picked([{ kind: "player", id: "p1" }]), null, MEMBERS),
      true,
    );
    // The answerable half still narrows: the player is ignored, the person is not.
    const mixed = picked([
      { kind: "player", id: "p1" },
      { kind: "leaguemate", id: "u1" },
    ]);
    assert.equal(matchesSubjects("a", mixed, null, MEMBERS), true);
    assert.equal(matchesSubjects("b", mixed, null, MEMBERS), false);
  });

  test("an empty roster holds nobody", () => {
    assert.equal(
      matchesSubjects("c", picked([{ kind: "player", id: "p1" }]), ROSTERS, MEMBERS),
      false,
    );
  });
});

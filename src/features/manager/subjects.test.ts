import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SUBJECT_FILTERS,
  EMPTY_SUBJECT_INDEX,
  type SubjectFilters,
  type SubjectIndex,
  hasSubject,
  holdsSubject,
  matchesSubjects,
  removeSubjectAt,
  searchSubjects,
  subjectKey,
  subjectOptions,
  subjectSummary,
  toggleSubject,
} from "./subjects.ts";
import type { LeaguemateView, ManagerLeague, PlayerSummary } from "./types.ts";

const league = (league_id: string): ManagerLeague => ({
  league_id,
  name: `League ${league_id}`,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  roster_positions: null,
  scoring_settings: null,
});

const PLAYERS: Record<string, PlayerSummary> = {
  bijan: { player_id: "bijan", name: "Bijan Robinson", position: "RB", team: "ATL" },
  chase: { player_id: "chase", name: "Ja'Marr Chase", position: "WR", team: "CIN" },
  bowers: { player_id: "bowers", name: "Brock Bowers", position: "TE", team: "LV" },
};

const USERS: Record<string, LeaguemateView> = {
  me: { user_id: "me", display_name: "jkap86", avatar_url: null },
  dark: { user_id: "dark", display_name: "DarksideEmperors", avatar_url: null },
};

const player = (id: string) => ({ kind: "player" as const, id });
const mate = (id: string) => ({ kind: "leaguemate" as const, id });

/**
 * Three leagues: `a` holds both players, `b` holds only Bijan, `c` has never had
 * its rosters synced at all — which is the case the null exists for.
 */
const INDEX: SubjectIndex = {
  rosters: {
    a: ["bijan", "chase"],
    b: ["bijan"],
  },
  members: {
    a: ["me", "dark"],
    b: ["me"],
    c: ["me", "dark"],
  },
};

const filters = (over: Partial<SubjectFilters> = {}): SubjectFilters => ({
  ...DEFAULT_SUBJECT_FILTERS,
  ...over,
});

describe("holdsSubject", () => {
  test("a league present in the map answers true or false", () => {
    assert.equal(holdsSubject("a", player("bijan"), INDEX), true);
    assert.equal(holdsSubject("a", player("bowers"), INDEX), false);
  });

  test("a league the sync has never written answers null, not false", () => {
    // The distinction the whole module rests on: `c` has members but no roster,
    // so it is unknown for a player and known for a leaguemate.
    assert.equal(holdsSubject("c", player("bijan"), INDEX), null);
    assert.equal(holdsSubject("c", mate("dark"), INDEX), true);
  });

  test("a league with an empty roster is a real answer", () => {
    const empty: SubjectIndex = { rosters: { d: [] }, members: {} };
    assert.equal(holdsSubject("d", player("bijan"), empty), false);
  });
});

describe("matchesSubjects", () => {
  test("an empty selection passes everything", () => {
    assert.equal(matchesSubjects("a", DEFAULT_SUBJECT_FILTERS, INDEX), true);
    assert.equal(matchesSubjects("c", DEFAULT_SUBJECT_FILTERS, INDEX), true);
  });

  test("all requires every subject", () => {
    const both = filters({ subjects: [player("bijan"), player("chase")] });
    assert.equal(matchesSubjects("a", both, INDEX), true);
    assert.equal(matchesSubjects("b", both, INDEX), false);
  });

  test("any requires one", () => {
    const either = filters({
      subjects: [player("bijan"), player("chase")],
      match: "any",
    });
    assert.equal(matchesSubjects("a", either, INDEX), true);
    assert.equal(matchesSubjects("b", either, INDEX), true);
  });

  test("an unknown league fails a rule under either mode", () => {
    // Not evidence of absence, but not something to pass on an assumed empty
    // either — the same call `slotCount`'s null makes.
    const all = filters({ subjects: [player("bijan")] });
    const any = filters({ subjects: [player("bijan")], match: "any" });
    assert.equal(matchesSubjects("c", all, INDEX), false);
    assert.equal(matchesSubjects("c", any, INDEX), false);
  });

  test("the two kinds mix in one selection", () => {
    const mixed = filters({ subjects: [player("bijan"), mate("dark")] });
    assert.equal(matchesSubjects("a", mixed, INDEX), true);
    // `b` holds Bijan but is not shared with dark.
    assert.equal(matchesSubjects("b", mixed, INDEX), false);
  });
});

describe("editing a selection", () => {
  test("toggle adds, then removes the same subject", () => {
    const added = toggleSubject(DEFAULT_SUBJECT_FILTERS, player("bijan"));
    assert.equal(added.subjects.length, 1);
    assert.equal(hasSubject(added, player("bijan")), true);
    assert.equal(toggleSubject(added, player("bijan")).subjects.length, 0);
  });

  test("the two kinds do not collide on a shared id", () => {
    const both = toggleSubject(
      toggleSubject(DEFAULT_SUBJECT_FILTERS, player("x")),
      mate("x"),
    );
    assert.equal(both.subjects.length, 2);
    assert.equal(hasSubject(both, player("x")), true);
  });

  test("toggle preserves the match mode", () => {
    const any = filters({ match: "any" });
    assert.equal(toggleSubject(any, player("bijan")).match, "any");
  });

  test("remove addresses a position, not a value", () => {
    const three = filters({
      subjects: [player("bijan"), player("chase"), mate("dark")],
    });
    assert.deepEqual(removeSubjectAt(three, 1).subjects, [
      player("bijan"),
      mate("dark"),
    ]);
  });
});

describe("subjectOptions", () => {
  const leagues = [league("a"), league("b"), league("c")];
  const options = subjectOptions(leagues, INDEX, PLAYERS, USERS, "me");
  const find = (kind: string, id: string) =>
    options.find((o) => o.subject.kind === kind && o.subject.id === id);

  test("counts the leagues holding each subject", () => {
    assert.equal(find("player", "bijan")?.count, 2);
    assert.equal(find("player", "chase")?.count, 1);
    // `a` and `c`; `b` has a member list without them.
    assert.equal(find("leaguemate", "dark")?.count, 2);
  });

  test("the manager themselves is never an option", () => {
    assert.equal(find("leaguemate", "me"), undefined);
  });

  test("a duplicate id within one league counts once", () => {
    const doubled: SubjectIndex = {
      rosters: { a: ["bijan", "bijan", "0", ""] },
      members: {},
    };
    const [only] = subjectOptions([league("a")], doubled, PLAYERS, USERS, "me");
    assert.equal(only.count, 1);
    // The padding Sleeper leaves on a roster is not a player.
    assert.equal(
      subjectOptions([league("a")], doubled, PLAYERS, USERS, "me").length,
      1,
    );
  });

  test("names and notes resolve, and fall back to the id", () => {
    assert.equal(find("player", "bijan")?.name, "Bijan Robinson");
    assert.equal(find("player", "bijan")?.note, "ATL");
    assert.equal(find("leaguemate", "dark")?.name, "DarksideEmperors");
    const unknown = subjectOptions(
      [league("a")],
      { rosters: { a: ["ghost"] }, members: {} },
      PLAYERS,
      USERS,
      "me",
    );
    assert.equal(unknown[0].name, "ghost");
  });

  test("most-held first", () => {
    const counts = options.map((o) => o.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });
});

describe("searchSubjects", () => {
  const leagues = [league("a"), league("b")];
  const options = subjectOptions(leagues, INDEX, PLAYERS, USERS, "me");

  test("an empty query returns the head of the list", () => {
    assert.equal(searchSubjects(options, "", 2).length, 2);
    assert.equal(searchSubjects(options, "   ", 99).length, options.length);
  });

  test("a word-start match anywhere in the name leads", () => {
    const found = searchSubjects(options, "chase", 5);
    assert.equal(found[0]?.subject.id, "chase");
  });

  test("matches are case-insensitive and can be mid-name", () => {
    assert.equal(searchSubjects(options, "ROBIN", 5)[0]?.subject.id, "bijan");
  });

  test("no match is an empty list, not the whole list", () => {
    assert.deepEqual(searchSubjects(options, "zzzz", 5), []);
  });

  test("both kinds are searched together", () => {
    assert.equal(searchSubjects(options, "darkside", 5)[0]?.subject.id, "dark");
  });
});

describe("subjectSummary", () => {
  const label = (subject: { kind: string; id: string }) =>
    subject.kind === "player"
      ? (PLAYERS[subject.id]?.name ?? null)
      : (USERS[subject.id]?.display_name ?? null);

  test("nothing selected says nothing", () => {
    assert.equal(subjectSummary(DEFAULT_SUBJECT_FILTERS, label), null);
  });

  test("an unresolved name falls back to counting, never to the id", () => {
    assert.equal(
      subjectSummary(filters({ subjects: [player("ghost")] }), label),
      "1 player",
    );
    assert.equal(
      subjectSummary(filters({ subjects: [mate("ghost")] }), label),
      "1 leaguemate",
    );
  });

  test("one subject is named, in the lower case the line reads in", () => {
    assert.equal(
      subjectSummary(filters({ subjects: [player("bijan")] }), label),
      "owns bijan robinson",
    );
    assert.equal(
      subjectSummary(filters({ subjects: [mate("dark")] }), label),
      "with darksideemperors",
    );
  });

  test("several are counted rather than spelled out", () => {
    assert.equal(
      subjectSummary(
        filters({ subjects: [player("bijan"), player("chase")] }),
        label,
      ),
      "all of 2 players",
    );
    assert.equal(
      subjectSummary(
        filters({
          subjects: [player("bijan"), mate("dark")],
          match: "any",
        }),
        label,
      ),
      "any of 1 player and 1 leaguemate",
    );
  });
});

describe("subjectKey", () => {
  test("the kind is part of the identity, since the two id spaces are not one", () => {
    // A Sleeper player id and a Sleeper user id are both digit strings, so a key
    // of the id alone would let a player deselect a leaguemate — and the
    // selection is compared by this key everywhere it is edited.
    assert.notEqual(subjectKey(player("1234")), subjectKey(mate("1234")));
  });

  test("the same subject keys the same, and different ones differ", () => {
    assert.equal(subjectKey(player("bijan")), subjectKey(player("bijan")));
    assert.notEqual(subjectKey(player("bijan")), subjectKey(player("chase")));
  });

  test("selection by key survives a colliding id across the two kinds", () => {
    // The consequence the key exists for, asserted where a reader would see it:
    // toggling a player must not remove the leaguemate sharing that id.
    const both = filters({ subjects: [player("1234"), mate("1234")] });
    assert.equal(hasSubject(both, player("1234")), true);
    assert.equal(hasSubject(both, mate("1234")), true);
    assert.deepEqual(toggleSubject(both, player("1234")).subjects, [mate("1234")]);
  });
});

describe("EMPTY_SUBJECT_INDEX", () => {
  test("every league is unknown in it, which is not the same as holding nobody", () => {
    // What the page holds before the two membership payloads land. Null and
    // false are different answers here, the same rule `slotCount` keeps.
    assert.equal(holdsSubject("1", player("bijan"), EMPTY_SUBJECT_INDEX), null);
    assert.equal(holdsSubject("1", mate("dark"), EMPTY_SUBJECT_INDEX), null);
  });

  test("a selection against it matches nothing rather than everything", () => {
    // The list is empty while the maps load, not unnarrowed: showing all 121
    // leagues under "owns Bijan" and then dropping to 19 would have answered the
    // question wrongly first.
    assert.equal(
      matchesSubjects("1", filters({ subjects: [player("bijan")] }), EMPTY_SUBJECT_INDEX),
      false,
    );
    assert.equal(
      matchesSubjects(
        "1",
        filters({ subjects: [player("bijan"), mate("dark")], match: "any" }),
        EMPTY_SUBJECT_INDEX,
      ),
      false,
    );
  });

  test("with nothing selected it still admits every league", () => {
    // The caller never has to ask whether a selection is set before applying it,
    // so an empty one has to pass even when nothing is known.
    assert.equal(matchesSubjects("1", DEFAULT_SUBJECT_FILTERS, EMPTY_SUBJECT_INDEX), true);
  });

  test("it is empty on both halves", () => {
    assert.deepEqual(EMPTY_SUBJECT_INDEX, { rosters: {}, members: {} });
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Which rows have a game, pinned against their call sites.
 *
 * `PaneWeekRow` draws its run of game facts — the groove, the opponent, the
 * clock, the scored total and the `locked` word — only where the row *has* a
 * game, and what says so is whether the caller passed `opponent` at all.
 * Absent is a third state beside a real opponent and a null one, on
 * `parseRequestedSeason`'s reason: null is an answer (no opponent this week,
 * which draws the app's em dash) and collapsing it with "never asked" is how a
 * bye would come to read as a league with no schedule.
 *
 * **That distinction lives in a prop's presence, so nothing fails when it is
 * dropped.** A week row that lost the prop renders a perfectly ordinary row —
 * one line shorter, with its clock, its scored total and its locked word gone
 * — and a manager row that gained one would print `— · —` under every name, a
 * column answering a question that card is not asking. Neither throws, neither
 * typechecks differently, and both are the class of failure this repo pins
 * textually rather than leaves to a review.
 *
 * These are `crawl-writes.test.ts`' bargain on its own terms: nothing here
 * renders anything. It reads the five files and asserts the one textual fact
 * each of their doc comments spends a paragraph arguing for, so that an edit
 * which flattens one has to delete an assertion that says why.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/**
 * Every `<PaneWeekRow …>` element in a file, from the tag to its self-closing
 * `/>` — matched at the element's own indentation so a `/>` inside a nested
 * prop cannot end it early.
 */
function rows(source: string): string[] {
  const found: string[] = [];
  const open = /^([ \t]*)<PaneWeekRow$/gm;
  for (let m = open.exec(source); m !== null; m = open.exec(source)) {
    const close = source.indexOf(`\n${m[1]}/>`, m.index);
    assert.notEqual(close, -1, "a PaneWeekRow should be self-closing at its own indent");
    found.push(source.slice(m.index, close));
  }
  return found;
}

/** `opponent={…}` as a prop of this element, rather than the word in a comment. */
const passesOpponent = (row: string) => /^\s*opponent=\{/m.test(row);

describe("the week tools' rows carry a game", () => {
  // Both files are sibling features, read as text rather than imported: they
  // are `"use client"` modules pulling in half the console, and what is being
  // asserted is a fact about the source rather than about a render.
  const files = [
    ["the lineup checker", "src/features/lineupchecker/components/week-panes.tsx", 1],
    ["gametime", "src/features/gametime/components/live-panes.tsx", 2],
  ] as const;

  for (const [tool, path, count] of files) {
    test(`${tool} passes \`opponent\` on every row`, () => {
      const found = rows(read(path));
      // The count is pinned so a row *added* without one is caught too — the
      // assertion below is vacuously true over an empty list.
      assert.equal(found.length, count, `${path} should draw ${count} week row(s)`);
      for (const row of found) {
        assert.ok(
          passesOpponent(row),
          `${path}: a week row must pass \`opponent\`, or it silently loses its ` +
            "clock, its scored total and its locked word",
        );
      }
    });
  }
});

describe("the manager card's rows carry none", () => {
  // The payload has no game data of any kind — `LineupPlayer` is a name,
  // positions, a team and three valuations — so the second line is `POS · TEAM`
  // and nothing else, and the two one-line lists draw no second line at all.
  const files = [
    ["the standings", "src/features/shared/ui/league-teams.tsx", 1],
    ["the roster seats and bench", "src/features/shared/ui/lineup-breakdown.tsx", 2],
    ["the pick portfolio", "src/features/shared/ui/draft-picks.tsx", 1],
  ] as const;

  for (const [list, path, count] of files) {
    test(`${list} passes no \`opponent\`, \`meta\` or \`second\``, () => {
      const found = rows(read(path));
      assert.equal(found.length, count, `${path} should draw ${count} row(s)`);
      for (const row of found) {
        assert.ok(
          !passesOpponent(row),
          `${path}: a manager row must not pass \`opponent\` — an em dash where ` +
            "the week tools print a game is a column answering a question this " +
            "card is not asking",
        );
        // The other two halves of the run, which would light it just as surely.
        assert.ok(!/^\s*meta=\{/m.test(row), `${path}: no clock on a manager row`);
        assert.ok(!/^\s*second=\{/m.test(row), `${path}: no scored total on a manager row`);
      }
    });
  }
});

describe("the two one-line lists", () => {
  // A team has a place, a name and a total; a pick is not a person. Both draw
  // one line **at the week row's own height**, which is what keeps the two
  // panes reading across each other row for row — the whole reason the team
  // tile is one line at 48px rather than one line at 34.
  const files = [
    ["a standings team", "src/features/shared/ui/league-teams.tsx"],
    ["a draft pick", "src/features/shared/ui/draft-picks.tsx"],
  ] as const;

  for (const [subject, path] of files) {
    test(`${subject} draws no second line`, () => {
      for (const row of rows(read(path))) {
        assert.ok(
          /^\s*line2=\{false\}/m.test(row),
          `${path}: ${subject} has nothing to put on a second line, and an ` +
            "empty one pushes the name off the row's optical centre",
        );
      }
    });
  }

  test("a standings team stacks its figure under its name on a phone", () => {
    // On one ~150px line a six-figure total beside a face left a team name two
    // characters. `stacked` gives the name the column and the figure a line.
    for (const row of rows(read("src/features/shared/ui/league-teams.tsx"))) {
      assert.ok(/^\s*stacked\b/m.test(row), "a standings team passes `stacked`");
    }
  });

  test("a roster seat and a bench row keep theirs", () => {
    // They carry `POS · TEAM`, at **both** widths — which is where they part
    // company with the week row's own arm, whose phone line drops the position
    // because the game is the better use of ~150px. Here there is no game, so
    // dropping it would leave the line empty.
    for (const row of rows(read("src/features/shared/ui/lineup-breakdown.tsx"))) {
      assert.ok(!/^\s*line2=/m.test(row), "a seat and a bench row draw POS · TEAM");
      assert.ok(/^\s*note=\{/m.test(row), "…which is the `note` prop plus the seat's position");
    }
  });
});

describe("the reader's own team is anodised rather than railed", () => {
  const source = read("src/features/shared/ui/league-teams.tsx");

  test("the bay takes `--slot-metal-mine`", () => {
    // The lit rail `PaneRow` ran down a row's left edge has nowhere to go: the
    // bay runs to the tile's own edge and is clipped by its radius, which is
    // why the tile has no left padding. So *yours* moved into the bay.
    assert.match(source, /hue: team\.is_manager \? "var\(--slot-metal-mine\)" : undefined/);
    assert.ok(
      !/mine=\{/.test(source),
      "`PaneRow.mine` is gone with the rail it drew — the bay is the cue now",
    );
  });

  test("the hue is declared, and only in the dark block", () => {
    // A hue is a number and has nothing to turn over for the light scheme,
    // which is what the six position hues beside it already rely on.
    const css = read("src/app/globals.css");
    const declarations = css.match(/--slot-metal-mine:/g) ?? [];
    assert.equal(declarations.length, 1, "`--slot-metal-mine` is declared once");
    assert.match(css, /--slot-metal-mine: 190;/);
  });
});

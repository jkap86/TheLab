import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/contract";

import {
  formatCombinedRecord,
  formatWinPct,
  formatWinShare,
  seasonSummary,
} from "./season-summary.ts";

/** Only the two fields the aggregate reads; the rest is the card's business. */
function league(
  record: ManagerLeague["record"],
): ManagerLeague {
  return { record } as ManagerLeague;
}

describe("seasonSummary", () => {
  test("records add up across leagues, ties and all", () => {
    const summary = seasonSummary([
      league({ wins: 8, losses: 5, ties: 0 }),
      league({ wins: 3, losses: 9, ties: 1 }),
    ]);
    assert.equal(summary.leagues, 2);
    assert.equal(summary.wins, 11);
    assert.equal(summary.losses, 14);
    assert.equal(summary.ties, 1);
    assert.equal(summary.games, 26);
  });

  test("a league without a record is skipped, not counted 0-0", () => {
    // The league still counts toward `leagues` — it was in the list handed in —
    // but a roster that has not been read has no games, and calling them losses
    // would move the win rate.
    const summary = seasonSummary([
      league({ wins: 6, losses: 4, ties: 0 }),
      league(null),
    ]);
    assert.equal(summary.leagues, 2);
    assert.equal(summary.games, 10);
    assert.equal(summary.winPct, 60);
  });

  test("a tie is half a win", () => {
    const summary = seasonSummary([league({ wins: 0, losses: 0, ties: 2 })]);
    assert.equal(summary.winPct, 50);
  });

  test("nothing on file is null, never zero", () => {
    // Zero would draw a real arc at 0% and claim the manager lost every game
    // they played, which is the opposite of "no games yet".
    assert.equal(seasonSummary([league(null)]).winPct, null);
    assert.equal(seasonSummary([]).winPct, null);
  });
});

describe("the formatters", () => {
  test("the tie component appears only where there is one", () => {
    assert.equal(
      formatCombinedRecord(seasonSummary([league({ wins: 8, losses: 5, ties: 0 })])),
      "8–5",
    );
    assert.equal(
      formatCombinedRecord(seasonSummary([league({ wins: 8, losses: 5, ties: 1 })])),
      "8–5–1",
    );
  });

  test("the win rate reads to a decimal, and an em dash where there is none", () => {
    assert.equal(
      formatWinPct(seasonSummary([league({ wins: 1, losses: 2, ties: 0 })])),
      "33.3%",
    );
    assert.equal(formatWinPct(seasonSummary([])), "—");
  });

  test("the same rate as a share drops its leading zero", () => {
    assert.equal(
      formatWinShare(seasonSummary([league({ wins: 7, losses: 5, ties: 0 })])),
      ".583",
    );
    // A tie is half a win, which is the one place the two formatters could
    // have come to disagree about what they are dividing.
    assert.equal(
      formatWinShare(seasonSummary([league({ wins: 7, losses: 4, ties: 1 })])),
      ".625",
    );
  });

  test("a perfect record is 1.000 and keeps its leading digit", () => {
    assert.equal(
      formatWinShare(seasonSummary([league({ wins: 13, losses: 0, ties: 0 })])),
      "1.000",
    );
  });

  test("a share that *rounds* to one keeps it too", () => {
    // The trap the formatter is written around: 9,999 of 10,000 is 0.9999,
    // which is not >= 1 and is `1.000` at three decimals. Sliced off the
    // number rather than off the string it would read `.000` — the widest
    // reading on the page rendered as its own opposite.
    assert.equal(
      formatWinShare(seasonSummary([league({ wins: 9999, losses: 1, ties: 0 })])),
      "1.000",
    );
  });

  test("a played-and-lost season is .000; an unplayed one is an em dash", () => {
    assert.equal(
      formatWinShare(seasonSummary([league({ wins: 0, losses: 6, ties: 0 })])),
      ".000",
    );
    assert.equal(formatWinShare(seasonSummary([])), "—");
    // A league whose rosters have never been read has no record at all, which
    // is not the same statement as having lost every game.
    assert.equal(formatWinShare(seasonSummary([league(null)])), "—");
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Relative with the extension, like the modules under test import each other:
// Node's test runner strips types but does not know the `@/*` aliases.
import { ktcPickKey } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice } from "../../shared/ktc/picks.ts";
import { adpBoardRows } from "./adp-controls.ts";
import {
  FALLBACK_PICK_ROUNDS,
  adpBoardEntries,
  adpPickRows,
  pickDiscountBoard,
} from "./adp-picks.ts";
import type { AdpBoardEntry, AdpPickRow } from "./adp-picks.ts";
import type { AdpPlayerPayload } from "@/shared/contract";

/**
 * Picks on the ADP board.
 *
 * What is worth pinning is the set of claims the rows rest on that neither the
 * type system nor a render can hold — every one of them is silent when wrong,
 * because a plausible number appears either way:
 *
 * - **A pick's ADP is the rung rookie's own average on the board being shown.**
 *   Not the rookie-draft ordering the trades board deliberately reads instead:
 *   there, a *valuation* must not follow a display choice; here, the display is
 *   the question being asked.
 * - **The discount lands on the value and never on the ADP.** That is what keeps
 *   a future pick's place on the board still while the reader drags the curve —
 *   and it is why a pick row carries an average and a factor rather than a
 *   number.
 * - **The numbered class asks KTC for nothing.** An unsynced board must cost the
 *   future rows and not the current ones.
 * - **The player ordering is untouched.** `adpBoardEntries` decides where a pick
 *   goes among the players and nothing else about the list.
 */

const stats = (adp: number) => ({
  picks: 10,
  adp,
  min_pick: 1,
  max_pick: 40,
  stdev: 2,
});

const player = (
  id: string,
  over: Partial<AdpPlayerPayload> = {},
): AdpPlayerPayload => ({
  player_id: id,
  name: `Player ${id}`,
  position: "WR",
  team: "SF",
  rookie: false,
  redraft: stats(50),
  dynasty: stats(50),
  ...over,
});

/** A rookie the board averaged at `adp` on both markets. */
const rookie = (id: string, adp: number, dynastyAdp = adp): AdpPlayerPayload =>
  player(id, { rookie: true, redraft: stats(adp), dynasty: stats(dynastyAdp) });

const price = (sf: number): KtcPickPrice => ({ sf, oneqb: sf - 200 });

/** Two future seasons KTC prices, where 2028 is worth half of 2027. */
const KTC = {
  [ktcPickKey("2027", 1, null)]: price(6000),
  [ktcPickKey("2027", 2, null)]: price(2000),
  [ktcPickKey("2028", 1, null)]: price(3000),
};

/** Four rookies, so a two-team draft has exactly two rounds of rungs. */
const ROOKIES = [rookie("r1", 10), rookie("r2", 20), rookie("r3", 30), rookie("r4", 40)];

const rows = (over: Partial<Parameters<typeof adpPickRows>[0]> = {}) =>
  adpPickRows({
    players: ROOKIES,
    ktcPicks: KTC,
    classSeason: "2026",
    teams: 2,
    superflex: true,
    ...over,
  });

/** A row by the label a reader would look for. */
const labelled = (list: readonly AdpPickRow[], label: string) =>
  list.find((row) => row.label === label);

describe("adpPickRows", () => {
  test("the current class is numbered slot by slot, standing on its own rookies", () => {
    const list = rows();
    // 1.01 takes the first rookie off *this* board, 1.02 the second, and the
    // second round carries on down the same queue — which is what makes a pick
    // row checkable against a player row a few lines away.
    assert.deepEqual(
      list
        .filter((row) => row.season === "2026")
        .map((row) => [row.label, row.redraft?.adp, row.redraft?.player_id]),
      [
        ["2026 1.01", 10, "r1"],
        ["2026 1.02", 20, "r2"],
        ["2026 2.01", 30, "r3"],
        ["2026 2.02", 40, "r4"],
      ],
    );
  });

  // The rung is `(round − 1) × teams + slot`, so the same 2.01 is a different
  // pick in a different size of draft — the reason the board's own size filter
  // feeds this rather than a constant.
  test("the draft size decides which rookie a later round reaches", () => {
    const list = rows({ teams: 4, players: ROOKIES });
    assert.equal(labelled(list, "2026 1.04")?.redraft?.player_id, "r4");
    // 2.01 would be the fifth rookie, and the board averaged four.
    assert.equal(labelled(list, "2026 2.01"), undefined);
  });

  // Inventing a rung would price a pick against a player nobody drafted, so a
  // round deeper than the class the board priced is simply not a row.
  test("a pick past the ladder is dropped rather than estimated", () => {
    const list = rows();
    assert.equal(labelled(list, "2026 3.01"), undefined);
    assert.ok(list.every((row) => row.round <= 2 || row.season !== "2026"));
  });

  test("a future season is one row per round, assumed mid and named for the round", () => {
    const list = rows().filter((row) => row.season !== "2026");
    assert.deepEqual(
      list.map((row) => [row.label, row.slot]),
      [
        ["2027 1st", null],
        ["2027 2nd", null],
        ["2028 1st", null],
      ],
    );
  });

  /**
   * The load-bearing split: what waiting costs reaches the value and never the
   * average.
   *
   * A 2028 first stands on the same rookie a mid-2027 first does — nobody can
   * name the 2028 class — so its place on the board is that rookie's place. What
   * differs is the factor beside it, and keeping that out of the ADP is what
   * stops the list re-sorting under a reader dragging the curve.
   */
  test("a future pick is discounted in the factor, never in the average", () => {
    const list = rows();
    const near = labelled(list, "2027 1st")?.redraft;
    const far = labelled(list, "2028 1st")?.redraft;
    assert.equal(near?.adp, far?.adp);
    assert.equal(near?.player_id, far?.player_id);
    // 2027 *is* the nearest season KTC prices, so there is nothing to discount
    // it by; 2028 is half of it on that board.
    assert.equal(near?.discount, 1);
    assert.equal(far?.discount, 3000 / 6000);
    assert.equal(far?.base, "2027");
    // Stated only where it changed the number.
    assert.equal(near?.base, null);
  });

  /**
   * The current class needs nothing from KTC — the ladder *is* that class — so
   * an unsynced board costs the future rows and not the numbered ones. Without
   * this the whole feature disappears with one failed scrape.
   */
  test("an empty KTC board still numbers the class, and lists no future season", () => {
    const list = rows({ ktcPicks: {} });
    assert.ok(list.length > 0);
    assert.ok(list.every((row) => row.season === "2026"));
    assert.ok(list.every((row) => row.redraft?.discount === 1));
    // With no season to read a round count off, the fallback bounds it — and
    // the ladder bounds it further, which is why this is under four rounds.
    assert.ok(FALLBACK_PICK_ROUNDS >= Math.max(...list.map((row) => row.round)));
  });

  // A board carrying no rookies is a historical one, or one narrowed past the
  // class — an empty ladder rather than a wrong one.
  test("a board with no rookies lists no picks", () => {
    assert.deepEqual(rows({ players: [player("v1")] }), []);
  });

  /**
   * Two ladders, because a rookie goes in the first round of a dynasty startup
   * and the middle of a redraft: the two markets are different queues, and each
   * column reads its own.
   */
  test("each market reads its own ladder", () => {
    const list = adpPickRows({
      players: [rookie("r1", 40, 5), rookie("r2", 12, 60)],
      ktcPicks: KTC,
      classSeason: "2026",
      teams: 1,
      superflex: true,
    });
    const first = labelled(list, "2026 1.01");
    // Redraft took r2 first, dynasty took r1 — one row, two rungs.
    assert.equal(first?.redraft?.player_id, "r2");
    assert.equal(first?.dynasty?.player_id, "r1");
    assert.equal(first?.redraft?.adp, 12);
    assert.equal(first?.dynasty?.adp, 5);
  });

  // A market the ladder can't price leaves that column null rather than
  // borrowing the other's number, which would be two markets in one cell.
  test("a market with no rookies leaves its own column null", () => {
    const list = adpPickRows({
      players: [{ ...rookie("r1", 10), dynasty: null }],
      ktcPicks: KTC,
      classSeason: "2026",
      teams: 1,
      superflex: true,
    });
    assert.equal(labelled(list, "2026 1.01")?.redraft?.adp, 10);
    assert.equal(labelled(list, "2026 1.01")?.dynasty, null);
  });
});

describe("adpBoardEntries", () => {
  const veterans = [
    player("v1", { redraft: stats(1), dynasty: stats(2) }),
    player("v2", { redraft: stats(15), dynasty: stats(16) }),
    player("v3", { redraft: stats(35), dynasty: stats(36) }),
  ];
  const board = [...veterans, ...ROOKIES];

  const keys = (entries: readonly AdpBoardEntry[]) => entries.map((e) => e.key);

  /**
   * The one thing this decides is where a pick goes; the players' own order is
   * `adpBoardRows`', including the tiebreaks it applies between two of them.
   * Asserted by construction rather than by example — strip the picks and what
   * is left has to be that list, verbatim.
   */
  test("the players keep exactly the ordering adpBoardRows gave them", () => {
    for (const shown of ["both", "redraft", "dynasty"] as const) {
      const entries = adpBoardEntries(board, rows({ players: board }), shown);
      assert.deepEqual(
        entries.filter((e) => e.kind === "player").map((e) => e.key),
        adpBoardRows(board, shown).map((p) => p.player_id),
        shown,
      );
    }
  });

  test("a pick sorts in at the average of the rookie it stands on", () => {
    const entries = adpBoardEntries(board, rows({ players: board }), "redraft");
    // r1 averages 10 and the 1.01 stands on him, so the two are adjacent —
    // between v1 (1) and v2 (15). The two future firsts land there as well: in
    // a two-team draft the middle of a round *is* the first slot, so all three
    // picks read the same rung and differ only in what they are worth.
    assert.deepEqual(keys(entries).slice(0, 6), [
      "v1",
      "r1",
      "pick:2026:1:1",
      "pick:2027:1:mid",
      "pick:2028:1:mid",
      "v2",
    ]);
  });

  /**
   * The tie rule: a pick reads as an annotation of the row above it, which is
   * what it is — the two carry the same number for the same reason.
   */
  test("on an equal average the player leads and the pick follows", () => {
    const entries = adpBoardEntries(board, rows({ players: board }), "redraft");
    const at = keys(entries);
    assert.ok(at.indexOf("r1") < at.indexOf("pick:2026:1:1"));
    assert.ok(at.indexOf("r4") < at.indexOf("pick:2026:2:2"));
  });

  // A column of em dashes answers nothing, so a single board keeps only what it
  // can price — picks on the same terms as players.
  test("a single board drops the picks it can't price", () => {
    const noDynasty = board.map((p) => ({ ...p, dynasty: null }));
    const picks = rows({ players: noDynasty });
    assert.deepEqual(
      adpBoardEntries(noDynasty, picks, "dynasty").filter((e) => e.kind === "pick"),
      [],
    );
    assert.ok(
      adpBoardEntries(noDynasty, picks, "redraft").some((e) => e.kind === "pick"),
    );
  });

  // Both boards keep every row, with the ones the primary market never priced
  // following in the other market's order rather than interleaved on numbers
  // from two different markets.
  test("both boards keep a pick the primary market can't price, in the tail", () => {
    const dynastyOnly = board.map((p) =>
      p.player_id.startsWith("r") ? { ...p, redraft: null } : p,
    );
    const picks = rows({ players: dynastyOnly });
    const entries = adpBoardEntries(dynastyOnly, picks, "both");
    const at = keys(entries);
    // Every redraft-priced veteran comes first; the rookies and their picks
    // follow, in dynasty order.
    assert.deepEqual(at.slice(0, 3), ["v1", "v2", "v3"]);
    assert.ok(at.includes("pick:2026:1:1"));
    assert.ok(at.indexOf("v3") < at.indexOf("pick:2026:1:1"));
  });

  test("no picks is the player list unchanged", () => {
    assert.deepEqual(
      keys(adpBoardEntries(board, [], "both")),
      adpBoardRows(board, "both").map((p) => p.player_id),
    );
  });
});

describe("pickDiscountBoard", () => {
  // A ratio between two rows of one board, so which board matters far less than
  // it does for a roster — but a reader who has narrowed to 1QB drafts gets the
  // 1QB board, and everything else reads superflex.
  test("only a 1QB board reads the 1QB rows", () => {
    assert.equal(pickDiscountBoard("no"), false);
    assert.equal(pickDiscountBoard("yes"), true);
    assert.equal(pickDiscountBoard("all"), true);
  });
});

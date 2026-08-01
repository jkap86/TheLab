import { ktcBoardValue } from "../../shared/ktc/roster.ts";
import type { Metric } from "../shared/metric-cell.ts";
import type { TradeBundle } from "./exchange.ts";
import type { KtcValue } from "./types";

/**
 * The metrics a trade card's value column can show, and how to read one off one
 * side of one trade.
 *
 * The fifth grain in the catalogue table, and the first outside the manager tool:
 * a row here is **what one roster came away with**. That is the only grain a
 * trade offers a number at — a trade as a whole has no value worth printing,
 * since the sides are the same assets counted twice, and "the trade is worth
 * 12,000" says nothing a reader arrived to ask. What they did arrive to ask is
 * which side got more, which is one number per side and the same number on each.
 *
 * The card carries **one** slot rather than the cards' four. A trade card is
 * already a table of assets, and four columns of aggregates beside them would be
 * reading the card twice; one column is a summary of the haul the rows spell
 * out.
 *
 * Pure and free of runtime imports beyond {@link ktcBoardValue} — which arrives
 * relatively with an explicit `.ts` extension, the way the league filters reach
 * the same file — so the numbers are tested without a fetch behind them, the bar
 * its four sibling catalogues hold.
 */

/** What a trade metric reads from: one side's haul, priced on its league's board. */
export type TradeSideContext = {
  /** What this side received — the only half a stored trade holds. */
  received: TradeBundle;
  /**
   * Player id → both KTC boards, as the stream delivered them. An id KTC doesn't
   * price is absent rather than zero, which is what lets a haul say how much of
   * itself it managed to price.
   */
  ktc: Record<string, KtcValue>;
  /**
   * Which of KTC's two boards this trade's league reads — derived from the
   * league's own lineup, since the stream spans leagues that read different
   * ones and a roster read off the wrong board is wrong at every position. A
   * league whose lineup isn't stored falls to the 1QB board, which is what
   * `isSuperflexLineup` answers for an unknown lineup.
   */
  superflex: boolean;
};

export type TradeMetric = Metric<TradeSideContext>;

/** Which board a number was read on, for the hovers that have to say. */
function boardName(superflex: boolean): string {
  return superflex ? "superflex board" : "1QB board";
}

/**
 * Every metric a trade card's value column can show, in the order the picker
 * lists them: what the haul is worth, then what it is made of.
 *
 * The KTC entry leads because it is the question the column was added for, and
 * it is the one that can decline to answer: KTC prices ~500 dynasty skill
 * players, so a haul of a kicker and a 2029 4th is off the board entirely. That
 * reads as an em dash rather than as zero, and a partly-priced haul says so in
 * its hover — the same habit as the league card's `priced` of `rostered`.
 */
export const TRADE_METRICS: TradeMetric[] = [
  {
    key: "ktc",
    group: "Value",
    label: "KTC",
    cell: ({ received, ktc, superflex }) => {
      let total = 0;
      let priced = 0;
      for (const id of received.players) {
        const value = ktcBoardValue(superflex, ktc[id]);
        if (value === null) continue;
        total += value;
        priced += 1;
      }

      const of = received.players.length;
      const picks = received.picks.length;
      return {
        kind: "value",
        // Zero priced players is not a value of zero: it is a haul this board
        // has nothing to say about, which is most pick-only trades.
        text: priced > 0 ? total.toLocaleString() : null,
        title:
          priced > 0
            ? `Dynasty KTC, ${boardName(superflex)} · ${priced} of ${of} player${
                of === 1 ? "" : "s"
              } priced${picks > 0 ? ` · ${picks} pick${picks === 1 ? "" : "s"} unpriced` : ""}`
            : // KTC carries no draft picks at all, so a pick-only haul is not a
              // gap in the board — saying which it is keeps the em dash from
              // reading as missing data.
              picks > 0 && of === 0
              ? "Draft picks aren't on KTC's board"
              : `Nothing in this haul is priced on the ${boardName(superflex)}`,
      };
    },
  },
  {
    key: "players",
    group: "Haul",
    label: "Players",
    cell: ({ received }) => ({
      kind: "value",
      // A count, so zero is an answer rather than an absence — a side that took
      // only picks received no players, which is a fact about the trade.
      text: String(received.players.length),
      title: `${received.players.length} player${
        received.players.length === 1 ? "" : "s"
      } received`,
    }),
  },
  {
    key: "picks",
    group: "Haul",
    label: "Picks",
    cell: ({ received }) => ({
      kind: "value",
      text: String(received.picks.length),
      title: `${received.picks.length} draft pick${
        received.picks.length === 1 ? "" : "s"
      } received`,
    }),
  },
  {
    key: "faab",
    group: "Haul",
    label: "FAAB",
    cell: ({ received }) => ({
      kind: "value",
      // Unlike the counts, absent rather than `$0`: FAAB moves in a minority of
      // trades, so a zero on every other card is a column spent saying nothing.
      text: received.faab > 0 ? `$${received.faab.toLocaleString()}` : null,
      title:
        received.faab > 0
          ? `$${received.faab.toLocaleString()} FAAB received`
          : "No FAAB moved",
    }),
  },
];

/** The column a trade card opens with — the value the others are context for. */
export const DEFAULT_TRADE_COLUMNS: readonly string[] = ["ktc"];

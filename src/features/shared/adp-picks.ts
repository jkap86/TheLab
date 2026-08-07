import { ktcPickBoardRows } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice } from "../../shared/ktc/picks.ts";
import { adpBoardRows } from "./adp-controls.ts";
import type { AdpControls, AdpShownBoards } from "./adp-controls.ts";
import { pickAdpStand, pickLabel, rookieLadder } from "./pick-value.ts";
import type { AdpPlayerPayload } from "@/shared/contract";
import type { AdpBoardType } from "@/shared/manager";

/**
 * Draft picks on the ADP board, beside the players.
 *
 * **A board of player averages has no row for a pick, and it doesn't need one: a
 * rookie pick is a place in a queue, and the queue is on the board already.**
 * Rank the rookies the board averaged and the first of them is what the 1.01
 * returns, the second what the 1.02 returns, and so on — so a pick's ADP is the
 * ADP of the player it buys, in the same column, out of the same population the
 * rest of the list is read from. That is what lets a pick sort into the board
 * rather than sit in a table of its own.
 *
 * **Both ends of that read the board on screen, which is the opposite call from
 * the one `pick-value` makes for a trade card, and deliberately so.** There, the
 * ordering comes from rookie drafts and the price from startups, because a
 * *valuation* must not move with a display choice — a card priced off whichever
 * board the panel happened to be showing was the bug that split those two. Here
 * the display *is* the question. "Where do picks fall on the board in front of
 * me" has one honest answer per board: on a startup board the 1.01 stands where
 * the best rookie goes in startups, and on a rookie board it stands at 1.0,
 * because on a board of rookie drafts that is literally what the pick is. A
 * second population would make the pick rows describe drafts the reader is not
 * looking at.
 *
 * Two things the ladder still cannot answer on its own:
 *
 * - **Which slot a future pick is.** There is no draft and no order, so it takes
 *   the middle of its round — {@link middleSlot}, the convention every trade
 *   calculator uses — and is named for the round alone (`2027 1st`) rather than
 *   given a slot it doesn't have.
 * - **What waiting costs.** The class a 2028 first will spend is not a class
 *   anybody can name, so the ladder prices every pick as if it were being spent
 *   now. KTC publishes exactly that opinion one row per season, and the ratio
 *   between two of its rows carries it across ({@link pickAdpStand}). A season
 *   KTC has no opinion about is a season with no picks on this board, which is
 *   the honest end of that: an undiscounted 2032 4th quoted at next year's price
 *   is the one wrong answer here that would look like a working one.
 *
 * **The discount stays out of the ADP and lands on the value**, which is what
 * keeps a future pick's place on the board stable while the reader drags the
 * curve. It is the same rule the player rows keep — an average is what a row
 * sorts on, and the curve is applied in the cell — and the reason
 * {@link pickAdpStand} exists apart from `pickAdpValue`.
 *
 * Pure and tested: the runtime imports are relative with explicit `.ts`
 * extensions and the payload shapes arrive as erased `import type`s.
 */

/** One board's reading of a pick: where it stands, and what waiting costs it. */
export type AdpPickStats = {
  /**
   * The rung's average on this board — the player the pick returns, which is
   * what the pick sorts and reads as. Never discounted; see the module note.
   */
  adp: number;
  /** The rookie standing on that rung, so a hover can say whose place this is. */
  player: string;
  player_id: string;
  /** Which rung that is: the pick's overall number in a rookie draft. */
  overall: number;
  /** What the future-season discount multiplies the value by; 1 where none did. */
  discount: number;
  /** The season that fraction was measured against, or null where none was. */
  base: string | null;
  /** False where KTC priced the pair on a broader row than the pick's own third. */
  discountExact: boolean;
};

/** One pick row on the board, priced on each of the two markets. */
export type AdpPickRow = {
  /**
   * Unique per row and stable across refetches — what the windowed list keys on.
   * Prefixed so it cannot collide with a Sleeper player id, which is what a
   * player row is keyed by.
   */
  key: string;
  season: string;
  round: number;
  /** Its place in the round, or null where it is assumed to fall mid-round. */
  slot: number | null;
  /** `2026 1.03`, or `2027 1st` — {@link pickLabel}. */
  label: string;
  redraft: AdpPickStats | null;
  dynasty: AdpPickStats | null;
};

/**
 * How many rounds of the current class the board lists when KTC has nothing to
 * say about that season — which is most of the year, since a season's rows come
 * off KTC's board once its draft has happened.
 *
 * Four is the depth KTC itself carries and the depth rookie drafts are usually
 * run to. It is only ever an upper bound: a round deeper than the rookies the
 * board averaged has no rung and is dropped, so a thin board lists fewer.
 */
export const FALLBACK_PICK_ROUNDS = 4;

/** The rounds this board prices for a season, or null where it prices none. */
function ktcRoundsFor(
  rows: readonly { season: string; round: number }[],
  season: string,
): number | null {
  let deepest: number | null = null;
  for (const row of rows) {
    if (row.season !== season) continue;
    if (deepest === null || row.round > deepest) deepest = row.round;
  }
  return deepest;
}

/**
 * The picks a board lists, priced on both markets — the current class numbered
 * slot by slot, and the seasons beyond it a round at a time.
 *
 * The two are different lists rather than one with a flag, because they answer
 * to different things. **The current class is a real queue**: its rookies are on
 * the board, so every slot of every round is a rung somebody stands on, and the
 * pick is named the way a league names it (`2026 1.03`). **A future season has
 * no class at all**, so there is nothing to number against — one row per round,
 * assumed mid, priced as an average pick of the class in hand and then
 * discounted for the wait.
 *
 * Which seasons those are is read off KTC's board rather than counted forward
 * from a calendar ({@link ktcPickBoardRows}), for the reason `ktcPickBaseSeason`
 * is read the same way: which drafts it still has an opinion about moves through
 * the year, and a season it cannot discount is a season this cannot list.
 */
export function adpPickRows({
  players,
  ktcPicks,
  classSeason,
  teams,
  superflex,
}: {
  /**
   * The board's own rows. The ladder is a reading of these and nothing else — a
   * rookie the board didn't average is not a rung, which is what keeps a pick
   * row standing on a player the reader can see a few lines away.
   */
  players: readonly AdpPlayerPayload[];
  /** KTC's pick board, for the future-season discount and the seasons on offer. */
  ktcPicks: Readonly<Record<string, KtcPickPrice>>;
  /**
   * The season the rookies on this board belong to — the class that is a rookie
   * *now*, since `AdpPlayerPayload.rookie` carries no history. It is the active
   * season rather than the board's own: a board cut to a past season simply
   * holds none of them, and its ladder is empty rather than mislabelled.
   */
  classSeason: string;
  /** The draft size the picks are numbered out of — {@link previewDraftTeams}. */
  teams: number;
  /** Which of KTC's two boards the discount ratio is read on. */
  superflex: boolean;
}): AdpPickRow[] {
  // One ladder per market, because a rookie goes in the first round of a dynasty
  // startup and the middle of a redraft: the two are different queues, and each
  // column reads its own. A market with no rookies averaged has no ladder, which
  // reads as that column being empty rather than as picks priced off the other.
  const ladders: Record<AdpBoardType, ReturnType<typeof rookieLadder>> = {
    redraft: rookieLadder(players, players, "redraft"),
    dynasty: rookieLadder(players, players, "dynasty"),
  };

  const ktcRows = ktcPickBoardRows(ktcPicks);
  const rows: AdpPickRow[] = [];

  const add = (season: string, round: number, slot: number | null) => {
    const stats = (board: AdpBoardType): AdpPickStats | null => {
      const stand = pickAdpStand({
        ladder: ladders[board],
        pick: { season, round },
        slot,
        teams,
        ktcPicks,
        superflex,
        // The ladder *is* this class, so its own picks are being spent now and
        // ask KTC for nothing — which is what keeps the numbered rows on the
        // board when KTC is unsynced and the future rows honestly absent.
        ladderSeason: classSeason,
      });
      if (stand.player === undefined) return null;
      return {
        adp: stand.startupAdp,
        player: stand.player,
        player_id: stand.player_id,
        overall: stand.overall,
        discount: stand.discount,
        base: stand.base,
        discountExact: !stand.discountEstimated,
      };
    };

    const redraft = stats("redraft");
    const dynasty = stats("dynasty");
    // A pick neither market can place is not a row. Both refusals are honest —
    // past the class the board priced, or a season KTC cannot discount — and an
    // em-dash row on both columns would say nothing either of them doesn't.
    if (!redraft && !dynasty) return;
    rows.push({
      key: `pick:${season}:${round}:${slot ?? "mid"}`,
      season,
      round,
      slot,
      label: pickLabel({ season, round }, slot),
      redraft,
      dynasty,
    });
  };

  const ownRounds = ktcRoundsFor(ktcRows, classSeason) ?? FALLBACK_PICK_ROUNDS;
  for (let round = 1; round <= ownRounds; round++) {
    for (let slot = 1; slot <= teams; slot++) add(classSeason, round, slot);
  }

  // Strictly later seasons only. The class in hand is numbered above, and a
  // season *before* it is a draft that has happened — its picks were spent on
  // players who are already rows on this board.
  const futureSeasons = [...new Set(ktcRows.map((r) => r.season))].filter(
    (season) => season > classSeason,
  );
  for (const season of futureSeasons) {
    const rounds = ktcRoundsFor(ktcRows, season) ?? 0;
    for (let round = 1; round <= rounds; round++) add(season, round, null);
  }

  return rows;
}

/**
 * One row of the drawer's list: a player the board averaged, or a pick that
 * stands on one.
 *
 * A discriminated union rather than a common row shape, because the two share
 * only a place in the order — a player has a position, a sample and a share of
 * the drafts he was taken in, and a pick has a season, a round and a rung. The
 * `key` is hoisted out of both because it is the one thing the list itself needs
 * of a row.
 */
export type AdpBoardEntry =
  | { kind: "player"; key: string; player: AdpPlayerPayload }
  | { kind: "pick"; key: string; pick: AdpPickRow };

/** What a row sorts on for a given board, or `null` where that board has none. */
function statsFor(
  entry: AdpBoardEntry,
  board: AdpBoardType,
): { adp: number } | null {
  return entry.kind === "player" ? entry.player[board] : entry.pick[board];
}

/**
 * The rows the drawer's list displays, in that display's own order: the board's
 * players merged with the picks that stand on them.
 *
 * **A merge of two ordered lists rather than one sort over both**, and that is
 * what keeps the players' own ordering exactly {@link adpBoardRows}' — the
 * tiebreaks it applies between two players (the better-sampled row, then the id)
 * are its business and are not restated here. All this decides is the one thing
 * that list cannot: where a pick goes among them.
 *
 * Three rules, and each mirrors the player ordering rather than inventing one.
 * A single board keeps only the rows it can average, picks included, since a
 * column of em dashes answers nothing. Both boards keep everything, with the
 * primary column ordering what it prices and the rest following in the other
 * market's order. And an exact tie puts the **player** first, so a pick reads as
 * an annotation of the row above it — which is what it is, since the two carry
 * the same number for the same reason.
 */
export function adpBoardEntries(
  players: readonly AdpPlayerPayload[],
  picks: readonly AdpPickRow[],
  shown: AdpShownBoards,
): AdpBoardEntry[] {
  const primary: AdpBoardType = shown === "dynasty" ? "dynasty" : "redraft";
  const secondary: AdpBoardType = primary === "redraft" ? "dynasty" : "redraft";

  const playerEntries: AdpBoardEntry[] = adpBoardRows(players, shown).map(
    (player) => ({ kind: "player", key: player.player_id, player }),
  );

  const pickEntries: AdpBoardEntry[] = picks
    .map((pick): AdpBoardEntry => ({ kind: "pick", key: pick.key, pick }))
    .filter((entry) => shown === "both" || statsFor(entry, primary) !== null)
    .sort((a, b) => {
      const rank = compareEntries(a, b, primary, secondary);
      if (rank !== 0) return rank;
      // A total order, so two renders of one board can't disagree: a pick's key
      // spells its season, round and slot, which is the order it reads in.
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

  const merged: AdpBoardEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < playerEntries.length && j < pickEntries.length) {
    const rank = compareEntries(playerEntries[i], pickEntries[j], primary, secondary);
    // `<= 0` is the tie rule above: on an equal average the player leads.
    merged.push(rank <= 0 ? playerEntries[i++] : pickEntries[j++]);
  }
  while (i < playerEntries.length) merged.push(playerEntries[i++]);
  while (j < pickEntries.length) merged.push(pickEntries[j++]);
  return merged;
}

/**
 * Where one row sits against another: the primary board's average, then the
 * secondary's for the rows it has none on.
 *
 * The fallback matters only in both-boards mode, where a row the primary market
 * never priced — a rookie in redraft, and every pick standing on one — is kept
 * rather than dropped, and follows the priced rows in the other market's order
 * instead of being interleaved on numbers from two different markets.
 */
function compareEntries(
  a: AdpBoardEntry,
  b: AdpBoardEntry,
  primary: AdpBoardType,
  secondary: AdpBoardType,
): number {
  const first = statsFor(a, primary)?.adp ?? Number.POSITIVE_INFINITY;
  const second = statsFor(b, primary)?.adp ?? Number.POSITIVE_INFINITY;
  if (first !== second) return first - second;
  if (Number.isFinite(first)) return 0;
  const aTail = statsFor(a, secondary)?.adp ?? Number.POSITIVE_INFINITY;
  const bTail = statsFor(b, secondary)?.adp ?? Number.POSITIVE_INFINITY;
  return aTail === bTail ? 0 : aTail - bTail;
}

/**
 * Which of KTC's boards the drawer's discount ratio is read on.
 *
 * A board narrowed to 1QB drafts reads the 1QB board; everything else reads
 * superflex, which is what the crawled corpus overwhelmingly is. It matters far
 * less here than it does for a roster — this is a *ratio* between two rows of
 * one board, and the two boards move a future first by a few percent where they
 * move a quarterback's price by a third — but reading the one the reader has
 * asked for costs nothing.
 */
export function pickDiscountBoard(superflex: AdpControls["superflex"]): boolean {
  return superflex !== "no";
}

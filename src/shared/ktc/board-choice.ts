/**
 * Which of KeepTradeCut's two markets a league is priced on, and the one place
 * a reader's answer to that is turned into a league's.
 *
 * **The board is a choice rather than a derivation, and that is the point.**
 * KTC publishes a dynasty market and a redraft one; which is right for a
 * league is *usually* obvious from its type, but not always — a deep keeper
 * league trades like a dynasty, and somebody comparing a keeper league against
 * a dynasty one wants both on one scale rather than each on its own. So the
 * rule has three states, `auto` is the default, and the two forcing states are
 * the reason this takes a choice rather than reading `settings.type` and
 * stopping.
 *
 * Pure and free of runtime imports beyond the league-type constant, which
 * arrives relatively with a `.ts` extension. That is what lets **all four**
 * readers share it: the lineups route, the trades route, the manager page's
 * board keys and the trade card, two of which cannot see this folder's
 * server-only barrel and reach `@/shared/ktc/board-choice` directly, the way
 * they already reach `@/shared/ktc/roster`.
 */

import type {
  KtcBoardChoice,
  KtcFormat,
  KtcLineupChoice,
} from "@/shared/contract";

import { DYNASTY_LEAGUE_TYPE } from "../manager/draft-picks.ts";

/** In control order, `auto` first — what the board keys render. */
export const KTC_BOARD_CHOICES: readonly KtcBoardChoice[] = [
  "auto",
  "dynasty",
  "redraft",
];

/** The default: the rule, rather than either market. */
export const DEFAULT_KTC_BOARD: KtcBoardChoice = "auto";

/**
 * Fold anything — a query parameter, a stored string, a hand-edited value —
 * into a valid choice.
 *
 * **An unreadable value becomes `auto` rather than failing**, which is the
 * opposite call from `parseRequestedSeason` and is right for the opposite
 * reason. A season names *which data* a page is about, so `?season=abc` has to
 * 400 or a reader is shown one year under another's heading. A board names
 * which of two prices to print for data already chosen, and `auto` is the
 * neutral form of that question — the same reading `/api/trades` gives every
 * one of its narrowing parameters.
 */
export function parseKtcBoardChoice(value: unknown): KtcBoardChoice {
  return typeof value === "string" &&
    (KTC_BOARD_CHOICES as readonly string[]).includes(value)
    ? (value as KtcBoardChoice)
    : DEFAULT_KTC_BOARD;
}

/** In control order, `auto` first — what a bay's lineup track renders. */
export const KTC_LINEUP_CHOICES: readonly KtcLineupChoice[] = [
  "auto",
  "oneqb",
  "sf",
];

/** The default: the league's own lineup, rather than either board. */
export const DEFAULT_KTC_LINEUP: KtcLineupChoice = "auto";

/**
 * Fold anything into a valid QB-board choice, on
 * {@link parseKtcBoardChoice}'s exact terms — an unreadable value is `auto`,
 * because this too names which of two prices to print for data already chosen.
 *
 * The two axes are parsed by two functions rather than one generic over a list
 * because they are two vocabularies: a market is `dynasty`/`redraft` and a
 * lineup is `oneqb`/`sf`, and a single parser taking the valid set as an
 * argument is one call site away from validating a market against the lineup
 * list without anything failing.
 */
export function parseKtcLineupChoice(value: unknown): KtcLineupChoice {
  return typeof value === "string" &&
    (KTC_LINEUP_CHOICES as readonly string[]).includes(value)
    ? (value as KtcLineupChoice)
    : DEFAULT_KTC_LINEUP;
}

/**
 * The market one league reads, given what the reader asked for.
 *
 * Under `auto`, a dynasty league reads the dynasty board and **everything else
 * reads redraft** — keeper, chopped and redraft alike. Keeper is the arguable
 * one and it falls this way deliberately: KTC has no keeper market, the two it
 * has differ by how much a rookie stash is worth, and a keeper league that
 * carries one or two players is far closer to a redraft than to a dynasty. A
 * reader who disagrees has the forcing states, which is what they are for.
 *
 * `leagueType` is Sleeper's `settings.type` — 0 redraft, 1 keeper, 2 dynasty,
 * 3 chopped — read off {@link DYNASTY_LEAGUE_TYPE} rather than spelled, so the
 * pick grid and this cannot come to disagree about what "dynasty" means.
 */
export function resolveKtcFormat(
  choice: KtcBoardChoice,
  leagueType: number | null,
): KtcFormat {
  if (choice !== "auto") return choice;
  return leagueType === DYNASTY_LEAGUE_TYPE ? "dynasty" : "redraft";
}

/**
 * The market a number spanning *many* leagues is read on.
 *
 * A second function rather than a `null` league type through {@link
 * resolveKtcFormat}, because it is a different rule and not a degenerate case
 * of that one: there, `auto` means "each league on the board its own type
 * implies", and the question only has an answer per league. The shares drawer's
 * Value column is one figure for a player held across a dozen leagues, so there
 * is no league to resolve against — and the two candidate readings, "the board
 * most of them imply" and "one board, named", are not the same kind of answer.
 *
 * **`auto` reads dynasty here.** It is the board carrying rookie-pick rows, and
 * the one a cross-league comparison implies: somebody looking at a player they
 * hold in nine leagues is asking what he is worth to hold, which is the dynasty
 * question. The forcing states still force, which is what they are for — a
 * reader whose account is all redraft says so once and every panel follows.
 *
 * What must never happen is the third option: averaging the two markets. Three
 * figures on three scales never share a column, and a pooled read is *wrong*
 * rather than differently weighted — see the ADP board split for the same bug
 * with the same shape.
 */
export function resolveKtcCrossLeagueFormat(
  choice: KtcBoardChoice,
): KtcFormat {
  return choice === "auto" ? "dynasty" : choice;
}

/**
 * Which KeepTradeCut market a number was read on.
 *
 * Types only, like everything in `contract/` — and this pair in particular has
 * to be here rather than in `shared/ktc`, because that barrel is server-only
 * (it reaches Postgres) and both names are spoken on the client: the board keys
 * write a choice, the payloads echo the format that answered.
 */

/**
 * One of KTC's two markets. A row in `ktc_values` belongs to exactly one of
 * them — `playerID` is per-board, so a dynasty row and a redraft row are two
 * markets rather than two readings of one — which is why every read of that
 * table takes this.
 */
export type KtcFormat = "dynasty" | "redraft";

/**
 * What a reader has asked for, which is one state wider than what a league
 * ends up reading.
 *
 * `auto` is the default and is not a fourth market: it is the rule that a
 * dynasty league reads the dynasty board and everything else reads redraft, so
 * a mixed account is right without being touched. The other two force one
 * board across every league on the page, which is what someone comparing a
 * keeper league to a dynasty one on one scale wants. `resolveKtcFormat`
 * (`features/shared/ktc-board`) is the one place that rule is spelled.
 */
export type KtcBoardChoice = "auto" | KtcFormat;

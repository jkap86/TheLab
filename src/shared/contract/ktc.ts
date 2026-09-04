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

/**
 * Which of a market's two QB boards a column reads, one state wider than the
 * league's own answer.
 *
 * The second axis a KeepTradeCut column carries. `auto` is the rule — a league
 * starting more than one quarterback reads superflex prices and everything
 * else reads 1QB — and it is what every column opens on, because that rule is
 * right for a league without anybody being asked. The two forcing states are
 * for the reader comparing a 1QB league against a superflex one on one scale,
 * which is the same argument {@link KtcBoardChoice}'s forcing states make one
 * axis over. `resolveKtcLineup` (`shared/ktc/roster`) is where the rule lives,
 * beside the predicate it defers to.
 */
export type KtcLineupChoice = "auto" | "oneqb" | "sf";

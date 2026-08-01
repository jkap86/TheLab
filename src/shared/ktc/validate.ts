import type { KtcPlayer } from "./types";

/**
 * Whether a scraped KTC board is complete enough to reconcile the stored one
 * against.
 *
 * The sync's reconciliation is destructive by design: every stored player *not*
 * in the response has their values nulled, because KTC's top-~500 churns and a
 * player who fell off would otherwise keep his last price forever. That is right
 * when the response is the board. It is catastrophic when the response is a
 * fragment — a markup change the parser half-understands, an anti-bot page with
 * a handful of plausible entries, a truncated body — because a 17-player
 * "board" nulls the other 480 and stamps them fresh.
 *
 * The existing guard is `players.length > 0`, which every one of those cases
 * passes. So: validate first, refuse to write at all when the response doesn't
 * look like a board, and say why. Preserving stale prices costs one 15-minute
 * cycle; nulling the board costs every roster valuation in the app until someone
 * notices.
 *
 * Pure and tested, like its neighbours `parse` and `match`.
 */

/**
 * Fewest valid players a response must carry to be treated as a board.
 *
 * KTC prices ~500 dynasty skill players and that number moves slowly (rookies
 * in, retirements out), so a real board has never been anywhere near this low.
 * Set well under the true size rather than near it: this is the floor that
 * catches a fragment, and the shrink check below is what catches a response
 * that is merely *short*.
 */
export const KTC_MIN_PLAYERS = 300;

/**
 * How much the board may shrink against the last stored one before the response
 * is refused, as a fraction.
 *
 * A real refresh moves by a handful of players. 15% is far outside that and far
 * inside a partial page, which is the gap this needs to sit in — tight enough
 * to catch a half-parsed response, loose enough that a genuine cull (a scoring
 * era change, KTC trimming its board) doesn't wedge the sync permanently.
 */
export const KTC_MAX_SHRINK = 0.15;

/**
 * How many duplicate ids a response may carry, as a fraction of its entries.
 *
 * A board has one entry per player. Duplicates mean the parser matched the
 * wrong literal or the page repeats a template — either way the unique count is
 * not what it looks like, and a response that is 60% repeats of one player would
 * otherwise sail through a plain length check.
 */
export const KTC_MAX_DUPLICATE_FRACTION = 0.05;

export type KtcValidation =
  | {
      ok: true;
      /** Deduplicated, valid players — what the sync should write. */
      players: KtcPlayer[];
      /** Entries dropped as invalid or duplicated. */
      rejected: number;
      previous: number;
    }
  | {
      ok: false;
      reason: string;
      valid: number;
      rejected: number;
      previous: number;
    };

/** A usable board row: a real id, a name, and a price on at least one board. */
function isValid(player: KtcPlayer): boolean {
  if (typeof player?.playerID !== "number" || !Number.isFinite(player.playerID)) {
    return false;
  }
  if (typeof player.playerName !== "string" || player.playerName.trim() === "") {
    return false;
  }
  const sf = player.superflexValues?.value;
  const oneqb = player.oneQBValues?.value;
  return typeof sf === "number" || typeof oneqb === "number";
}

/**
 * Validate a scraped board against the last stored one.
 *
 * `previous` is how many players currently carry a price. **Zero means first
 * sync** — there is nothing to shrink against, so only the absolute floor
 * applies; that is what lets an empty database bootstrap without an operator
 * having to disable the guard.
 */
export function validateKtcBoard(
  players: readonly KtcPlayer[],
  previous: number,
): KtcValidation {
  const valid = players.filter(isValid);

  const byId = new Map<number, KtcPlayer>();
  for (const player of valid) byId.set(player.playerID as number, player);

  const unique = [...byId.values()];
  const duplicates = valid.length - unique.length;
  const rejected = players.length - unique.length;

  if (unique.length === 0) {
    return {
      ok: false,
      reason: "response contained no valid player records",
      valid: 0,
      rejected,
      previous,
    };
  }

  if (
    valid.length > 0 &&
    duplicates / valid.length > KTC_MAX_DUPLICATE_FRACTION
  ) {
    return {
      ok: false,
      reason:
        `${duplicates} duplicate id(s) in ${valid.length} valid entries ` +
        `exceeds ${pct(KTC_MAX_DUPLICATE_FRACTION)}`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (unique.length < KTC_MIN_PLAYERS) {
    return {
      ok: false,
      reason: `only ${unique.length} valid player(s), below the ${KTC_MIN_PLAYERS} minimum`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (previous > 0 && unique.length < previous * (1 - KTC_MAX_SHRINK)) {
    return {
      ok: false,
      reason:
        `${unique.length} valid player(s) is more than ${pct(KTC_MAX_SHRINK)} ` +
        `below the ${previous} stored`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  return { ok: true, players: unique, rejected, previous };
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

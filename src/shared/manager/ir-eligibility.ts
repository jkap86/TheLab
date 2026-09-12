/**
 * Injured reserve, on the league's own rules: who may sit on IR, and who on the
 * active roster could.
 *
 * Sleeper enforces IR by a player's `injury_status` against six per-league
 * toggles, and refuses every transaction on a roster carrying a player it
 * would not admit — so "is IR set right" is a question about *designations*,
 * and the census's count of IR seats cannot answer it. This module is that
 * question, pure: the league's settings blob, the live roster's three id lists
 * and the stored players map in, the wire's `LineupCheckIr` out. Runtime
 * imports are relative with `.ts` for the usual reason — Node's test runner
 * strips types but doesn't know the `@/*` aliases — and the contract arrives as
 * `import type`, which is erased.
 *
 * **Three decisions carry it, and each renders perfectly when it is wrong.**
 *
 * - **`IR` and `PUP` are always eligible and the rest are toggles.** Sleeper
 *   writes each toggle as a `0`/`1` int and omits nothing on a league it has
 *   seen, so an absent key reads as *not allowed*; `Questionable` is never a
 *   designation any toggle admits. `settings === null` is a league whose rules
 *   were never read, and the reading is null rather than a guess.
 * - **A designation this build does not know is "could not say"**, never a
 *   claim either way. `irEligible` matches exactly — a case variant or a new
 *   spelling from Sleeper comes back `null`, is left out of both lists, and is
 *   counted so the tile can say how many players it did not judge. Reading an
 *   unknown word as "not eligible" would name a player ineligible on the
 *   strength of a spelling.
 * - **Healthy is not eligible.** A null or empty `injury_status` is Sleeper's
 *   own spelling of a fit player, and a fit player on IR is exactly the case the
 *   check exists to catch — so it answers `false`, not `null`, and the tile
 *   names him. What *is* `null` is an id the map has no row for at all: the
 *   sync has not seen him, and absence is not evidence of health.
 *
 * The fold never learns `ir_max`. `stashable` is a fact about designations —
 * who the league *would* admit — and how many of them there is room for is
 * arithmetic the tile does against the census beside it (`irMoves`, on the
 * client), so a league with no IR slots at all simply has nowhere to put them.
 */

import type { LineupCheckIr, LineupCheckIrPlayer } from "@/shared/contract";

/** One row of the stored players map, as this module reads it. */
export type PlayerStatus = {
  /** Sleeper's `full_name`; null for a team defence. */
  name: string | null;
  /** Sleeper's `injury_status`; null is healthy. */
  injury_status: string | null;
};

/**
 * Injury designations keyed by Sleeper id. **An absent id is unknown**, never
 * healthy — see the module note. `null` at the call site means the read itself
 * failed, which is a different absence again and nulls the whole reading.
 */
export type PlayerStatusMap = Readonly<Record<string, PlayerStatus>>;

/**
 * The live roster's three arrays with Sleeper's padding dropped and each id
 * counted once — `realIds`' output, and the same three sets the census counts
 * from, so the eligibility lists and `ir_count` cannot name different players.
 */
export type RosterIds = {
  held: readonly string[];
  reserve: readonly string[];
  taxi: readonly string[];
};

/** Designations every league admits on IR, whatever its toggles say. */
export const IR_ALWAYS: readonly string[] = ["IR", "PUP"];

/** Designations no league admits: Sleeper offers no toggle for them. */
export const IR_NEVER: readonly string[] = ["Questionable"];

/** Sleeper's six IR toggles, each naming the one designation it admits. */
export const IR_TOGGLES: readonly { key: string; status: string }[] = [
  { key: "reserve_allow_out", status: "Out" },
  { key: "reserve_allow_doubtful", status: "Doubtful" },
  { key: "reserve_allow_sus", status: "Sus" },
  { key: "reserve_allow_na", status: "NA" },
  { key: "reserve_allow_cov", status: "COV" },
  { key: "reserve_allow_dnr", status: "DNR" },
];

/** Every designation this build can judge; anything else is "could not say". */
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  ...IR_ALWAYS,
  ...IR_NEVER,
  ...IR_TOGGLES.map((toggle) => toggle.status),
]);

/**
 * The designations this league admits on IR, or null where its settings were
 * never read.
 *
 * A toggle is on at `1` or `"1"` and off at anything else — the sibling of
 * `settingCount`'s reading of a count: Sleeper writes an int and a digit string
 * is the only other spelling it has been seen to use. A `true`, a `"yes"` or an
 * absent key is *not allowed*, which is the reading that suggests fewer moves
 * rather than more.
 */
export function irAllowedStatuses(
  settings: Record<string, unknown> | null,
): ReadonlySet<string> | null {
  if (settings === null) return null;
  const allowed = new Set(IR_ALWAYS);
  for (const { key, status } of IR_TOGGLES) {
    if (settingFlag(settings[key])) allowed.add(status);
  }
  return allowed;
}

function settingFlag(raw: unknown): boolean {
  return raw === 1 || raw === "1";
}

/**
 * Whether a designation may sit on IR under `allowed` — `false` for healthy and
 * for a designation the league does not admit, `null` for one this build does
 * not know. Exact match, deliberately: see the module note.
 */
export function irEligible(
  status: string | null,
  allowed: ReadonlySet<string>,
): boolean | null {
  if (status === null || status === "") return false;
  if (allowed.has(status)) return true;
  if (KNOWN_STATUSES.has(status)) return false;
  return null;
}

/**
 * The IR reading for one league: everyone on IR with whether each may stay,
 * everyone on the active roster the league would admit, and how many players
 * could not be judged.
 *
 * Null where the rules are unknown (`settings` null) or the statuses could not
 * be read at all (`statuses` null). An **empty** map is neither: it is a
 * players table nobody has synced, every id comes back unknown, and the tile
 * says so rather than reading as "nothing to do".
 *
 * `active` is the held roster less IR less taxi: a taxi player is not a
 * candidate for IR (the request's own rule — Sleeper moves him through the
 * active roster first), and a player Sleeper lists on both `reserve` and
 * `taxi` is judged as an IR player and never offered as a stash. Names come
 * off the board first, since that is the name every other row on the card
 * prints, then the map, then null — never the id, which the tile falls back to
 * itself.
 */
export function irReading(
  ids: RosterIds,
  settings: Record<string, unknown> | null,
  statuses: PlayerStatusMap | null,
  board: Readonly<Record<string, { name: string | null } | undefined>>,
): LineupCheckIr | null {
  const allowed = irAllowedStatuses(settings);
  if (allowed === null || statuses === null) return null;

  const reserveIds = new Set(ids.reserve);
  const taxiIds = new Set(ids.taxi);

  const judge = (id: string): LineupCheckIrPlayer => {
    const row = statuses[id];
    const status = row ? row.injury_status : null;
    return {
      player_id: id,
      name: board[id]?.name ?? row?.name ?? null,
      status,
      eligible: row ? irEligible(status, allowed) : null,
    };
  };

  const reserve = ids.reserve.map(judge);
  const active = ids.held
    .filter((id) => !reserveIds.has(id) && !taxiIds.has(id))
    .map(judge);

  return {
    reserve,
    stashable: active.filter((player) => player.eligible === true),
    unknown:
      reserve.filter((player) => player.eligible === null).length +
      active.filter((player) => player.eligible === null).length,
  };
}

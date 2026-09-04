/**
 * Cross-source name matching between KeepTradeCut and Sleeper.
 *
 * **KTC publishes no Sleeper id and Sleeper carries none of KTC's**, so the
 * only bridge between a scraped board and a rostered player is the name — and
 * `ktc_values.sleeper_id`, which every read in this folder joins on, is written
 * from nothing else. That is why this module exists and why it is the
 * prerequisite for pricing anything: without it the table is 897 rows nothing
 * can reach.
 *
 * Pure by design — the caller supplies both sides — so the matching rules test
 * directly. Reading the cached Sleeper players belongs to `@/shared/players`,
 * which owns that table; the type comes in `import type` so this file keeps no
 * runtime edge to a `pg`-backed module.
 *
 * Ported from TheLabX whole. The one thing to know that is this repo's own:
 * **`playerID` is per-board here**, so the resolution runs once per format and
 * the same Sleeper player is legitimately reached from two rows — which is
 * exactly what `./values` folds back together at read time.
 */

import type { MatchablePlayer } from "@/shared/players";

import type { KtcPlayer } from "./types";

/**
 * Normalize a player name for cross-source matching: lowercase, strip accents,
 * drop punctuation and generational suffixes (Jr/Sr/II/III/…), collapse spaces.
 * So "Ja'Marr Chase" and "Amon-Ra St. Brown Jr." reduce to stable keys.
 */
export function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/[.'`,]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * KTC's position names for the two Sleeper spells differently.
 *
 * **This repo's own addition, and it exists because this repo scrapes the
 * redraft board.** TheLabX only ever read the dynasty one, which carries
 * neither a kicker nor a defence, so its matcher never met these — here they
 * were 70 of the 71 unmatched redraft entries on the day this landed, which is
 * two of the ten seats a redraft lineup fills going unpriced.
 *
 * A rename rather than a fallback tier: the position is half of every lookup
 * key, so the two vocabularies have to agree *before* the key is built. The
 * names line up on both sides once they do — Sleeper stores a defence's
 * `first_name`/`last_name` as "Philadelphia" / "Eagles", which normalizes to
 * exactly what KTC calls it.
 */
const KTC_POSITIONS: Record<string, string> = { PK: "K", DST: "DEF" };

const lastToken = (normalized: string): string => {
  const parts = normalized.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

/** Birth year from a KTC `birthday` (unix seconds, string or number). */
function ktcBirthYear(birthday: unknown): number | null {
  const n =
    typeof birthday === "string" ? Number(birthday) : (birthday as number);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).getUTCFullYear();
}

/** Of several same-name candidates, the one clearly current player, else null. */
function pickActive(cands: MatchablePlayer[]): MatchablePlayer | null {
  const active = cands.filter((c) => c.active);
  if (active.length === 1) return active[0];
  const teamed = cands.filter((c) => c.team);
  if (teamed.length === 1) return teamed[0];
  return null;
}

/** The two lookup indexes the matching tiers below search. */
function indexPlayers(players: readonly MatchablePlayer[]) {
  const byNamePos = new Map<string, MatchablePlayer[]>();
  const byLastPosYear = new Map<string, MatchablePlayer[]>();

  const push = (
    m: Map<string, MatchablePlayer[]>,
    k: string,
    r: MatchablePlayer,
  ) => {
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };

  for (const r of players) {
    const name =
      r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" ");
    const nn = normalizeName(name);
    if (!nn || !r.position) continue;
    push(byNamePos, `${nn}|${r.position}`, r);
    if (r.birth_year != null) {
      push(byLastPosYear, `${lastToken(nn)}|${r.position}|${r.birth_year}`, r);
    }
  }

  return { byNamePos, byLastPosYear };
}

/**
 * Resolve KTC entries to Sleeper `player_id`s.
 *
 * Sleeper's map doesn't carry KTC's only external id (`mflid`), so we match by
 * name in three tiers, most precise first:
 *   0. KTC's position renamed to Sleeper's where the two differ — see
 *      {@link KTC_POSITIONS}; every tier below keys on the result
 *   1. exact normalized full name + position (unique hit)
 *   2. same, breaking collisions to the single active/rostered player
 *   3. normalized last name + position + birth year — recovers nickname diffs
 *      ("Gabe" vs "Gabriel", "Chig" vs "Chigoziem", "Bam" vs "Zonovan")
 * Anything still ambiguous is left unresolved rather than guessed, so a null
 * `sleeper_id` is honest ("no confident match"), never a wrong player.
 *
 * A pick row resolves to nothing by construction and that is correct: KTC's
 * `RDP` entries are not players anywhere in Sleeper's map, which is why
 * `getKtcPickBoard` reaches them by position instead.
 *
 * Returns a map of KTC `playerID` -> Sleeper `player_id` for resolved entries
 * only. An empty `sleeperPlayers` yields an empty map (all null).
 */
export function resolveSleeperIds(
  ktcPlayers: readonly KtcPlayer[],
  sleeperPlayers: readonly MatchablePlayer[],
): Map<number, string> {
  const { byNamePos, byLastPosYear } = indexPlayers(sleeperPlayers);

  const out = new Map<number, string>();
  for (const p of ktcPlayers) {
    if (typeof p.playerID !== "number") continue;
    const nn = normalizeName(p.playerName);
    const position = KTC_POSITIONS[p.position] ?? p.position;
    let match: MatchablePlayer | null = null;

    // Tier 1/2: normalized full name + position.
    const cands = byNamePos.get(`${nn}|${position}`);
    if (cands) match = cands.length === 1 ? cands[0] : pickActive(cands);

    // Tier 3: last name + position + birth year (nickname mismatches).
    if (!match) {
      const year = ktcBirthYear(p.birthday);
      if (year != null) {
        const lc = byLastPosYear.get(`${lastToken(nn)}|${position}|${year}`);
        if (lc) match = lc.length === 1 ? lc[0] : pickActive(lc);
      }
    }

    if (match) out.set(p.playerID, match.player_id);
  }
  return out;
}

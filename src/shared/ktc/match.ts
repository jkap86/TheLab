import type { MatchablePlayer } from "@/shared/players";

import type { KtcPlayer } from "./types";

/**
 * Cross-source name matching between KeepTradeCut and Sleeper.
 *
 * Pure by design — the caller supplies both sides — so the matching rules can
 * be tested directly. Reading the cached Sleeper players belongs to
 * `@/shared/players`, which owns that table.
 */

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

const lastToken = (normalized: string): string => {
  const parts = normalized.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

/** Birth year from a KTC `birthday` (unix seconds, string or number). */
function ktcBirthYear(birthday: unknown): number | null {
  const n = typeof birthday === "string" ? Number(birthday) : (birthday as number);
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
 *   1. exact normalized full name + position (unique hit)
 *   2. same, breaking collisions to the single active/rostered player
 *   3. normalized last name + position + birth year — recovers nickname diffs
 *      ("Gabe" vs "Gabriel", "Chig" vs "Chigoziem", "Bam" vs "Zonovan")
 * Anything still ambiguous is left unresolved rather than guessed, so a null
 * `sleeper_id` is honest ("no confident match"), never a wrong player.
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
    let match: MatchablePlayer | null = null;

    // Tier 1/2: normalized full name + position.
    const cands = byNamePos.get(`${nn}|${p.position}`);
    if (cands) match = cands.length === 1 ? cands[0] : pickActive(cands);

    // Tier 3: last name + position + birth year (nickname mismatches).
    if (!match) {
      const year = ktcBirthYear(p.birthday);
      if (year != null) {
        const lc = byLastPosYear.get(`${lastToken(nn)}|${p.position}|${year}`);
        if (lc) match = lc.length === 1 ? lc[0] : pickActive(lc);
      }
    }

    if (match) out.set(p.playerID, match.player_id);
  }
  return out;
}

import { pool } from "@/shared/db";

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

type SleeperRow = {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  active: boolean | null;
  birth_year: number | null;
};

/** Of several same-name candidates, the one clearly current player, else null. */
function pickActive(cands: SleeperRow[]): SleeperRow | null {
  const active = cands.filter((c) => c.active);
  if (active.length === 1) return active[0];
  const teamed = cands.filter((c) => c.team);
  if (teamed.length === 1) return teamed[0];
  return null;
}

/**
 * Resolve KTC entries to Sleeper `player_id`s using the cached `players` table.
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
 * only. When the `players` cache is empty the map is empty (all null).
 */
export async function resolveSleeperIds(
  players: KtcPlayer[],
): Promise<Map<number, string>> {
  const { rows } = await pool.query<SleeperRow>(
    `SELECT player_id, full_name, first_name, last_name, position, team,
            (data->>'active')::boolean AS active,
            NULLIF(left(data->>'birth_date', 4), '')::int AS birth_year
       FROM players
      WHERE position IS NOT NULL`,
  );

  const byNamePos = new Map<string, SleeperRow[]>();
  const byLastPosYear = new Map<string, SleeperRow[]>();
  const push = (m: Map<string, SleeperRow[]>, k: string, r: SleeperRow) => {
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };

  for (const r of rows) {
    const name =
      r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" ");
    const nn = normalizeName(name);
    if (!nn || !r.position) continue;
    push(byNamePos, `${nn}|${r.position}`, r);
    if (r.birth_year != null) {
      push(byLastPosYear, `${lastToken(nn)}|${r.position}|${r.birth_year}`, r);
    }
  }

  const out = new Map<number, string>();
  for (const p of players) {
    if (typeof p.playerID !== "number") continue;
    const nn = normalizeName(p.playerName);
    let match: SleeperRow | null = null;

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

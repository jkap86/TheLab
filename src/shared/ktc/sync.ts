import { bulkInsert, jsonb as j, pool } from "@/shared/db";
import { ensurePlayersFresh } from "@/shared/players";

import { fetchKtcDynastyRankings } from "./client";
import { resolveSleeperIds } from "./match";

/** How long scraped KTC values stay fresh; matches the 15-min refresh cadence. */
export const KTC_TTL_MS = 15 * 60 * 1000;

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

export type KtcSyncSummary = { skipped: boolean; count: number };

async function ktcIsFresh(): Promise<boolean> {
  const { rows } = await pool.query<{ max: Date | null }>(
    `SELECT max(updated_at) AS max FROM ktc_values`,
  );
  const max = rows[0]?.max;
  return max != null && Date.now() - max.getTime() < KTC_TTL_MS;
}

/**
 * Scrape KeepTradeCut dynasty values and upsert them into `ktc_values`. Skips
 * the scrape when the cache is still fresh unless `force` is set. Upserts in
 * chunks inside one transaction so readers never observe a partial set.
 */
export async function syncKtcValues(
  options: { force?: boolean } = {},
): Promise<KtcSyncSummary> {
  if (!options.force && (await ktcIsFresh())) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ktc_values`,
    );
    return { skipped: true, count: Number(rows[0].count) };
  }

  const players = await fetchKtcDynastyRankings();

  // Resolve KTC entries to Sleeper player_ids from the cached players map.
  // Best-effort: make sure that cache exists first, but never let a players
  // refresh failure block KTC values from updating (ids just stay null).
  try {
    await ensurePlayersFresh();
  } catch (error) {
    console.warn("[ktc] Players cache refresh failed; sleeper_id may be null:", error);
  }
  const sleeperIds = await resolveSleeperIds(players);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await bulkInsert(client, {
      table: "ktc_values",
      columns: [
        "ktc_id", "sleeper_id", "player_name", "slug", "position", "team",
        "rookie", "age", "sf_value", "sf_rank", "sf_position_rank",
        "oneqb_value", "oneqb_rank", "oneqb_position_rank", "data",
      ],
      rows: players,
      values: (p) => [
        int(p.playerID), sleeperIds.get(p.playerID) ?? null,
        p.playerName ?? null, p.slug ?? null, p.position ?? null,
        p.team || null, Boolean(p.rookie),
        typeof p.age === "number" ? p.age : null,
        int(p.superflexValues?.value), int(p.superflexValues?.rank),
        int(p.superflexValues?.positionalRank),
        int(p.oneQBValues?.value), int(p.oneQBValues?.rank),
        int(p.oneQBValues?.positionalRank), j(p),
      ],
      trailing: { column: "updated_at", sql: "now()" },
      onConflict: `(ktc_id) DO UPDATE SET
          sleeper_id = EXCLUDED.sleeper_id, player_name = EXCLUDED.player_name,
          slug = EXCLUDED.slug, position = EXCLUDED.position,
          team = EXCLUDED.team, rookie = EXCLUDED.rookie, age = EXCLUDED.age,
          sf_value = EXCLUDED.sf_value, sf_rank = EXCLUDED.sf_rank,
          sf_position_rank = EXCLUDED.sf_position_rank,
          oneqb_value = EXCLUDED.oneqb_value, oneqb_rank = EXCLUDED.oneqb_rank,
          oneqb_position_rank = EXCLUDED.oneqb_position_rank,
          data = EXCLUDED.data, updated_at = now()`,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { skipped: false, count: players.length };
}

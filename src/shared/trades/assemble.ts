import type { Trade, TradePickAsset, TradeSide } from "./types.ts";

/**
 * One `transactions` row as the trades query reads it. The JSONB columns arrive
 * as parsed JavaScript, but Sleeper doesn't promise their shapes and a league
 * from a decade of roster moves has some odd ones on file, so everything below
 * the top level is `unknown` and read defensively.
 *
 * `created`/`status_updated` are `BIGINT` and so come back from `pg` as strings;
 * the query casts them, which is why they are numbers here.
 */
export type TradeRow = {
  transaction_id: string;
  league_id: string;
  week: number | null;
  created: number | null;
  status_updated: number | null;
  roster_ids: unknown;
  adds: unknown;
  draft_picks: unknown;
  waiver_budget: unknown;
};

/**
 * Turn one stored transaction into a trade with sides.
 *
 * Sides are built from `roster_ids` rather than from the assets, so a roster
 * that only *gave* things up still appears — that happens in the three-way
 * trades some leagues run, where a team can send a player one way and take
 * nothing back from that participant. Every side then collects what it received,
 * because what it gave up is exactly what the other sides received and storing
 * both halves is one edit away from them disagreeing.
 *
 * `owners` maps roster id → user id for the trade's league. A roster missing
 * from it (uncached rosters, an orphan team) yields a null `user_id` rather than
 * dropping the side: a trade with an unnamed participant is still a trade, and
 * hiding it would silently shorten the list.
 */
export function assembleTrade(
  row: TradeRow,
  owners: ReadonlyMap<number, string>,
): Trade {
  const byRoster = new Map<number, TradeSide>();
  const side = (rosterId: number): TradeSide => {
    let existing = byRoster.get(rosterId);
    if (!existing) {
      existing = {
        roster_id: rosterId,
        user_id: owners.get(rosterId) ?? null,
        players: [],
        picks: [],
        faab: 0,
      };
      byRoster.set(rosterId, existing);
    }
    return existing;
  };

  for (const rosterId of numbers(row.roster_ids)) side(rosterId);

  // `adds` is player id → the roster that received them, which is the whole
  // player half of a trade; `drops` is its mirror and carries nothing extra.
  if (isRecord(row.adds)) {
    for (const [playerId, rosterId] of Object.entries(row.adds)) {
      const roster = asNumber(rosterId);
      if (roster !== null) side(roster).players.push(playerId);
    }
  }

  for (const raw of items(row.draft_picks)) {
    if (!isRecord(raw)) continue;
    const owner = asNumber(raw.owner_id);
    const round = asNumber(raw.round);
    const original = asNumber(raw.roster_id);
    if (owner === null || round === null || original === null) continue;
    const pick: TradePickAsset = {
      season: String(raw.season ?? ""),
      round,
      roster_id: original,
    };
    side(owner).picks.push(pick);
  }

  for (const raw of items(row.waiver_budget)) {
    if (!isRecord(raw)) continue;
    const receiver = asNumber(raw.receiver);
    const amount = asNumber(raw.amount);
    if (receiver === null || amount === null) continue;
    side(receiver).faab += amount;
  }

  const sides = [...byRoster.values()].sort(
    (a, b) => a.roster_id - b.roster_id,
  );
  for (const s of sides) {
    s.picks.sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
  }

  return {
    transaction_id: row.transaction_id,
    league_id: row.league_id,
    week: row.week,
    // A trade that sat pending is filed under when it went through, not when it
    // was offered — the date a reader is scanning for.
    completed_at: row.status_updated ?? row.created,
    sides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Sleeper sends roster ids as numbers, but has been seen to send strings. */
function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function numbers(value: unknown): number[] {
  return items(value)
    .map(asNumber)
    .filter((n): n is number => n !== null);
}

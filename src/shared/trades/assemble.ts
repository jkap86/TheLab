import type { Trade, TradePickAsset, TradeSide } from "@/shared/contract";

import { asNumber, isRecord, items, numbers } from "./jsonb.ts";

/**
 * One `transactions` row as the trades query reads it. The JSONB columns arrive
 * as parsed JavaScript, but Sleeper doesn't promise their shapes and a league
 * from a decade of roster moves has some odd ones on file, so everything below
 * the top level is `unknown` and read defensively.
 *
 * `created`/`status_updated` are `BIGINT` and so come back from `pg` as
 * strings; the query casts them, which is why they are numbers here.
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
  /**
   * Roster id → the user who held it when this app first observed the trade,
   * as `TRADE_PARTICIPANT_OWNERS_SQL` aggregates it. Null for a trade with no
   * stored participant rows, and read defensively like every other jsonb here.
   *
   * It is on the row rather than fetched beside the page because it is a
   * primary-key lookup per returned trade and a second read would be a second
   * pooled connection — see that fragment.
   */
  participant_owners?: unknown;
};

/**
 * Turn one stored transaction into a trade with sides.
 *
 * Sides are built from `roster_ids` rather than from the assets, so a roster
 * that only *gave* things up still appears — that happens in the three-way
 * trades some leagues run, where a team can send a player one way and take
 * nothing back from that participant. Every side then collects what it
 * received, because what it gave up is exactly what the other sides received
 * and storing both halves is one edit away from them disagreeing.
 *
 * `owners` maps roster id → user id for the trade's league, **as it stands
 * today**. A roster missing from it (unstored rosters, an orphan team) yields a
 * null `user_id` rather than dropping the side: a trade with an unnamed
 * participant is still a trade, and hiding it would silently shorten the list.
 *
 * **Who a side *was* wins over who holds that roster now**, which is the whole
 * of {@link historicalOwners}. A trade is a thing two people did, and labelling
 * it with whoever inherited the seat afterwards is not a stale answer but a
 * wrong one — the reader is shown a card saying somebody made a trade they
 * never made. `trade_participants.owner_id_at_trade` is the snapshot, taken
 * when the app first observed the trade and immutable after (see
 * `tradeParticipantsRebuildSql`), and today's owner is the fallback for the one
 * case it cannot cover: a roster that had no owner when the trade was first
 * stored, or a trade whose participant rows predate the column.
 */
export function assembleTrade(
  row: TradeRow,
  owners: ReadonlyMap<number, string>,
): Trade {
  // Who held each roster *then*. Falls back to `owners` per roster rather than
  // wholesale, so a trade the snapshot covers partly is still named as far as
  // it goes.
  const then = historicalOwners(row.participant_owners);

  const byRoster = new Map<number, TradeSide>();
  const side = (rosterId: number): TradeSide => {
    let existing = byRoster.get(rosterId);
    if (!existing) {
      existing = {
        roster_id: rosterId,
        user_id: then.get(rosterId) ?? owners.get(rosterId) ?? null,
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
      // Resolved from the league's whole map rather than from the trade's own
      // sides: the pick worth naming an owner for is the one that came from a
      // roster that isn't in this trade — see {@link TradePickAsset.user_id}.
      //
      // **The snapshot is preferred and usually cannot answer**, which is worth
      // being explicit about rather than leaving as an accident of ordering.
      // `then` covers the rosters this trade *names*, and the pick that earns an
      // origin on the card is precisely the one that came from a roster which is
      // not a party to it — so this normally falls through to today's owner.
      // That is the honest reading available: Sleeper stores no history of who
      // held a roster, so an origin outside the trade can only ever be "the
      // roster this pick belongs to, held today by X". What the preference does
      // buy is the case that *is* answerable — a pick originating with one of
      // the trading rosters — where inferring the trader from today's owner is
      // exactly the mistake this column exists to stop.
      user_id: then.get(original) ?? owners.get(original) ?? null,
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

  const sides = [...byRoster.values()].sort((a, b) => a.roster_id - b.roster_id);
  for (const s of sides) {
    s.picks.sort(
      (a, b) => a.season.localeCompare(b.season) || a.round - b.round,
    );
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

/**
 * The stored snapshot of who held each roster when the trade was first
 * observed, read out of the aggregated jsonb.
 *
 * Read as defensively as every other column here, and for a reason of its own
 * on top of the usual: this object is built by `jsonb_object_agg` over a text
 * cast of an integer, so the keys are digit strings and the values are user
 * ids — but the column is untyped, a league synced before the table existed has
 * no rows at all, and an entry whose owner is somehow null is not a person to
 * name. Anything that is not a digit key over a non-empty string is skipped,
 * which lands on the same fallback an absent trade does: today's owner.
 *
 * An empty map is the honest answer for "nothing known", and every caller reads
 * it as a lookup that misses rather than as a claim.
 */
function historicalOwners(raw: unknown): ReadonlyMap<number, string> {
  if (!isRecord(raw)) return NO_OWNERS;

  const owners = new Map<number, string>();
  for (const [rosterId, userId] of Object.entries(raw)) {
    const roster = asNumber(rosterId);
    if (roster === null) continue;
    if (typeof userId !== "string" || userId === "") continue;
    owners.set(roster, userId);
  }
  return owners;
}

/** Shared so the common "no snapshot" path allocates nothing. */
const NO_OWNERS: ReadonlyMap<number, string> = new Map();

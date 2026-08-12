import { asNumber, isRecord, items, numbers } from "./jsonb.ts";

/**
 * What each side of a trade held immediately before it, reconstructed by
 * replaying a league's later transactions backwards.
 *
 * **Sleeper stores no history.** `rosters` is only ever *now*, and there is no
 * endpoint that answers "what did this team look like in October". What there
 * is, is the whole transaction log — every add, every drop, every pick that
 * changed hands — so the state at any past moment is the current roster with
 * everything since undone. Walk the log newest-first, reversing each move as you
 * pass it, and the working state is the roster as it stood before whatever you
 * last reversed.
 *
 * Three decisions are load-bearing:
 *
 * - **Before the trade, not after.** The snapshot is taken *after* the trade
 *   itself is reversed, so it holds what the roster brought to the table rather
 *   than what it came away with. What it came away with is the trade's own
 *   display — the card already lists it, side by side — and the question a card
 *   cannot answer is what the deal was made *out of*: three receivers for a
 *   first reads one way off a team that had eight and another off a team that
 *   had three.
 * - **One walk for the whole league, not one per trade.** Rewinding each trade
 *   from the current roster independently is O(trades × transactions) over the
 *   same rows; a single pass that emits a snapshot every time it crosses a trade
 *   is O(transactions) and produces exactly the same states. That is why this
 *   takes the league's rosters rather than one, and why the transactions are
 *   required in order.
 * - **Every fact is applied on its own.** `adds` says a roster *received* a
 *   player (so before this, it didn't hold them) and `drops` says another *gave
 *   one up* (so before this, it did) — two independent claims about two
 *   different rosters, not two halves of one move that has to be matched up. The
 *   same for a pick's `owner_id` and `previous_owner_id`. Read independently, a
 *   payload missing one half still tells the truth about the roster the other
 *   half names, which is the reading that degrades honestly.
 *
 * **What it cannot see**, and both limits are worth knowing before trusting a
 * snapshot:
 *
 * - **A draft is not a transaction.** Players arrive on rosters through
 *   `draft_picks`, which this walk never crosses, so rewinding past a rookie
 *   draft leaves that class on the rosters that took them. Snapshots within a
 *   league year are unaffected; ones reaching back across a draft over-report.
 * - **The pick horizon is today's.** The starting portfolio is the grid
 *   `ownedDraftPicks` resolves *now* — for a dynasty league, the next three
 *   drafts — so a pick in a season already drafted is not in it. Reversing a
 *   trade of one still puts it back on the roster that sent it (the pick is
 *   named by the transaction, not by the grid), but a pick that never moved
 *   again is simply absent.
 *
 * Pure and free of runtime imports beyond `./jsonb.ts`, so it unit-tests like
 * its neighbours; `./roster-history` is the thin I/O around it.
 *
 * **It has a second reader now, and it is a browser.** The league sheet's
 * timeline walks the same log to answer "what did every roster hold on this
 * date", which is the identical reversal stopped at a different point rather
 * than a second reading of Sleeper's columns — so {@link rewindRosters} is that
 * walk bounded by a count, and {@link rewindTradeRosters} is it stopping at every
 * trade. Both go through {@link reverseTransaction}, which is the whole of what
 * "reversing a move" means and now exists once. That is also why the purity above
 * is load-bearing rather than merely tidy: a client component imports this
 * module directly, the way it reaches `@/shared/ktc/roster`, and a runtime import
 * of anything `pg`-backed here would drag the database into the bundle.
 */

/**
 * A future draft pick as a roster holds it.
 *
 * `roster_id` is the roster the pick *originally* belongs to, which is what
 * names it — Sleeper's own spelling, and the same one {@link TradePickAsset}
 * carries, so a stored pick and a traded one read alike.
 */
export type RosterPick = {
  season: string;
  round: number;
  roster_id: number;
};

/** What one roster held at one moment. */
export type RosterState = {
  /** Player ids, sorted, so a recomputed snapshot is byte-identical. */
  players: string[];
  /** Owned future picks, in season/round/origin order. */
  picks: RosterPick[];
};

/**
 * One stored transaction, as the walk reads it.
 *
 * The JSONB columns are `unknown` for the reason {@link TradeRow}'s are: they
 * arrive parsed but unpromised. `type` decides only whether a snapshot is
 * emitted — **every** transaction is reversed, since a waiver claim moves a
 * player just as surely as a trade does.
 */
export type RewindTransaction = {
  transaction_id: string;
  /** Sleeper's `type`; only `"trade"` rows produce snapshots. */
  type: string | null;
  roster_ids: unknown;
  adds: unknown;
  drops: unknown;
  draft_picks: unknown;
};

/** One roster's state immediately before one trade. */
export type TradeRosterSnapshot = {
  transaction_id: string;
  roster_id: number;
  state: RosterState;
};

/** The working state a roster is carried through the walk in. */
type Working = { players: Set<string>; picks: Map<string, RosterPick> };

/**
 * A pick's cell. `|` is safe as a separator because a Sleeper season is four
 * digits and both ids are integers, so no part can carry it — the same argument
 * `pickSlotKey` makes for the same character.
 */
const pickKey = (season: string, round: number, rosterId: number): string =>
  `${season}|${round}|${rosterId}`;

/**
 * Every trade's participating rosters as they stood immediately before it.
 *
 * `current` is each roster's state *now*, keyed by roster id — the whole
 * league's, because a transaction between two other teams still has to be
 * reversed before the walk reaches an earlier trade. `newestFirst` is the
 * league's complete transactions in descending `(completed_at, transaction_id)`
 * order; the caller reads them that way because the ordering is the board's own
 * (`TRADE_SORT_SQL`) and belongs to SQL.
 *
 * A roster the walk has no current state for is **skipped rather than emitted
 * empty** — the house rule that absent is not zero. Reversing moves that name it
 * is a no-op for the same reason: an empty roster synthesised from a drop is a
 * claim about a team this database has never seen, and a claim is worse than a
 * gap.
 *
 * Returned newest-trade-first, one entry per `(trade, roster)`. A `roster_ids`
 * naming the same roster twice yields one snapshot, since the pair is a primary
 * key where these land.
 */
export function rewindTradeRosters(
  current: ReadonlyMap<number, RosterState>,
  newestFirst: readonly RewindTransaction[],
): TradeRosterSnapshot[] {
  const working = toWorking(current);
  const snapshots: TradeRosterSnapshot[] = [];

  for (const tx of newestFirst) {
    reverseTransaction(working, tx);

    if (tx.type !== "trade") continue;

    // Emitted *after* the reversal above, which is what makes these the states
    // before the trade rather than after it — see the note on this module.
    const seen = new Set<number>();
    for (const rosterId of numbers(tx.roster_ids)) {
      if (seen.has(rosterId)) continue;
      seen.add(rosterId);
      const state = working.get(rosterId);
      if (!state) continue;
      snapshots.push({
        transaction_id: tx.transaction_id,
        roster_id: rosterId,
        state: freeze(state),
      });
    }
  }

  return snapshots;
}

/**
 * Every roster's state with the first `count` of `newestFirst` reversed — the
 * whole league at one past moment.
 *
 * This is {@link rewindTradeRosters}' walk stopped at an arbitrary point rather
 * than at every trade, and it is what the league sheet's timeline scrubs over: a
 * reader dragging from "now" back to a trade is asking for `count` to go from 0
 * to the number of moves made since. `count` of 0 is therefore the current state
 * and is a real answer rather than a degenerate one — it is the right end of the
 * rail.
 *
 * **Every roster comes back, not just the ones a move named.** That is the
 * difference between this and a snapshot: a trade's own rosters are what
 * `trade_rosters` stores, and the question here is what *any* team in the league
 * held on a date, which includes the ones that were sitting still. A roster with
 * no current state is still skipped, on the same terms — absent is not zero.
 *
 * `count` is clamped to the list rather than validated, since it arrives from a
 * slider and an over-long drag means "as far back as this goes".
 */
export function rewindRosters(
  current: ReadonlyMap<number, RosterState>,
  newestFirst: readonly RewindTransaction[],
  count: number,
): Map<number, RosterState> {
  const working = toWorking(current);
  const stop = Math.min(Math.max(count, 0), newestFirst.length);
  for (let i = 0; i < stop; i++) reverseTransaction(working, newestFirst[i]);

  const states = new Map<number, RosterState>();
  for (const [rosterId, state] of working) states.set(rosterId, freeze(state));
  return states;
}

/** The mutable form the walk carries each roster through. */
function toWorking(
  current: ReadonlyMap<number, RosterState>,
): Map<number, Working> {
  const working = new Map<number, Working>();
  for (const [rosterId, state] of current) {
    working.set(rosterId, {
      players: new Set(state.players),
      picks: new Map(
        state.picks.map((p) => [pickKey(p.season, p.round, p.roster_id), p]),
      ),
    });
  }
  return working;
}

/**
 * Undo one move, in place.
 *
 * **Every fact is applied on its own**, which is the third of this module's
 * load-bearing decisions and is why this is a single pass over three independent
 * columns rather than a matching-up of halves. A payload missing one of them
 * still tells the truth about the roster the others name.
 *
 * It reverses **every** type, trades included: a waiver claim moves a player as
 * surely as a trade does, and what `type` decides is only whether the caller
 * takes a reading afterwards.
 */
function reverseTransaction(
  working: Map<number, Working>,
  tx: RewindTransaction,
): void {
  const at = (rosterId: unknown): Working | undefined => {
    const id = asNumber(rosterId);
    return id === null ? undefined : working.get(id);
  };

  // Received here, so not held before this. `adds` is player id -> the roster
  // that took them, which is the whole player half of any move.
  if (isRecord(tx.adds)) {
    for (const [playerId, rosterId] of Object.entries(tx.adds)) {
      at(rosterId)?.players.delete(playerId);
    }
  }

  // Given up here, so held before this. Not the mirror of the loop above and
  // not redundant with it: a waiver claim adds to one roster and drops from
  // another, and a free-agent add has no drop at all.
  if (isRecord(tx.drops)) {
    for (const [playerId, rosterId] of Object.entries(tx.drops)) {
      at(rosterId)?.players.add(playerId);
    }
  }

  for (const raw of items(tx.draft_picks)) {
    if (!isRecord(raw)) continue;
    const round = asNumber(raw.round);
    const original = asNumber(raw.roster_id);
    const season = String(raw.season ?? "");
    // A pick with no season, round or origin is not a cell anything can be
    // said about — reversing half of it would move an asset onto a roster
    // under a key nothing else will ever match.
    if (round === null || original === null || season === "") continue;

    const key = pickKey(season, round, original);
    at(raw.owner_id)?.picks.delete(key);
    at(raw.previous_owner_id)?.picks.set(key, {
      season,
      round,
      roster_id: original,
    });
  }
}

/**
 * A working state as it is stored: sorted, so recomputing a snapshot produces
 * the identical row and an idempotent write stays idempotent.
 */
function freeze(state: Working): RosterState {
  return {
    players: [...state.players].sort(),
    picks: [...state.picks.values()].sort(
      (a, b) =>
        a.season.localeCompare(b.season) ||
        a.round - b.round ||
        a.roster_id - b.roster_id,
    ),
  };
}

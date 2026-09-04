import { asNumber, isRecord, items } from "../trades/jsonb.ts";

/**
 * What a league's rosters held at any past moment, reconstructed by replaying
 * its later transactions backwards.
 *
 * **Sleeper stores no history.** `rosters` is only ever *now*, and there is no
 * endpoint that answers "what did this team look like in October". What there
 * is, is the whole transaction log — every add, every drop, every pick that
 * changed hands — so the state at any past moment is the current roster with
 * everything since undone. Walk the log newest-first, reversing each move as you
 * pass it, and the working state is the roster as it stood before whatever you
 * last reversed.
 *
 * Two decisions are load-bearing:
 *
 * - **One walk for the whole league, not one per roster.** Rewinding each team
 *   independently is O(rosters × transactions) over the same rows; a single pass
 *   carrying every roster is O(transactions) and produces the same states. That
 *   is why this takes the league's rosters rather than one, and why the
 *   transactions are required in order.
 * - **Every fact is applied on its own.** `adds` says a roster *received* a
 *   player (so before this, it didn't hold them) and `drops` says another *gave
 *   one up* (so before this, it did) — two independent claims about two
 *   different rosters, not two halves of one move that has to be matched up. The
 *   same for a pick's `owner_id` and `previous_owner_id`. Read independently, a
 *   payload missing one half still tells the truth about the roster the other
 *   half names, which is the reading that degrades honestly.
 *
 * **What it cannot see**, and both limits are worth knowing before trusting a
 * stop — they are what `timelineCaveat` tells the reader about:
 *
 * - **A draft is not a transaction.** Players arrive on rosters through
 *   `draft_picks`, which this walk never crosses, so rewinding past a rookie
 *   draft leaves that class on the rosters that took them. Stops within a league
 *   year are unaffected; ones reaching back across a draft over-report.
 * - **The pick horizon is today's.** The starting portfolio is the grid
 *   `ownedDraftPicks` resolves *now* — for a dynasty league, the next three
 *   drafts — so a pick in a season already drafted is not in it. Reversing a
 *   trade of one still puts it back on the roster that sent it (the pick is
 *   named by the transaction, not by the grid), but a pick that never moved
 *   again is simply absent.
 *
 * **Pure, and a browser is the reader.** Its one import is `../trades/jsonb`,
 * which is equally pure, so it unit-tests under Node's own runner and a
 * `"use client"` module can import it directly the way one already reaches
 * `@/shared/ktc/roster` — a runtime import of anything `pg`-backed here would
 * drag the database into the bundle. `./read` is the thin I/O around it.
 *
 * **Ported from TheLabX as the rewind half only.** That file continues into
 * `rewindTradeRosters`, which emits a snapshot every time the walk crosses a
 * trade so a `trade_rosters` table can store what each side brought to it.
 * There is no such table here and nothing writes one, so the walk that would
 * fill it is absent; it arrives with that table.
 */

/**
 * A future draft pick as a roster holds it.
 *
 * `roster_id` is the roster the pick *originally* belongs to, which is what
 * names it — Sleeper's own spelling, and the same one the transactions being
 * reversed use, so a stored pick and a traded one read alike.
 */
export type RosterPick = {
  season: string;
  round: number;
  roster_id: number;
};

/** What one roster held at one moment. */
export type RosterState = {
  /** Player ids, sorted, so a recomputed state is byte-identical. */
  players: string[];
  /** Owned future picks, in season/round/origin order. */
  picks: RosterPick[];
};

/**
 * One stored transaction, as the walk reads it.
 *
 * The JSONB columns are `unknown` for the reason every read of those columns
 * takes them that way: they arrive parsed but unpromised. **Every** transaction
 * is reversed — a waiver claim moves a player just as surely as a trade does —
 * so nothing here branches on `type`.
 */
export type RewindTransaction = {
  transaction_id: string;
  type: string | null;
  roster_ids: unknown;
  adds: unknown;
  drops: unknown;
  draft_picks: unknown;
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
 * Every roster's state with the first `count` of `newestFirst` reversed — the
 * whole league at one past moment.
 *
 * `current` is each roster's state *now*, keyed by roster id — the whole
 * league's, because a transaction between two other teams still has to be
 * reversed before the walk reaches an earlier one. `newestFirst` is the league's
 * completed transactions in descending `(completed_at, transaction_id)` order;
 * the caller reads them that way because the ordering is the trades board's own
 * (`TRADE_SORT_SQL`) and belongs to SQL.
 *
 * `count` of 0 is therefore the current state and is a real answer rather than
 * a degenerate one — it is the right-hand end of the rail. It is **clamped**
 * rather than validated, since it arrives from a slider and an over-long drag
 * means "as far back as this goes".
 *
 * **Every roster comes back, not just the ones a move named**: the question is
 * what *any* team in the league held on a date, which includes the ones that
 * were sitting still. A roster the walk has no current state for is **skipped
 * rather than emitted empty** — the house rule that absent is not zero, and
 * reversing moves that name it is a no-op for the same reason: an empty roster
 * synthesised from a drop is a claim about a team this database has never seen.
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
 * **Every fact is applied on its own**, which is the second of this module's
 * load-bearing decisions and is why this is a single pass over three
 * independent columns rather than a matching-up of halves. A payload missing
 * one of them still tells the truth about the roster the others name.
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
    // A pick with no season, round or origin is not a cell anything can be said
    // about — reversing half of it would move an asset onto a roster under a key
    // nothing else will ever match.
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
 * A working state as it is read back: sorted, so two computations of the same
 * stop produce the identical list and the pick grid groups in one pass.
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

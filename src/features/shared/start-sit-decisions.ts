import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "../../shared/projections/slots.ts";

import {
  sideOf,
  type WeekLineupEntry,
  type WeekSharePlayer,
  type WeekSide,
} from "./week-shares.ts";

/**
 * Who a player was started over, and who he was sat behind.
 *
 * One row of a shares panel is a player and two counts; this is what those two
 * counts were made of. For each league the player is on, it names every
 * counterpart the lineup chose between him and — and, per league, the seat the
 * choice turned on, whether the swap is direct or runs through a flex, and what
 * the call was worth.
 *
 * **Legality is the seat's, not the two players'**, and it is the one rule here
 * that is silent when wrong. A wide receiver is not a candidate for a
 * quarterback-only slot, and listing him as one is a claim a week tool must not
 * make — `lineup-check-card.tsx`'s module note is about exactly this class of
 * false statement. So a pairing the league's own lineup cannot express is not
 * listed at all, and a pairing that needs a chained seat says which one.
 *
 * **Two tools read it**, over the same normalised side `weekPlayerShares` folds
 * — the lineup checker, where the figure the calls are judged on is a
 * projection, and gametime, where it is the live projection. What a decision
 * *cost* is therefore whatever the page adapted onto
 * {@link WeekSharePlayer.figure}, and this module never names it: a delta here
 * is one figure less another, and the word for it is the drawer's.
 *
 * Pure, and everything it reads arrives as an argument: the contract is an
 * erased `import type` and the slot vocabulary comes in relatively with a `.ts`
 * extension, so this tests under Node's runner. That is the point — every rule
 * below renders perfectly when it is wrong.
 */

/**
 * How a swap reaches its seat: the seat itself takes the position, or a named
 * seat that takes both stands between them.
 *
 * `via` carries the raw Sleeper slot rather than a label, because the label is
 * the caller's — `SLOT_LABELS` shortens `SUPER_FLEX` to `SF` on a chip, and a
 * helper that shortened it here would be a second spelling of that table.
 */
export type SwapRoute = { direct: true; via: null } | { direct: false; via: string };

/** One league's half of a pairing. */
export type DecisionRow = {
  league_id: string;
  league_name: string;
  /** Whether the **subject** started here — the counterpart is the other one. */
  started: boolean;
  /** The seat the choice turned on, as Sleeper spells it. */
  seat: string;
  /**
   * Which of that slot this is, 1-based, or null where the league has only one.
   *
   * A league starting two running backs seats them in two slots both named
   * `RB`, so a bare label would put the same word on two different decisions.
   * Null rather than `1` where there is nothing to disambiguate: `RB1` in a
   * one-RB league invites a reader to look for the RB2 that does not exist.
   */
  seat_index: number | null;
  route: SwapRoute;
  /**
   * What the call was worth: the started player's figure less the benched one's,
   * whichever side the subject was on. Positive is the lineup getting it right.
   *
   * **Null where either player has no figure**, never zero — the feed has no row
   * for him, which is not a projection of nothing, and a zero here would read as
   * a decision that cost exactly nothing.
   */
  delta: number | null;
  /**
   * Whether this lineup left points behind — a started player figuring under
   * the bench player he was started over, or a benched player figuring over the
   * starter he sat behind. False where there is no delta to judge.
   */
  lost: boolean;
};

/** One counterpart, and every league the choice between them was made in. */
export type DecisionGroup = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  /**
   * His figure where every league in {@link rows} agrees, else null — the rule
   * `WeekPlayerShare.figure` is written by and for the same reason: either
   * tool's figure is scored by the league's own settings, and this row spans
   * leagues. Narrowing the view to one counterpart is what makes it answerable.
   */
  figure: number | null;
  /** Leagues the subject was started over him in. */
  starts: number;
  /** Leagues the subject sat behind him in. */
  sits: number;
  rows: DecisionRow[];
};

/**
 * What a named seat will accept.
 *
 * Read off the app's own slot vocabulary rather than a table written here, so a
 * league running `REC_FLEX` or `IDP_FLEX` is answered by the same list the
 * solver seats from and the day it learns a new slot this learns it too.
 *
 * **An unrecognised seat takes nobody**, which is the conservative answer and
 * the correct one: the honest thing to say about a slot this build does not
 * know is nothing, and the alternative — guessing from its name — is how a
 * pairing gets listed against a seat that would refuse it. It is the same call
 * the solver makes when it drops a slot into `unknown_slots`.
 */
export function seatTakes(slot: string): readonly string[] {
  return SLOT_POSITIONS[slot] ?? [];
}

/**
 * Whether a player can end up in a seat, and what it costs.
 *
 * `positions` is the player's whole `fantasy_positions` list, because Sleeper
 * lists several for the players this matters most for — a tight end who is also
 * a quarterback is legal in both kinds of seat, and asking with one position
 * would drop half the pairings he is really part of. The best route over his
 * positions wins: direct beats chained, and among chained routes the narrowest
 * bridging seat wins.
 *
 * **The narrowest bridge, which is the handoff's flex-before-superflex rule
 * generalised.** Every lineup has a flex, so a swap two flex-eligible positions
 * can make through it is the same one-hop chain in every league — naming it
 * `Via SF` wherever the league happens to carry a spare quarterback slot would
 * tell the reader the mechanism changed when only the league did. Ordering by
 * how many positions a seat admits says that without naming either slot:
 * `FLEX` (three) is offered before `SUPER_FLEX` (four), and the superflex route
 * is left naming the case it exists for, a swap with a quarterback on one end.
 * Ties break on the slot name so the answer is deterministic.
 *
 * **The bridging seat has to be one the league actually starts.** It is read
 * out of `rosterPositions`, so a swap is only ever offered through a seat the
 * lineup in front of the reader really has; the bench slots are excluded
 * because a chain through `BN` is not a swap, it is both players sitting.
 *
 * `null` is no legal route, and the pairing is not listed.
 */
export function relFor(
  seat: string,
  positions: readonly string[],
  rosterPositions: readonly string[] | null,
): SwapRoute | null {
  const takes = seatTakes(seat);
  if (positions.some((pos) => takes.includes(pos))) {
    return { direct: true, via: null };
  }
  if (takes.length === 0) return null;

  const bridges = [...new Set(rosterPositions ?? [])]
    .filter((slot) => !NON_STARTING_SLOTS.has(slot))
    .map((slot) => ({ slot, takes: seatTakes(slot) }))
    .filter(
      (bridge) =>
        positions.some((pos) => bridge.takes.includes(pos)) &&
        bridge.takes.some((pos) => takes.includes(pos)),
    )
    .sort(
      (a, b) => a.takes.length - b.takes.length || a.slot.localeCompare(b.slot),
    );

  const best = bridges[0];
  return best ? { direct: false, via: best.slot } : null;
}

/**
 * Every start/sit decision one player was part of, grouped by counterpart.
 *
 * **Grouped by the other player, not by the league**, which is the question the
 * view answers: one counterpart is one decision, made in however many lineups,
 * and grouping by league would split the same pairing across a dozen headings
 * and make the count a reader is after — how often was this call made — a thing
 * they had to add up themselves.
 *
 * The subject is looked for in each league's lineup first and its bench second,
 * so a league is one or the other and never both; a league he is not on at all
 * contributes nothing. Where he started, the counterparts are the bench players
 * his seat would have taken. Where he sat, they are the starters whose seats
 * would have taken him — legality belongs to the *other* player's seat there,
 * which is the half the prototype's first revision got backwards.
 *
 * **A locked player is still a counterpart.** The lineup checker's own numbers
 * stop offering moves once a game has kicked off, and that is right for a tool
 * that answers what can still be changed; this answers what was already
 * decided, and a decision does not stop having been made because the game
 * started. Gating on it would have the list quietly shrink through Sunday.
 *
 * **A lineup the manager did not set contributes nothing**, which is the one
 * gate here rather than a filter the caller could forget. Sleeper seats a
 * best-ball team itself, from the whole roster, after the games — so a row
 * reading "started over" there is a call nobody made, and on gametime it is
 * worse than merely wrong: that lineup is *solved* from the very figures the
 * delta compares, so every such row would be a decision the reader is told they
 * got right, by construction, in a league they never chose a lineup for. The
 * shares keep counting those leagues, because who is on a roster and who got
 * seated are real readings; only the calls go. See
 * {@link WeekLineupEntry.set_by_manager}.
 */
export function decisionsFor(
  playerId: string,
  entries: readonly WeekLineupEntry[],
  side: WeekSide,
): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>();

  for (const entry of entries) {
    if (!entry.set_by_manager) continue;
    const fielded = sideOf(entry, side);
    if (!fielded) continue;

    const league = entry.league;

    const positions = league.roster_positions;
    // Which of a repeated slot each seat is, resolved once per league so the
    // two branches below cannot number them differently.
    const seatIndex = seatIndices(fielded.lineup.map((s) => s.slot));

    const seatedAt = fielded.lineup.findIndex(
      (s) => s.player?.player_id === playerId,
    );

    if (seatedAt >= 0) {
      const mine = fielded.lineup[seatedAt].player;
      if (!mine) continue;
      const seat = fielded.lineup[seatedAt].slot;
      for (const other of fielded.bench) {
        const route = relFor(seat, other.positions, positions);
        if (!route) continue;
        record(groups, league, other, {
          started: true,
          seat,
          seat_index: seatIndex[seatedAt],
          route,
          ...call(mine.figure, other.figure),
        });
      }
      continue;
    }

    const mine = fielded.bench.find((p) => p.player_id === playerId);
    if (!mine) continue;

    fielded.lineup.forEach((seat, i) => {
      const other = seat.player;
      if (!other) return;
      const route = relFor(seat.slot, mine.positions, positions);
      if (!route) return;
      record(groups, league, other, {
        started: false,
        seat: seat.slot,
        seat_index: seatIndex[i],
        route,
        ...call(other.figure, mine.figure),
      });
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.rows.length - a.rows.length ||
      // Then the counterparts the lineup got wrong most often: the whole point
      // of the view is the calls that cost something, and a pairing made twice
      // and lost twice is worth more of the reader's eye than one made twice
      // and won twice.
      lostCount(b) - lostCount(a) ||
      a.name.localeCompare(b.name),
  );
}

/** How the two figures compare, and whether the lineup left points behind. */
function call(
  started: number | null,
  benched: number | null,
): Pick<DecisionRow, "delta" | "lost"> {
  if (started === null || benched === null) {
    return { delta: null, lost: false };
  }
  const delta = started - benched;
  return { delta, lost: delta < 0 };
}

function lostCount(group: DecisionGroup): number {
  return group.rows.filter((row) => row.lost).length;
}

/**
 * Which of a repeated slot each seat is, positionally, or null where the league
 * starts only one — see {@link DecisionRow.seat_index}.
 */
function seatIndices(slots: readonly string[]): (number | null)[] {
  const total = new Map<string, number>();
  for (const slot of slots) total.set(slot, (total.get(slot) ?? 0) + 1);

  const seen = new Map<string, number>();
  return slots.map((slot) => {
    const n = (seen.get(slot) ?? 0) + 1;
    seen.set(slot, n);
    return (total.get(slot) ?? 0) > 1 ? n : null;
  });
}

/**
 * Add one league's row to a counterpart's group, creating it on first sight.
 *
 * **One counterpart, one row per league.** A pairing already recorded for this
 * lineup is the same decision, not a second one — which is reachable whenever a
 * league's arrays name somebody twice, and would double a count the reader
 * reads as "how many leagues".
 */
function record(
  groups: Map<string, DecisionGroup>,
  league: { league_id: string; name: string },
  other: WeekSharePlayer,
  row: Omit<DecisionRow, "league_id" | "league_name">,
): void {
  let group = groups.get(other.player_id);
  if (!group) {
    group = {
      player_id: other.player_id,
      name: other.name ?? other.player_id,
      position: other.positions[0] ?? null,
      team: other.team,
      figure: other.figure,
      starts: 0,
      sits: 0,
      rows: [],
    };
    groups.set(other.player_id, group);
  } else {
    // The duplicate check comes before the reconciliation below, not after: a
    // second sighting in a league already recorded is the same row read twice
    // and must not be able to null a figure the first sighting agreed on.
    if (group.rows.some((r) => r.league_id === league.league_id)) return;
    if (group.figure !== other.figure) {
      // Two leagues that price him differently have no shared answer — see
      // `figure`, and `WeekPlayerShare.figure` for the argument in full.
      group.figure = null;
    }
  }

  if (row.started) group.starts++;
  else group.sits++;
  group.rows.push({
    league_id: league.league_id,
    league_name: league.name,
    ...row,
  });
}

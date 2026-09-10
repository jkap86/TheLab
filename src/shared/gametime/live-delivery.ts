/**
 * What a room sends one reader on a tick, and what it may then assume that
 * reader holds.
 *
 * Pure and free of runtime imports, on `./live-rules`' terms and for its
 * reason: `./live` owns the timers, the subscriber sets and the Postgres
 * reads, none of which can be driven under Node's own runner, and every
 * decision below renders perfectly while being wrong. A baseline advanced for
 * a frame the socket never took is a client quietly holding a week that no
 * longer exists, with no error anywhere to say so.
 *
 * **The state is what the reader has *accepted*, never what was offered.**
 * That single rule is what makes a dropped frame harmless: a delta is always
 * computed against the last acknowledged answer, so a drop leaves the baseline
 * where it was and the next delta is *cumulative* — it carries everything that
 * has moved since the last frame that actually landed, rather than one tick's
 * worth of it. Correctness costs nothing here, and the alternative (resending
 * the whole week after every drop) is the most expensive frame there is on
 * exactly the connection that has just proved it cannot take one.
 *
 * **Two collections are diffed and they are diffed the same way** — the
 * account's leagues, and the week's stat board. The second is not a fact about
 * any roster and is the same for every reader of the week, but it moves for
 * the same reason and on the same tick, and carrying it whole would make every
 * frame the size of the board. See {@link Delivery.players}.
 *
 * The one thing a delta cannot fix is a reader who has never held a payload:
 * there is nothing to fold it over, and the client drops it. So the first
 * frame is a full payload, and it stays the first frame until one is accepted.
 */

import { diffLeagues } from "./live-rules.ts";

/** What one reader is known to hold. */
export type DeliveryState = {
  /** Each accepted league's own serialisation — {@link diffLeagues}' hold. */
  held: Map<string, string>;
  /** Each accepted stat line's, the same way — see {@link Delivery.players}. */
  heldPlayers: Map<string, string>;
  /** The accepted payload header, serialised. */
  heldHeader: string;
  /** Whether a full payload has ever been accepted by this reader. */
  seeded: boolean;
};

export function newDelivery(): DeliveryState {
  return { held: new Map(), heldPlayers: new Map(), heldHeader: "", seeded: false };
}

/**
 * What to send this reader, and the state to commit **if the send is
 * accepted**.
 *
 * `kind: "none"` is a tick that moved nothing for them, which is what makes a
 * twenty-second cadence reasonable on a page left open through a quiet
 * afternoon. Otherwise `changed` names the leagues to carry (every league, for
 * a payload) and `removed` the ones that left.
 */
export type Delivery =
  | { kind: "none" }
  | {
      kind: "payload" | "delta";
      changed: string[];
      removed: string[];
      /**
       * The same pair over the week's stat board.
       *
       * **A second diffed collection rather than a field of the header**, and
       * the reason is what it costs otherwise. The board is a few hundred rows
       * whose identity half cannot change for the length of a week, where the
       * header is re-serialised whole on every tick (`read_at` alone sees to
       * that) — so carried there it would be the largest thing on this wire,
       * pushed every twenty seconds to every reader of the page whether or not
       * they have ever opened the board. Diffed, a tick carries the handful of
       * players who touched the ball since the last frame that landed.
       *
       * It is *not* folded into `changed` beside the leagues: a league id and
       * a player id are two vocabularies, and one list of both would need a
       * rule to tell them apart on the far side.
       */
      players: { changed: string[]; removed: string[] };
      commit: DeliveryState;
    };

/**
 * Decide the next frame for one reader.
 *
 * `force` sends a frame the diff would otherwise call unnecessary. Its one
 * caller is the room clearing a `stale` note it has already sent: the note is
 * a claim about the *feeds* rather than about any league, so the values behind
 * it can recover without a single number moving, and nothing else on this
 * wire would ever take the warning back off the page.
 */
export function nextDelivery<L, P>(
  state: DeliveryState,
  headerJson: string,
  leagues: Readonly<Record<string, L>>,
  players: Readonly<Record<string, P>>,
  force = false,
): Delivery {
  const diff = diffLeagues(state.held, leagues);
  const stats = diffLeagues(state.heldPlayers, players);
  const moved =
    diff.changed.length > 0 ||
    diff.removed.length > 0 ||
    stats.changed.length > 0 ||
    stats.removed.length > 0 ||
    headerJson !== state.heldHeader;

  const commit: DeliveryState = {
    held: diff.serialised,
    heldPlayers: stats.serialised,
    heldHeader: headerJson,
    seeded: true,
  };

  if (!state.seeded) {
    return {
      kind: "payload",
      changed: Object.keys(leagues),
      removed: [],
      players: { changed: Object.keys(players), removed: [] },
      commit,
    };
  }
  if (!moved && !force) return { kind: "none" };

  return {
    kind: "delta",
    changed: diff.changed,
    removed: diff.removed,
    players: { changed: stats.changed, removed: stats.removed },
    commit,
  };
}

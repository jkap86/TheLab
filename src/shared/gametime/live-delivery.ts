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
 * The one thing a delta cannot fix is a reader who has never held a payload:
 * there is nothing to fold it over, and the client drops it. So the first
 * frame is a full payload, and it stays the first frame until one is accepted.
 */

import { diffLeagues } from "./live-rules.ts";

/** What one reader is known to hold. */
export type DeliveryState = {
  /** Each accepted league's own serialisation — {@link diffLeagues}' hold. */
  held: Map<string, string>;
  /** The accepted payload header, serialised. */
  heldHeader: string;
  /** Whether a full payload has ever been accepted by this reader. */
  seeded: boolean;
};

export function newDelivery(): DeliveryState {
  return { held: new Map(), heldHeader: "", seeded: false };
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
export function nextDelivery<L>(
  state: DeliveryState,
  headerJson: string,
  leagues: Readonly<Record<string, L>>,
  force = false,
): Delivery {
  const diff = diffLeagues(state.held, leagues);
  const moved =
    diff.changed.length > 0 ||
    diff.removed.length > 0 ||
    headerJson !== state.heldHeader;

  if (!state.seeded) {
    return {
      kind: "payload",
      changed: Object.keys(leagues),
      removed: [],
      commit: { held: diff.serialised, heldHeader: headerJson, seeded: true },
    };
  }
  if (!moved && !force) return { kind: "none" };

  return {
    kind: "delta",
    changed: diff.changed,
    removed: diff.removed,
    commit: { held: diff.serialised, heldHeader: headerJson, seeded: true },
  };
}

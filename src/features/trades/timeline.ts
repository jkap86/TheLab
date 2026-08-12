import { rewindRosters } from "../../shared/trades/rewind.ts";
import type { RosterPick, RosterState } from "../../shared/trades/rewind.ts";
import type {
  TradeTimelineEventPayload,
  TradeTimelinePayload,
} from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";

/**
 * Reading a league's rosters at any moment between a trade and today.
 *
 * **The rail is a run of stops, and a stop is a count.** The payload carries the
 * league as it stands now plus every completed move since the trade, newest
 * first; the state at a stop is that current roster with the newest `back` of
 * those moves reversed. So `back` of 0 is today and `back` of `events.length` is
 * the league as it stood before the trade — the reading the trade card used to
 * carry behind a disclosure, now the leftmost stop of a rail rather than the only
 * answer available.
 *
 * **`back` rather than a stop index is the state the sheet holds**, and that is a
 * decision rather than a spelling. The payload arrives after the sheet opens, so
 * an index into a list that does not exist yet has to be reconciled when it does;
 * a count back from now is 0 before the request lands and 0 after it, which is
 * exactly the "the sheet opens as it always did" promise. The slider does the
 * inversion, since a reader drags left into the past.
 *
 * **The reversal itself is not here.** It is `shared/trades/rewind`, the same
 * function the league sync walks its snapshots with — undoing a move is one
 * definition, and a second one on this side of the wire would be a second answer.
 * What is here is what a *reader* needs on top: which stops exist, what each one
 * is called, and the order the roster blocks are drawn in.
 *
 * Pure and free of runtime imports it can't resolve, so it tests like its
 * neighbours in this feature: the rewind arrives relatively with an explicit
 * `.ts` extension, and everything from the contract is an erased `import type`.
 */

/** How many moves the rail spans — one stop per move, plus "now". */
export function timelineMoveCount(payload: TradeTimelinePayload | null): number {
  return payload?.timeline?.events.length ?? 0;
}

/** What a reader is looking at when the rail is at one position. */
export type TimelineStop = {
  /** How many of the newest moves are reversed. 0 is now. */
  back: number;
  /**
   * Which of the three kinds of moment this is.
   *
   * `now` is the present. `after` is the league as one move left it. `before` is
   * the far end of the rail — the league as it stood *before* the trade, which is
   * the only stop named by a move it does not include.
   */
  kind: "now" | "after" | "before";
  /**
   * The move that produced this state, or — at the far end — the trade this state
   * comes before. Null only when there is no timeline at all.
   */
  event: TradeTimelineEventPayload | null;
  /** When this state came into being, epoch milliseconds. Null at `now`. */
  at: number | null;
};

/**
 * The stop a rail position describes.
 *
 * The arithmetic worth stating once: with `events` newest-first and `back` moves
 * reversed, what is left standing is everything from `events[back]` older — so
 * `events[back]` is the move that *produced* this state, and it is what dates and
 * names the stop. At `back` of 0 that move is the most recent one in the league,
 * which is another way of saying "now", so the present is named rather than dated
 * by a move a reader has no reason to care about. At the far end there is no
 * `events[back]`, because every move including the trade has been undone; that
 * stop is named by the trade it comes before.
 *
 * `back` is clamped, for {@link rewindRosters}' reason: it arrives from a slider,
 * and a value past the end means "as far back as this goes".
 */
export function timelineStop(
  payload: TradeTimelinePayload | null,
  back: number,
): TimelineStop {
  const events = payload?.timeline?.events ?? [];
  const at = Math.min(Math.max(back, 0), events.length);

  if (at === 0) return { back: 0, kind: "now", event: events[0] ?? null, at: null };
  if (at >= events.length) {
    const trade = events[events.length - 1] ?? null;
    return { back: at, kind: "before", event: trade, at: trade?.at ?? null };
  }
  return { back: at, kind: "after", event: events[at], at: events[at].at };
}

/** The rosters that dealt in the trade the rail is anchored on. */
export function tradeRosterIds(
  payload: TradeTimelinePayload | null,
): readonly number[] {
  const events = payload?.timeline?.events ?? [];
  return events[events.length - 1]?.roster_ids ?? [];
}

/** One roster as it stood at a stop, ready to draw. */
export type TimelineRoster = {
  roster_id: number;
  /** Who holds it *now* — see {@link timelineRosters}. */
  user_id: string | null;
  players: string[];
  picks: RosterPick[];
  /** Whether this roster was one of the trade's own sides. */
  dealt: boolean;
};

/**
 * Every roster in the league as it stood at one stop, in the order they are
 * drawn.
 *
 * **The rosters that dealt come first**, then everyone else by roster id. The
 * sheet was opened from a trade, so the two or three teams it was made between
 * are what a reader is looking for; and the ordering is stable across stops,
 * because who dealt is a fact about the trade rather than about the moment being
 * read — a list that re-sorted under a dragging finger would be unreadable.
 *
 * **The manager naming a block is today's, and that is the honest limit rather
 * than an oversight.** Sleeper's `rosters` is only ever *now*, so who held roster
 * 4 last October is not a thing this database stores; what the block says is
 * "roster 4, which so-and-so holds today". Naming it after a manager who has since
 * taken it over is a smaller error than not naming it at all, and it is the same
 * reading `getDraftSlots` takes of an owner who has left.
 */
export function timelineRosters(
  payload: TradeTimelinePayload | null,
  back: number,
): TimelineRoster[] {
  const timeline = payload?.timeline;
  if (!timeline) return [];

  const current = new Map<number, RosterState>(
    timeline.rosters.map((r) => [
      r.roster_id,
      { players: r.players, picks: r.picks },
    ]),
  );
  const states = rewindRosters(current, timeline.events, back);
  const dealt = new Set(tradeRosterIds(payload));

  return timeline.rosters
    .map((roster) => ({
      roster_id: roster.roster_id,
      user_id: roster.user_id,
      players: states.get(roster.roster_id)?.players ?? [],
      picks: states.get(roster.roster_id)?.picks ?? [],
      dealt: dealt.has(roster.roster_id),
    }))
    .sort(
      (a, b) =>
        Number(b.dealt) - Number(a.dealt) || a.roster_id - b.roster_id,
    );
}

/**
 * How a move is named on the rail: what kind it was, and who moved.
 *
 * Sleeper's `type` is a machine word (`free_agent`), so the known ones are
 * spelled out and anything else has its underscores opened rather than being
 * dropped — a move this app has not met is still a move, and reporting it as
 * blank would read as a rendering fault at exactly the stop a reader had scrubbed
 * to.
 */
export function moveKindLabel(type: string | null): string {
  switch (type) {
    case "trade":
      return "Trade";
    case "waiver":
      return "Waiver";
    case "free_agent":
      return "Free agent";
    case "commissioner":
      return "Commissioner";
    default:
      return type ? type.replace(/_/g, " ") : "Move";
  }
}

/** How many names a move's summary prints before it starts counting. */
const NAMED_MOVERS = 3;

/**
 * Who a move touched, as a line of names.
 *
 * Both halves count: `adds` names who arrived and `drops` who left, and a waiver
 * claim is usually one of each. They are pooled rather than signed, for the
 * reason the trade filters pool a trade's two sides — what a reader is scanning
 * for is *whether the player they care about moved here*, and which direction he
 * went is a fact about a roster rather than about the move.
 *
 * A player the cache cannot name falls back to his id, the same fallback the
 * card's own asset lines make. Past {@link NAMED_MOVERS} the rest are counted:
 * this line sits on one rail beside a date, and a nine-player trade would take
 * the row.
 */
export function movedPlayerNames(
  event: TradeTimelineEventPayload | null,
  players: Readonly<Record<string, PlayerSummary>>,
): string {
  if (!event) return "";

  const ids = [
    ...new Set([...Object.keys(event.adds), ...Object.keys(event.drops)]),
  ];
  if (ids.length === 0) return "";

  const named = ids
    .slice(0, NAMED_MOVERS)
    .map((id) => players[id]?.name || id)
    .join(", ");
  const rest = ids.length - NAMED_MOVERS;
  return rest > 0 ? `${named} +${rest} more` : named;
}

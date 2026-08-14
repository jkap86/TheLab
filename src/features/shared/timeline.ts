import { rewindRosters } from "../../shared/trades/rewind.ts";
import type { RosterPick, RosterState } from "../../shared/trades/rewind.ts";
import type {
  RosterTimelineEventPayload,
  RosterTimelinePayload,
} from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";

/**
 * Reading a league's rosters at any moment in its past.
 *
 * **The rail is a run of stops, and a stop is a count.** The payload carries the
 * league as it stands now plus every completed move back to its far end, newest
 * first; the state at a stop is that current roster with the newest `back` of
 * those moves reversed. So `back` of 0 is today and `back` of `events.length` is
 * the league as it stood before the oldest move the rail carries.
 *
 * **What that far end *is* depends on how the timeline was asked for, and it is
 * the only thing that does.** Anchored on a trade — the trades board's sheet — it
 * is the league before that trade, the reading a disclosure on the card used to
 * carry. Unanchored — the leagues list's card — it is the league before the oldest
 * move on file, which is as far back as a reconstruction can honestly go. Every
 * other line in this module is blind to the difference, which is what makes one
 * rail serve both; {@link timelineOrigin} is where it is named.
 *
 * **`back` rather than a stop index is the state a host holds**, and that is a
 * decision rather than a spelling. The payload arrives after the panel opens, so
 * an index into a list that does not exist yet has to be reconciled when it does;
 * a count back from now is 0 before the request lands and 0 after it, which is
 * exactly the "it opens as it always did" promise both hosts make. The slider does
 * the inversion, since a reader drags left into the past.
 *
 * **The reversal itself is not here.** It is `shared/trades/rewind`, the same
 * function the league sync walks its snapshots with — undoing a move is one
 * definition, and a second one on this side of the wire would be a second answer.
 * What is here is what a *reader* needs on top: which stops exist, what each one
 * is called, and the order the roster blocks are drawn in.
 *
 * It is in `features/shared` rather than in the trades feature that wrote it
 * because a second tool draws the same rail. Pure and free of runtime imports it
 * can't resolve, so it tests like its neighbours: the rewind arrives relatively
 * with an explicit `.ts` extension, and everything from the contract is an erased
 * `import type`.
 */

/** How many moves the rail spans — one stop per move, plus "now". */
export function timelineMoveCount(
  payload: RosterTimelinePayload | null,
): number {
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
   * the far end of the rail — the league as it stood *before* the oldest move the
   * rail carries, which is the only stop named by a move it does not include.
   */
  kind: "now" | "after" | "before";
  /**
   * The move that produced this state, or — at the far end — the move this state
   * comes before. Null only when there is no timeline at all.
   */
  event: RosterTimelineEventPayload | null;
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
 * `events[back]`, because every move on the rail has been undone; that stop is
 * named by the oldest one, which it comes before.
 *
 * `back` is clamped, for {@link rewindRosters}' reason: it arrives from a slider,
 * and a value past the end means "as far back as this goes".
 */
export function timelineStop(
  payload: RosterTimelinePayload | null,
  back: number,
): TimelineStop {
  const events = payload?.timeline?.events ?? [];
  const at = Math.min(Math.max(back, 0), events.length);

  if (at === 0)
    return { back: 0, kind: "now", event: events[0] ?? null, at: null };
  if (at >= events.length) {
    const oldest = events[events.length - 1] ?? null;
    return { back: at, kind: "before", event: oldest, at: oldest?.at ?? null };
  }
  return { back: at, kind: "after", event: events[at], at: events[at].at };
}

/** How the far end of a rail is named and described. */
export type TimelineOrigin = {
  /** The key that jumps there — short enough to sit beside `Now`. */
  key: string;
  /** What that key promises, on its hover. */
  title: string;
  /** What the readout says while the rail is standing on it. */
  summary: string;
};

/**
 * What the leftmost stop of this rail *is*, in the three registers the rail
 * writes it in.
 *
 * **Derived from the payload rather than passed in by the host**, which is the
 * decision worth keeping. Both hosts know perfectly well which kind of rail they
 * are drawing, so a prop would work — and it would be a second place where that
 * fact is recorded, free to disagree with the payload the stops are actually
 * computed from. The anchor is on the wire because the server is what knows
 * whether the walk stopped at a trade; reading the far end off the same field is
 * what makes "the rail says trade" and "the rail *is* bounded by a trade" one
 * fact.
 *
 * The unanchored wording says **on file** rather than "ever": a reconstruction
 * reaches back exactly as far as this league's stored log, which is one season
 * (see `getLeagueTimeline`), and a far end claiming to be the beginning of time
 * would be the one wrong answer here that looks like a working one.
 */
export function timelineOrigin(
  payload: RosterTimelinePayload | null,
): TimelineOrigin {
  return payload?.timeline?.anchor
    ? {
        key: "Trade",
        title: "The league as it stood before this trade",
        summary: "before this trade",
      }
    : {
        key: "Start",
        title: "The league as it stood before the oldest move on file",
        summary: "before the oldest move on file",
      };
}

/** One roster as it stood at a stop, ready to draw. */
export type TimelineRoster = {
  roster_id: number;
  /** Who holds it *now* — see {@link timelineRosters}. */
  user_id: string | null;
  players: string[];
  picks: RosterPick[];
  /**
   * Whether this roster was one of the anchoring trade's own sides.
   *
   * Always false on an unanchored rail, which is the honest reading rather than a
   * gap: there is no trade for a roster to have been a side of, so nothing is
   * marked and the list falls back to roster order.
   */
  dealt: boolean;
};

/** The rosters that dealt in the trade the rail is anchored on, if any. */
export function tradeRosterIds(
  payload: RosterTimelinePayload | null,
): readonly number[] {
  const timeline = payload?.timeline;
  if (!timeline?.anchor) return [];
  // The anchoring trade is the oldest event by construction — the walk truncates
  // there — so this reads the same list the far stop is named by rather than
  // searching for the id.
  return timeline.events[timeline.events.length - 1]?.roster_ids ?? [];
}

/**
 * Every roster in the league as it stood at one stop, in the order they are
 * drawn.
 *
 * **The rosters that dealt come first**, then everyone else by roster id. A sheet
 * opened from a trade is opened *for* the two or three teams it was made between;
 * and the ordering is stable across stops, because who dealt is a fact about the
 * trade rather than about the moment being read — a list that re-sorted under a
 * dragging finger would be unreadable. On an unanchored rail nothing dealt, so
 * this is plain roster order, which is the order the standings' own selection
 * list is in.
 *
 * **The manager naming a block is today's, and that is the honest limit rather
 * than an oversight.** Sleeper's `rosters` is only ever *now*, so who held roster
 * 4 last October is not a thing this database stores; what the block says is
 * "roster 4, which so-and-so holds today". Naming it after a manager who has since
 * taken it over is a smaller error than not naming it at all, and it is the same
 * reading `getDraftSlots` takes of an owner who has left.
 */
export function timelineRosters(
  payload: RosterTimelinePayload | null,
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
      (a, b) => Number(b.dealt) - Number(a.dealt) || a.roster_id - b.roster_id,
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
  event: RosterTimelineEventPayload | null,
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

/**
 * The line above a past league, which has two jobs and states both plainly.
 *
 * It says *which moment* this is, because the rail's own readout is a row up and
 * a reader who has scrolled the grid can no longer see it. And it says the rosters
 * are **reconstructed**, because nothing about a list of names admits that it was
 * derived — Sleeper stores no history, so this is today's rosters with every move
 * since undone, and the two limits of that walk are exactly the kind of thing a
 * reader should be told once rather than discover.
 *
 * **Only the draft limit is stated, and that is a judgement rather than an
 * omission.** `shared/trades/rewind` documents two: a draft is not a transaction,
 * and the pick horizon is today's. The first is visible in the rosters on screen —
 * a rookie class sitting on teams that had not drafted it yet — and the second
 * shows up as picks quietly absent, which no wording on a two-line note is going
 * to make legible. A caveat that lists everything is one nobody finishes.
 *
 * It takes the formatted date rather than the instant, so this module stays free
 * of the formatter and the rail keeps one spelling of a moment.
 */
export function timelineCaveat(when: string): string {
  return `Every roster as it stood on ${when} — reconstructed by undoing every move since, so a class drafted after this date is already on the roster that took it.`;
}

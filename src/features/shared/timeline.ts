import { rewindRosters } from "../../shared/timeline/rewind.ts";
import type { RosterPick, RosterState } from "../../shared/timeline/rewind.ts";
import type {
  PlayerSummary,
  RosterPick as CardRosterPick,
  RosterTimelinePayload,
  TimelineEventPayload,
} from "@/shared/contract";

/**
 * Reading a league's rosters at any moment in its past.
 *
 * **The rail is a run of stops, and a stop is a count.** The payload carries the
 * league as it stands now plus every completed move back to its far end, newest
 * first; the state at a stop is that current roster with the newest `back` of
 * those moves reversed. So `back` of 0 is today and `back` of `events.length` is
 * the league as it stood before the oldest move on file.
 *
 * **`back` rather than a stop index is the state the host holds**, and that is a
 * decision rather than a spelling. The payload arrives after the card opens, so
 * an index into a list that does not exist yet has to be reconciled when it
 * does; a count back from now is 0 before the request lands and 0 after it,
 * which is exactly the "it opens as it always did" promise the rail makes. The
 * slider does the inversion, since a reader drags left into the past.
 *
 * **The reversal itself is not here.** It is `shared/timeline/rewind`, the same
 * function the route's own read is built on — undoing a move is one definition,
 * and a second one on this side of the wire would be a second answer. What is
 * here is what a *reader* needs on top: which stops exist, what each one is
 * called, and how a rewound roster is drawn.
 *
 * Pure and free of runtime imports it cannot resolve, so it tests like its
 * neighbours: the rewind arrives relatively with an explicit `.ts` extension,
 * and everything from the contract is an erased `import type`.
 */

/** How many moves the rail spans — one stop per move, plus "now". */
export function timelineMoveCount(payload: RosterTimelinePayload | null): number {
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
   * the far end of the rail — the league as it stood *before* the oldest move on
   * file, which is the only stop named by a move it does not include.
   */
  kind: "now" | "after" | "before";
  /**
   * The move that produced this state, or — at the far end — the move this state
   * comes before. Null only when there is no timeline at all.
   */
  event: TimelineEventPayload | null;
  /** When this state came into being, epoch milliseconds. Null at `now`. */
  at: number | null;
};

/**
 * The stop a rail position describes.
 *
 * The arithmetic worth stating once: with `events` newest-first and `back` moves
 * reversed, what is left standing is everything from `events[back]` older — so
 * `events[back]` is the move that *produced* this state, and it is what dates
 * and names the stop. At `back` of 0 that move is the most recent one in the
 * league, which is another way of saying "now", so the present is named rather
 * than dated by a move a reader has no reason to care about. At the far end
 * there is no `events[back]`, because every move on the rail has been undone;
 * that stop is named by the oldest one, which it comes before.
 *
 * `back` is clamped, for `rewindRosters`' reason: it arrives from a slider, and
 * a value past the end means "as far back as this goes".
 */
export function timelineStop(
  payload: RosterTimelinePayload | null,
  back: number,
): TimelineStop {
  const events = payload?.timeline?.events ?? [];
  const at = Math.min(Math.max(back, 0), events.length);

  if (at === 0) return { back: 0, kind: "now", event: events[0] ?? null, at: null };
  if (at >= events.length) {
    const oldest = events[events.length - 1] ?? null;
    return { back: at, kind: "before", event: oldest, at: oldest?.at ?? null };
  }
  return { back: at, kind: "after", event: events[at], at: events[at].at };
}

/** One roster as it stood at a stop, ready to draw. */
export type TimelineRoster = {
  roster_id: number;
  /** Who holds it *now* — see {@link timelineRosters}. */
  name: string;
  players: string[];
  picks: RosterPick[];
};

/**
 * Every roster in the league as it stood at one stop, in roster-id order.
 *
 * **The order is the league's own and never the moment's**, which is the one
 * thing a scrubbed list must not get wrong: the card's teams pane sorts by
 * whichever metric it is showing, and a past stop has no metric to sort by — a
 * list that re-sorted under a dragging finger would be unreadable whatever it
 * sorted on. Roster id is stable at every stop by construction.
 *
 * **The manager naming a block is today's, and that is the honest limit rather
 * than an oversight.** Sleeper's `rosters` is only ever *now*, so who held
 * roster 4 last October is not a thing this database stores; what the block says
 * is "roster 4, which so-and-so holds today". Naming it after a manager who has
 * since taken it over is a smaller error than not naming it at all, and it is
 * the same reading `leagueRosterPicks` takes of an owner who has left.
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

  return timeline.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    name: roster.name,
    players: states.get(roster.roster_id)?.players ?? [],
    picks: states.get(roster.roster_id)?.picks ?? [],
  }));
}

/**
 * How a move is named on the rail: what kind it was.
 *
 * Sleeper's `type` is a machine word (`free_agent`), so the known ones are
 * spelled out and anything else has its underscores opened rather than being
 * dropped — a move this app has not met is still a move, and reporting it as
 * blank would read as a rendering fault at exactly the stop a reader scrubbed
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
 * A player the payload cannot name falls back to his id, the same fallback every
 * other list in the app makes. Past {@link NAMED_MOVERS} the rest are counted:
 * this line sits on one rail beside a date, and a nine-player trade would take
 * the row.
 */
export function movedPlayerNames(
  event: TimelineEventPayload | null,
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
 * What a stop *is*, in words.
 *
 * Three readings, because the three kinds of stop answer different questions.
 * The present needs no move to name it; the far end is named by what it comes
 * *before*, which is the one stop whose move is not part of it; and everything
 * between is named by the move that produced it.
 *
 * **Two readers, which is why it is here rather than in the rail.** The slider
 * announces it as its `aria-valuetext`, so somebody arrowing along the control
 * hears "after waiver · Josh Allen" rather than a number; and the caveat under
 * the panes leads with it, because that is where a reader who has scrolled past
 * the rail finds out what they are looking at. Two spellings of a moment is how
 * the two would come to name different moves.
 */
export function stopSummary(
  stop: TimelineStop,
  players: Readonly<Record<string, PlayerSummary>>,
): string {
  if (stop.kind === "now") return "as they stand today";
  if (stop.kind === "before") return "before the oldest move on file";

  const kind = moveKindLabel(stop.event?.type ?? null);
  const moved = movedPlayerNames(stop.event, players);
  return moved
    ? `after ${kind.toLowerCase()} · ${moved}`
    : `after ${kind.toLowerCase()}`;
}

/**
 * The line under a past league, which has three jobs and states all of them
 * plainly.
 *
 * It says *what* moment this is, because the rail's own readout is a row up and
 * a reader who has scrolled the card can no longer see it — and the rail can
 * only afford a date, so this is the one place the move itself is named. It
 * says *when*. And it says the rosters are **reconstructed**, because nothing
 * about a list of names admits that it was derived: Sleeper stores no history,
 * so this is today's rosters with every move since undone.
 *
 * **Only the draft limit is stated, and that is a judgement rather than an
 * omission.** `shared/timeline/rewind` documents two: a draft is not a
 * transaction, and the pick horizon is today's. The first is visible in the
 * rosters on screen — a rookie class sitting on teams that had not drafted it
 * yet — and the second shows up as picks quietly absent, which no wording on a
 * two-line note is going to make legible. A caveat that lists everything is one
 * nobody finishes.
 *
 * It takes the formatted date rather than the instant, so this module stays free
 * of the formatter and the rail keeps one spelling of a moment.
 */
export function timelineCaveat(when: string, summary: string): string {
  const lead = summary
    ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}. `
    : "";
  return `${lead}Every roster as it stood on ${when}, reconstructed by undoing every move since — so a class drafted after this date is already on the roster that took it.`;
}

/**
 * Where the positions sort in a rewound roster.
 *
 * A past roster has no lineup: seating one would need the projections and the
 * scoring for a week that is over, which is a different question from the one
 * the rail is asking. So it is grouped the way a roster page groups — by
 * position, in the order a lineup fills — and everything the players map cannot
 * place sorts last under its own heading rather than being dropped.
 */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** A player as a rewound roster draws him — the summary, or the bare id. */
export type TimelinePlayer = {
  player_id: string;
  name: string;
  position: string | null;
};

/**
 * Whether an id is a player at all.
 *
 * Sleeper pads an unfilled roster slot with an empty id or a literal `"0"`, and
 * a row reading `0` is a rendering fault wearing a player's seat. One spelling,
 * two readers: the count beside a team in the list and the rows in the pane
 * beside it must not disagree about how many players a roster held.
 */
const isHeldPlayer = (id: string): boolean => Boolean(id) && id !== "0";

/** How many players a roster held at a stop — the number the teams list shows. */
export function timelineRosterSize(playerIds: readonly string[]): number {
  return playerIds.reduce((total, id) => total + (isHeldPlayer(id) ? 1 : 0), 0);
}

/**
 * One roster's players at a stop, grouped by position in lineup order.
 *
 * An id the players map has no row for keeps its **id** — a visible, searchable
 * token beats a blank, which is the same call every other list here makes.
 */
export function timelineRosterGroups(
  playerIds: readonly string[],
  players: Readonly<Record<string, PlayerSummary>>,
): { position: string; players: TimelinePlayer[] }[] {
  const groups = new Map<string, TimelinePlayer[]>();

  for (const id of playerIds) {
    if (!isHeldPlayer(id)) continue;
    const summary = players[id];
    const position = summary?.position ?? null;
    const key = position ?? "—";
    const list = groups.get(key);
    const player: TimelinePlayer = {
      player_id: id,
      name: summary?.name || id,
      position,
    };
    if (list) list.push(player);
    else groups.set(key, [player]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...groups.entries()]
    .map(([position, players]) => ({ position, players }))
    .sort((a, b) => positionRank(a.position) - positionRank(b.position));
}

function positionRank(position: string): number {
  const at = POSITION_ORDER.indexOf(position);
  return at === -1 ? POSITION_ORDER.length : at;
}

/**
 * A rewound roster's picks in the shape the card's own `DraftPicks` draws.
 *
 * **Reusing that component rather than drawing a second pick grid** is what
 * keeps "now" and "then" the same object: the seasons group into the same
 * plates, a pick reads by its round the same way, and an acquired one names the
 * roster it came from. Two of its three fields are deliberately null, and both
 * absences are the honest reading rather than a gap:
 *
 * - **`slot`** is where a pick falls once a draft order is set, and an order is
 *   a fact about a draft rather than about a moment — but the *holder* at this
 *   stop may not be the roster whose slot the card resolved, so printing one
 *   would attribute today's board position to a past portfolio. A round is what
 *   this can say without claiming.
 * - **`value`** is a KeepTradeCut price, which is today's market. Pricing a
 *   past roster on it is a defensible reading and a different one from what the
 *   card's own totals mean; until the rail has a market of its own to name, an
 *   absent price is the answer that cannot mislead.
 *
 * `from` is relative to the roster holding the pick — the same asset is "from
 * Slim" in one portfolio and origin-less in the one it came out of.
 */
export function timelinePickAssets(
  roster: TimelineRoster,
  rosters: readonly TimelineRoster[],
): CardRosterPick[] {
  return roster.picks.map((pick) => ({
    season: pick.season,
    round: pick.round,
    slot: null,
    from:
      pick.roster_id === roster.roster_id
        ? null
        : (rosters.find((r) => r.roster_id === pick.roster_id)?.name ??
          `Roster ${pick.roster_id}`),
    value: null,
  }));
}

import { rewindRosters } from "../../shared/timeline/rewind.ts";
import type { RosterPick, RosterState } from "../../shared/timeline/rewind.ts";
import type {
  PlayerSummary,
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
 * **The rail spans every season the payload holds, and a season is a replay of
 * its own.** `back` counts stops across the whole chain, and {@link timelineStop}
 * is what turns it into a season and a count within that season. Crossing a year
 * is a *jump* rather than a reversal — the stop after the oldest move of one
 * season is the season before it **as it ended**, and what happened in between
 * (a rookie draft, an offseason of drops) is exactly what no transaction
 * records. That is why the boundary has a `kind` of its own and why the rail
 * marks it: presenting two years as adjacent notches would be the claim the
 * whole reconstruction is arranged to avoid. See `shared/timeline/read` for why
 * a chain is sound where one continuous walk is not.
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

/**
 * How far back the rail runs — the largest `back` it can be dragged to.
 *
 * Each season contributes one stop per move **plus one** for the state it ended
 * in; the head season's extra stop is "now", so the total is one less than the
 * sum. On a single-season payload this is exactly that season's move count,
 * which is what it has always been.
 */
export function timelineMoveCount(payload: RosterTimelinePayload | null): number {
  const seasons = payload?.timeline?.seasons ?? [];
  return Math.max(
    0,
    seasons.reduce((sum, season) => sum + season.events.length + 1, 0) - 1,
  );
}

/**
 * Every `back` at which the rail crosses into an earlier season.
 *
 * The rail draws a tick at each, because a boundary is a discontinuity: the
 * rosters change wholesale across it for reasons no move on file explains.
 * Empty on a single-season payload, so nothing is drawn where nothing is
 * crossed.
 */
export function timelineSeasonBoundaries(
  payload: RosterTimelinePayload | null,
): number[] {
  const seasons = payload?.timeline?.seasons ?? [];
  const marks: number[] = [];
  let offset = 0;
  for (const season of seasons) {
    if (offset > 0) marks.push(offset);
    offset += season.events.length + 1;
  }
  return marks;
}

/**
 * The earlier season a reader can ask for, and the oldest one already in hand.
 *
 * Null where the chain is complete — where Sleeper names no season before the
 * oldest stored one, or where this database already holds it. It is what the far
 * end of the rail offers to fetch; see the timeline route's `POST`.
 *
 * **It names the season it comes *before* rather than its own year**, because
 * its own year is not knowable until it has been fetched. Sleeper's chain is
 * consecutive in practice, so subtracting one would usually be right — and
 * "usually" is not a thing to print beside a date on a control that then loads
 * something else.
 */
export function timelineEarlier(
  payload: RosterTimelinePayload | null,
): { leagueId: string; beforeSeason: string } | null {
  const timeline = payload?.timeline;
  const leagueId = timeline?.earlier_league_id ?? null;
  if (!timeline || leagueId === null) return null;

  const oldest = timeline.seasons[timeline.seasons.length - 1];
  return { leagueId, beforeSeason: oldest?.season ?? "" };
}

/** What a reader is looking at when the rail is at one position. */
export type TimelineStop = {
  /** How many stops back from now the rail is. 0 is now. */
  back: number;
  /**
   * Which of the four kinds of moment this is.
   *
   * `now` is the present. `after` is the league as one move left it. `before` is
   * the oldest stop of a season — that year as it stood *before* its oldest move
   * on file, the only stop named by a move it does not include. `season-end` is
   * an earlier season as it *finished*, which is the first stop on the far side
   * of a year boundary and is reached by a jump rather than by reversing
   * anything.
   */
  kind: "now" | "after" | "before" | "season-end";
  /**
   * The move that produced this state, or — at a season's oldest stop — the move
   * this state comes before. Null at a season's end, which no move produced, and
   * where there is no timeline at all.
   */
  event: TimelineEventPayload | null;
  /**
   * When this state came into being, epoch milliseconds.
   *
   * Null at `now` and at `season-end`, and for the same reason in both: neither
   * is a moment a move stamped. A season's final rosters stood from its last
   * recorded move until the league rolled over, and dating them by that move
   * would put a day on a state that outlived it by months.
   */
  at: number | null;
  /** Which year this stop is in — `leagues.season`. */
  season: string;
  /** Which league id ran that year. */
  leagueId: string;
  /** Where this season sits in the chain; 0 is the league the card shows. */
  seasonIndex: number;
  /**
   * How many of *that season's* moves are reversed — what the rewind takes.
   *
   * The distinction from `back` is the whole of the chain: `back` is a position
   * on the rail and this is a count within one replay, and only the second means
   * anything to `rewindRosters`.
   */
  localBack: number;
};

/**
 * The stop a rail position describes.
 *
 * The arithmetic worth stating once: within a season, with `events` newest-first
 * and `localBack` moves reversed, what is left standing is everything from
 * `events[localBack]` older — so `events[localBack]` is the move that *produced*
 * this state, and it is what dates and names the stop. At a `localBack` of 0 in
 * the head season that move is the most recent one in the league, which is
 * another way of saying "now", so the present is named rather than dated by a
 * move a reader has no reason to care about. At a season's oldest stop there is
 * no `events[localBack]`, because every move that season has been undone; that
 * stop is named by the oldest one, which it comes before.
 *
 * **A `localBack` of 0 in any *earlier* season is that season's end**, not a
 * second "now" — the rosters Sleeper froze when the year finished. It is checked
 * before the oldest-stop arm so that a season with no stored moves reads as the
 * year it ended rather than as the year before its first move, which would be
 * the same rosters under a sentence claiming less.
 *
 * `back` is clamped, for `rewindRosters`' reason: it arrives from a slider, and
 * a value past the end means "as far back as this goes".
 */
export function timelineStop(
  payload: RosterTimelinePayload | null,
  back: number,
): TimelineStop {
  const seasons = payload?.timeline?.seasons ?? [];
  const clamped = Math.min(Math.max(back, 0), timelineMoveCount(payload));

  let offset = 0;
  for (const [seasonIndex, season] of seasons.entries()) {
    const span = season.events.length + 1;
    if (clamped >= offset + span && seasonIndex < seasons.length - 1) {
      offset += span;
      continue;
    }

    const events = season.events;
    const localBack = Math.min(clamped - offset, events.length);
    const where = {
      back: clamped,
      season: season.season,
      leagueId: season.league_id,
      seasonIndex,
      localBack,
    };

    if (localBack === 0) {
      return seasonIndex === 0
        ? { ...where, kind: "now", event: events[0] ?? null, at: null }
        : { ...where, kind: "season-end", event: null, at: null };
    }
    if (localBack >= events.length) {
      const oldest = events[events.length - 1] ?? null;
      return { ...where, kind: "before", event: oldest, at: oldest?.at ?? null };
    }
    return { ...where, kind: "after", event: events[localBack], at: events[localBack].at };
  }

  // No seasons at all — the payload has no timeline, which every caller reads as
  // "nothing to draw" rather than as a position of its own.
  return {
    back: 0,
    kind: "now",
    event: null,
    at: null,
    season: "",
    leagueId: "",
    seasonIndex: 0,
    localBack: 0,
  };
}

/** One roster as it stood at a stop, ready to draw. */
export type TimelineRoster = {
  roster_id: number;
  /** What that season's own member list calls it — see {@link timelineRosters}. */
  name: string;
  /** The holder's user id, which is how the solve finds the manager's team. */
  user_id: string | null;
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
 * **The manager naming a block is that season's, and within a season it is that
 * season's *end*.** Sleeper's `rosters` is only ever the state a league finished
 * in, so who held roster 4 last October is not a thing this database stores;
 * what a block says is "roster 4, as this season's member list names it". Across
 * a year that is strictly right — each season carries its own `league_users`, so
 * a manager who has since left still names the team they held — and within one
 * it is the same approximation it has always been: naming a block after somebody
 * who took it over mid-season is a smaller error than not naming it at all, and
 * it is the reading `leagueRosterPicks` takes of an owner who has left.
 */
export function timelineRosters(
  payload: RosterTimelinePayload | null,
  back: number,
): TimelineRoster[] {
  const seasons = payload?.timeline?.seasons ?? [];
  if (seasons.length === 0) return [];

  // **The season's own rosters and the season's own log**, which is what makes a
  // year boundary sound: an earlier season is rewound from the state Sleeper
  // froze when it ended, never from this year's rosters carried backwards
  // through an offseason no transaction records.
  const stop = timelineStop(payload, back);
  const season = seasons[stop.seasonIndex];
  if (!season) return [];

  const current = new Map<number, RosterState>(
    season.rosters.map((r) => [
      r.roster_id,
      { players: r.players, picks: r.picks },
    ]),
  );
  const states = rewindRosters(current, season.events, stop.localBack);

  return season.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    name: roster.name,
    user_id: roster.user_id,
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
 * Four readings, because the four kinds of stop answer different questions.
 * The present needs no move to name it; a season's end is named by the year
 * rather than by a move, since no move produced it and the last one that did
 * anything may be months earlier; a season's oldest stop is named by what it
 * comes *before*, which is the one stop whose move is not part of it; and
 * everything between is named by the move that produced it.
 *
 * **A year is named wherever a reader could be in the wrong one.** Inside a
 * season a date carries it, and at the two ends of a season — where there is no
 * date, or where the date belongs to a move the stop excludes — the year is said
 * outright.
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
  if (stop.kind === "season-end") return `as the ${stop.season} season ended`;
  if (stop.kind === "before") {
    return `before the oldest ${stop.season} move on file`;
  }

  const kind = moveKindLabel(stop.event?.type ?? null);
  const moved = movedPlayerNames(stop.event, players);
  return moved
    ? `after ${kind.toLowerCase()} · ${moved}`
    : `after ${kind.toLowerCase()}`;
}

/**
 * The line under a past league, which has four jobs and states all of them
 * plainly.
 *
 * It says *what* moment this is, because the rail's own readout is a row up and
 * a reader who has scrolled the card can no longer see it — and the rail can
 * only afford a date, so this is the one place the move itself is named. It
 * says *when*. It says the rosters are **reconstructed**, because nothing about
 * a list of names admits that it was derived: Sleeper stores no history, so
 * this is a stored roster set with every move since undone.
 *
 * **And it says what that set was rewound *from*, which is the one thing a
 * chain makes ambiguous.** Inside the season the card shows, the anchor is
 * today's rosters. In an earlier season it is the rosters Sleeper froze when
 * that year finished — a different anchor, reached by a jump rather than by
 * reversing anything, because rosters carry over between seasons through no
 * transaction at all. A reader who has scrubbed across a year is looking at a
 * second reconstruction, and the sentence says so rather than letting the rail's
 * continuity imply one long walk.
 *
 * And it says **the numbers are today's**, which is the one thing a reader
 * would otherwise get exactly backwards. The table above is the card's own, so
 * every figure in it reads as a figure — and a projection, an ADP and a KTC
 * price are all *now*, because this app stores no history of any of the three.
 * What the past pane answers is therefore a counterfactual, "what would this
 * roster be worth today", and saying so is what separates it from a claim about
 * October. See `timeline-entry` for why that is the question worth answering.
 *
 * **Only the draft limit is stated of the reconstruction's two**, and that is a
 * judgement rather than an omission. `shared/timeline/rewind` documents two: a
 * draft is not a transaction, and the pick horizon is today's. The first is
 * visible in the rosters on screen — a rookie class sitting on teams that had
 * not drafted it yet — and the second shows up as picks quietly absent, which no
 * wording on a two-line note is going to make legible. A caveat that lists
 * everything is one nobody finishes.
 *
 * It takes the formatted date rather than the instant, so this module stays free
 * of the formatter and the rail keeps one spelling of a moment. Null where the
 * stop has no date at all, which is a season's end: no move stamped it, and the
 * state stood from the year's last recorded move until the league rolled over.
 */
export function timelineCaveat(
  stop: TimelineStop,
  when: string | null,
  summary: string,
): string {
  const lead = summary
    ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}. `
    : "";
  const priced =
    " — and priced at today's values, so these are what each team would be " +
    "worth now rather than what it was worth then.";

  if (stop.kind === "season-end") {
    return (
      `${lead}Every roster as Sleeper kept it when the ${stop.season} season ` +
      `rolled over${priced}`
    );
  }

  const rewound =
    stop.seasonIndex === 0
      ? "reconstructed by undoing every move since"
      : `reconstructed from that season's final rosters by undoing every ${stop.season} move since`;
  const dated = when === null ? "at this point" : `on ${when}`;
  return `${lead}Every roster as it stood ${dated}, ${rewound}${priced}`;
}

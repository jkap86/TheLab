import type { LineupCheckIrPlayer, LineupCheckLeague } from "@/shared/contract";

import { SLOT_POSITIONS } from "../../../shared/projections/slots.ts";

/**
 * How a league's week reads on the four tiles the card carries.
 *
 * Pure, and the contract arrives as an erased `import type`, so this tests
 * under Node's runner without a render behind it — the bar
 * `features/manager/helpers/lineup-metrics.ts` holds, and the reason the
 * grammar below is testable at all. The slot vocabulary comes in relatively
 * with a `.ts` extension for the same reason: the runner strips types but does
 * not know the `@/*` aliases.
 *
 * **The grammar is four-way, and it is the whole readability of the page.**
 * Every tile says one of four things:
 *
 * - an **alert** — a number the reader can act on;
 * - a **clear** — a real and good answer (`Set`, `In order`, `QB seated`,
 *   `Full`). The tile draws a **checkmark** and keeps the word as its
 *   accessible name;
 * - a **count** — a real figure that is *not* a problem, and a check there
 *   would delete it. Nothing produces one today: an open roster spot, which
 *   was the case it was written for, is an alert now (see {@link rosterCell});
 * - a **none** — no answer at all: the em dash.
 *
 * A zero and an absence must never render the same. That is what the whole
 * contract is written to — `points_left: 0` beside `kickoff_moves: null` is a
 * lineup that is optimal in a league whose seat order cannot be known — and a
 * tile that printed `0` for both would quietly claim the second was checked.
 *
 * **The tile draws three of the four and not four**, which reverses what this
 * note used to require of it. `alert` and `count` are both *figures* — a number
 * the reader is being handed — and the card strikes them alike, in red, so that
 * a row of four tiles reads as "the mark, or something it is telling you"
 * rather than as four differently-toned readings. That is a decision about
 * ink, and this file keeps all four states regardless, because the two that
 * share an ink do **not** share a meaning where it counts:
 * {@link needsAttention} and {@link attentionByReason} read `alert` alone, so a
 * `count` is a figure the header does not send anybody to. Nothing answers
 * `count` today — an open roster spot is an alert, since it is a trip to
 * Sleeper — and the state is kept because it is the one place that distinction
 * is written down, ready for the next figure that is a reading rather than a
 * fault.
 *
 * **It was a boolean `alert`, and the checkmark is what ended that.** A mark
 * saying "nothing to do here" is not the same answer as a figure that merely
 * happens not to be a problem, and one flag cannot tell the two apart. The
 * state is a union rather than a second boolean so the tile's own `switch` has
 * to place a fifth tone before it will compile.
 */

/**
 * One tile's reading, in the two shapes a tile is drawn in.
 *
 * **A desktop tile has room for the whole reading on one line and a phone tile
 * does not.** Four tiles across a 390pt card is ~72px of content each, where
 * `2 to move` at `--fs-21` is half again that — so the phone splits the reading
 * into a numeral it can set large and the words under it, and the desktop
 * prints it whole. Same measurement, two rooms.
 *
 * The four fields are produced side by side, once per arm, which is the whole
 * guarantee that they agree: there is no rule turning one into another and
 * therefore no rule to get wrong. `lineup-check-metrics.test.ts` pins the
 * quartet per arm rather than a relation between them.
 */
export type MetricCell = {
  /**
   * The whole reading, as the desktop prints it — and, in the `clear` state,
   * the checkmark's `sr-only` name rather than nothing at all: the mark is the
   * whole of what a sighted reader gets, so the word has to stay for everyone
   * else.
   */
  text: string;
  /**
   * The numeral the phone sets large, or an em dash where there is no number
   * to set. Unread in the `clear` state, where the mark *is* the figure.
   */
  figure: string;
  /**
   * The words the phone prints under the figure — `pts`, `to move`, `open`.
   * Empty where the figure needs none.
   */
  unit: string;
  /**
   * The tile's second label line, under its name: **what the figure was
   * measured over**, and empty where nothing was measured.
   *
   * Empty is a real state rather than a gap in the copy. A tile that cannot
   * answer has no population to name, and a line saying what it *would* have
   * measured reads as a claim that it did — which is the same distinction the
   * em dash draws one line down. The tile reserves the height either way, so
   * the figures across a row stay on one baseline.
   */
  scope: string;
  /** Which of the four things this tile is saying — see the module note. */
  state: MetricState;
  /** The hover and screen-reader gloss, which is where the units live. */
  title: string;
};

/** The four tones a tile has — see the module note. */
export type MetricState = "alert" | "clear" | "count" | "none";

/** Points to one decimal — the granularity Sleeper's projections carry. */
const points = (n: number): string => n.toFixed(1);

/** What every tile prints where the league could not be projected at all. */
const NO_ANSWER: MetricCell = {
  text: "—",
  figure: "—",
  unit: "",
  scope: "",
  state: "none",
  title: "No projection for this week",
};

/**
 * What this lineup is leaving on the bench.
 *
 * Read off `points_left` rather than by subtracting the two totals: the server
 * has already decided whether the lineup is optimal, and a second subtraction
 * on the client is a second chance to land a hair either side of zero and print
 * `-0.0` under a lineup that is already the best available.
 *
 * Negative on purpose where there is a gap — it is a debt, not a bonus, and a
 * bare `6.6` in a column headed "vs optimal" reads as the good direction.
 */
export function gapCell(league: LineupCheckLeague | null | undefined): MetricCell {
  if (!league) return NO_ANSWER;

  const starting = points(league.current_points);
  if (league.best_ball) {
    // Sleeper seats this lineup itself, after the games. There is no gap to
    // report because there is no lineup anybody sets.
    return {
      // A word rather than a check: nothing was *checked*, so a mark claiming
      // the lineup came back clear would be an answer nobody solved for.
      text: "Best ball",
      // The phone sets an em dash and says why underneath, where the desktop
      // has the room to say it on one line: `Best ball` at `--fs-17` is a third
      // wider than the tile it would have to fit in.
      figure: "—",
      unit: "best ball",
      scope: "Sleeper seats it",
      state: "none",
      title: `Starting ${starting} — Sleeper seats a best-ball lineup itself, so there is nothing to move`,
    };
  }
  if (league.points_left === 0) {
    return {
      text: "Set",
      figure: "",
      unit: "set",
      scope: "Best reachable",
      state: "clear",
      title: `Starting ${starting}, which is the best lineup still reachable`,
    };
  }
  return {
    text: `−${points(league.points_left)}`,
    figure: `−${points(league.points_left)}`,
    // The one unit the desktop leaves off: `−6.6` under `Vs optimal / Best
    // reachable` is already a complete reading, where the phone's bare numeral
    // has nothing above it naming what was counted.
    unit: "pts",
    scope: "Best reachable",
    state: "alert",
    title:
      `Starting ${starting} against ${points(league.optimal_points)} still reachable — ` +
      `${points(league.points_left)} to be had by moving somebody`,
  };
}

/**
 * Whether the starters are seated in the order they lock best in.
 *
 * `null` is the case worth being careful about: it is *no answer* — a best-ball
 * league, or a week the schedule publishes no kickoff instants for — and never
 * "already in order". Zero really is in order, and says so in words.
 */
export function kickoffCell(
  league: LineupCheckLeague | null | undefined,
): MetricCell {
  if (!league) return NO_ANSWER;

  const moves = league.kickoff_moves;
  if (moves === null) {
    return {
      ...NO_ANSWER,
      // Two different absences, and the scope line is where they part: one is
      // a league with no seat order to set and the other is a week Sleeper has
      // not published kickoffs for. The em dash above is the same either way.
      scope: league.best_ball ? "Sleeper seats it" : "No kickoff times",
      title: league.best_ball
        ? "No seat order to set — Sleeper seats a best-ball lineup after the games"
        : "No kickoff order for this week — Sleeper has published no kickoff times",
    };
  }
  if (moves === 0) {
    return {
      text: "In order",
      figure: "",
      unit: "in order",
      scope: "Seat order",
      state: "clear",
      title:
        "Every starter is already seated for kickoff — strict slots lock first, " +
        "the flexes stay open longest. Games within an hour of each other count as one kickoff",
    };
  }
  return {
    text: `${moves} to move`,
    figure: `${moves}`,
    unit: "to move",
    scope: "Seat order",
    state: "alert",
    title:
      `${moves} starter${moves === 1 ? "" : "s"} could trade seats so the flexes lock last — ` +
      "open the league for the moves",
  };
}

// The one spelling of a kickoff as a reader's clock prints it lives in
// `features/shared/format`, since the gametime seat rows print it too; it is
// re-exported here so this module's readers and its test are unchanged, and
// read relatively with `.ts` because Node's runner does not know the alias.
export { kickoffTime } from "../../shared/format.ts";

/**
 * The slots a superflex check is about: a starting seat a quarterback may fill
 * that is **not** a quarterback-only seat.
 *
 * Derived from {@link SLOT_POSITIONS} rather than spelled `"SUPER_FLEX"`, the
 * way `QB_ELIGIBLE_STARTING_SLOTS` and `DEFENSIVE_SLOTS` are derived: the day
 * the solver learns another superflex-shaped slot (Sleeper's `OP` is the one
 * already in the fixtures), this check reads the same set the solver seats
 * from rather than quietly ignoring it. A bare `QB` seat is excluded because a
 * non-QB cannot legally sit in one, so a non-QB found there is a Sleeper bug
 * rather than a lineup decision.
 */
const SUPERFLEX_SLOTS = new Set(
  Object.entries(SLOT_POSITIONS)
    .filter(([, positions]) => positions.includes("QB") && positions.length > 1)
    .map(([slot]) => slot),
);

/**
 * Whether a superflex seat is being spent on somebody who is not a quarterback.
 *
 * **Every occurrence is flagged, whether or not a spare quarterback is on the
 * bench.** That is deliberate and it is the reading the check is for: a
 * superflex seat filled by a running back is a decision worth seeing even when
 * there is nobody to put in it, because what it says is "this roster is short a
 * startable quarterback" — which is a trade to make, not a lineup to fix. The
 * gap tile opposite already answers the narrower question of whether a move
 * available right now would score more.
 *
 * An **empty** superflex seat is not counted here. Empty seats belong to the
 * gap check, which prices them; counting them twice would put one league on two
 * reasons for one fault.
 */
export function superflexCell(
  league: LineupCheckLeague | null | undefined,
): MetricCell {
  if (!league) return NO_ANSWER;

  const seats = league.lineup.filter((seat) => SUPERFLEX_SLOTS.has(seat.slot));
  if (seats.length === 0 || league.best_ball) {
    return {
      ...NO_ANSWER,
      scope: league.best_ball ? "Sleeper seats it" : "No superflex slot",
      title: league.best_ball
        ? "No seat to spend — Sleeper seats a best-ball lineup after the games"
        : "No superflex slot in this league",
    };
  }

  // The population, named on the scope line: this is the one check whose
  // figure counts a subset of something the reader cannot otherwise see, and
  // `1 non-QB` reads very differently against one seat than against three.
  const checked = `${seats.length} QB seat${seats.length === 1 ? "" : "s"}`;

  const spent = seats.filter(
    (seat) => seat.player !== null && !seat.player.positions.includes("QB"),
  );
  if (spent.length === 0) {
    return {
      text: "QB seated",
      figure: "",
      unit: "seated",
      scope: checked,
      state: "clear",
      title: `Every superflex seat is a quarterback — ${seats.length} seat${
        seats.length === 1 ? "" : "s"
      } checked`,
    };
  }

  return {
    text: `${spent.length} non-QB`,
    figure: `${spent.length}`,
    unit: "non-QB",
    scope: checked,
    state: "alert",
    title:
      `${spent.length} superflex seat${spent.length === 1 ? "" : "s"} not held by a quarterback: ` +
      spent
        .map(
          (seat) =>
            `${seat.player?.name ?? seat.player?.player_id} at ${seat.slot}`,
        )
        .join(", "),
  };
}

/**
 * The IR moves a league wants, as arithmetic against its census.
 *
 * The wire carries *judgements* — who is on IR and whether each may stay, who
 * on the active roster the league would admit — and this is the one place
 * those become *moves*, read by the roster tile and by the row marks in the
 * expanded card alike, so a tile saying `1 to IR` and a bench with two `→ IR`
 * chips on it cannot be two readings of one league.
 *
 * - **`off`** is who must come off IR: every ineligible player, or the overflow
 *   past the allowance, whichever is more. The two are one number rather than
 *   two because they are one instruction — a healthy player and a fourth
 *   player on a three-slot IR are both "move somebody off", and where the
 *   ineligible one *is* the overflow, moving him fixes both.
 * - **`free`** is the slots open once they have, floored at zero: `ir_max` less
 *   what is still parked.
 * - **`candidates`** are the stashable players whose game has not kicked off.
 *   A locked player is not a move anybody can make this week, and a tile
 *   offering one is the claim the whole check exists to stop making — so the
 *   lock rules him out here, where the moves are made, and the wire's list
 *   stays what the rules say. `lockedOut` counts them so the title can say
 *   the room is there and the move is not.
 * - **`stash`** is how many of the candidates there is room for. Every
 *   candidate is a true fact about a designation (see the contract), so the
 *   list is not trimmed to the room; `stash` is.
 * - **`after`** is the active roster once both moves are made — the count the
 *   tile's title states the open spots or the forced drops from, which is what
 *   "factor in adds and drops after this" means on this card.
 *
 * Null only where the league states no IR allowance at all (`ir_max` null), on
 * the census's own rule. An **unchecked** reading (`ir` null: rules unknown, or
 * the status read failed) still answers — the overflow is a count the census
 * made — with empty lists and `checked: false`, so the tile can say the one
 * thing it knows and the one thing it could not.
 */
export type IrMoves = {
  /** Whether the reading was made at all — `league.ir !== null`. */
  checked: boolean;
  /** Everyone on IR now; empty when unchecked. */
  reserve: LineupCheckIrPlayer[];
  /** Those of them the league's rules do not admit. */
  ineligible: LineupCheckIrPlayer[];
  /** Players that must come off IR — the ineligible, or the overflow, whichever is more. */
  off: number;
  /** IR slots free once they have; never negative. */
  free: number;
  /** Active players the league admits on IR whose game has not kicked off; empty when unchecked. */
  candidates: LineupCheckIrPlayer[];
  /** Admitted players left out of `candidates` because their game has kicked off. */
  lockedOut: number;
  /** How many of the candidates there is room for. */
  stash: number;
  /** The active roster once `off` are activated and `stash` are parked. */
  after: number;
  /** Players whose eligibility could not be judged; 0 when unchecked. */
  unknown: number;
};

export function irMoves(league: LineupCheckLeague): IrMoves | null {
  if (league.ir_max === null) return null;

  const reading = league.ir;
  const reserve = reading?.reserve ?? [];
  const ineligible = reserve.filter((player) => player.eligible === false);
  const overflow = Math.max(0, league.ir_count - league.ir_max);
  const off = Math.max(ineligible.length, overflow);
  const free = Math.max(0, league.ir_max - (league.ir_count - off));
  const stashable = reading?.stashable ?? [];
  const candidates = stashable.filter((player) => !player.locked);
  const stash = Math.min(free, candidates.length);

  return {
    checked: reading !== null,
    reserve,
    ineligible,
    off,
    free,
    candidates,
    lockedOut: stashable.length - candidates.length,
    stash,
    after: league.roster_count + off - stash,
    unknown: reading?.unknown ?? 0,
  };
}

/**
 * What a row wears for the IR reading: `off` (on IR and not admitted), `on`
 * (on IR), `to` (a candidate, and there is a slot for one), or nothing.
 */
export type IrMark = "off" | "on" | "to";

/**
 * The mark for one player's row, off the same {@link irMoves} the tile reads.
 *
 * **Every candidate is marked once any slot is free**, not the first `stash`
 * of them: the chip says *eligible*, which is true of each, and which one goes
 * is the reader's call — the tile's title is what says how many can. With no
 * slot free no candidate is marked, and a locked player is not a candidate at
 * all, because a chip offering a move Sleeper would refuse is the claim this
 * whole check exists to stop making.
 */
export function irMarkFor(
  playerId: string,
  moves: IrMoves | null,
): IrMark | null {
  if (!moves) return null;
  const parked = moves.reserve.find((player) => player.player_id === playerId);
  if (parked) return parked.eligible === false ? "off" : "on";
  if (
    moves.stash > 0 &&
    moves.candidates.some((player) => player.player_id === playerId)
  ) {
    return "to";
  }
  return null;
}

/**
 * Whether the roster is under or over what the league allows, and whether its
 * IR is set the way the league's own rules would have it.
 *
 * **Three limits, counted apart.** Sleeper enforces IR and taxi against their
 * own allowances rather than against the active roster, so a legal roster with
 * two players stashed on taxi is not two over — see the contract's
 * `roster_count`. Folding them together is how this tile would report a fault
 * nobody can fix.
 *
 * **Under and over are both alerts**, and only `Full` is clear. Under was a
 * `count` on the argument that an open spot is an opportunity rather than a
 * fault; that is true of the *word* and not of the *page*, which answers "how
 * many of my leagues want a press". An unclaimed roster spot wants one — it is
 * a waiver claim to make, and a seat left empty scores nothing every week it
 * stays empty — so it belongs in the count beside the over-full leagues rather
 * than sitting silently on a page whose whole purpose is to name the leagues
 * to open. Over is an alert because Sleeper refuses adds until somebody is
 * dropped. Taxi over its own limit is an alert too.
 *
 * **IR is two arms of its own, and they come first.** A player on IR the
 * league does not admit — a healthy one, an `Out` in a league whose toggle is
 * off — or a fourth player on a three-slot IR is `N off IR`, and it leads
 * because Sleeper refuses every transaction on that roster until it is fixed,
 * the fixing drop included. An empty slot beside an active player the league
 * *would* admit is `N to IR`, ahead of `N over` because a stash clears an
 * overage without losing a player, and ahead of `N open` because the stash is
 * what makes the open count true. Both titles state the roster *after* the
 * move — the spots it opens or the drop it forces — so the reader knows what
 * the press buys before making it. Off and on in one press are sequential
 * rather than summed: the tile shows the move Sleeper blocks on, its title
 * carries the stash that follows, and the next sync redraws the second.
 *
 * **A null reading keeps the census answer.** `Full` beside an IR nobody
 * could judge is still a true count of a real roster, and `none` is the em
 * dash for *no answer at all*; the IR half's absence rides the title, which is
 * the kickoff tile's own precedent for two absences told apart in words. An
 * unjudged player is the same: the tile answers what it knows and says how
 * many it could not.
 */
export function rosterCell(
  league: LineupCheckLeague | null | undefined,
): MetricCell {
  if (!league || league.roster_max === null) {
    return { ...NO_ANSWER, title: "No roster limit on file for this league" };
  }

  const held = `${league.roster_count} of ${league.roster_max} roster spots`;
  // The scope line: the population every figure below is read against, and the
  // reason none of them has to restate it.
  const scope = `${league.roster_count} of ${league.roster_max} held`;
  const spare = [
    league.ir_max === null ? null : `IR ${league.ir_count}/${league.ir_max}`,
    league.taxi_max === null ? null : `taxi ${league.taxi_count}/${league.taxi_max}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const rest = spare ? ` — ${spare}` : "";

  const moves = irMoves(league);
  const caveat = irCaveat(league, moves);
  // An admitted player whose game has started is room the reader cannot use
  // this week; said once, wherever the tile lands, so a `Full` beside an empty
  // IR slot and an `Out` starter does not read as nothing to do.
  const lockedOut =
    moves && moves.lockedOut > 0
      ? `. ${moves.lockedOut} IR-eligible player${moves.lockedOut === 1 ? "" : "s"} locked this week`
      : "";
  const now = `Now ${held} filled${rest}${lockedOut}${caveat}`;

  if (moves && moves.off > 0) {
    const overflow = Math.max(0, league.ir_count - (league.ir_max ?? 0));
    const ineligible = moves.ineligible;
    const some = ineligible.length;
    const allowance = `IR is over its allowance (${league.ir_count}/${league.ir_max})`;
    // Which of the two facts is the reason, or both — the ineligible players
    // are named wherever there are any, since the name is what the reader
    // acts on.
    const reason =
      some === 0
        ? `${allowance} — ${moves.off} must come off`
        : overflow > some
          ? `${who(ineligible)} ${some === 1 ? "is" : "are"} not IR-eligible, and ${allowance} — ${moves.off} must come off`
          : `${who(ineligible)} ${some === 1 ? "is" : "are"} not IR-eligible under this league's rules — ` +
            `Sleeper refuses transactions until ${some === 1 ? "he is" : "they are"} off IR`;
    const on =
      moves.stash > 0
        ? ` and ${moves.stash} on (${who(moves.candidates.slice(0, moves.stash))})`
        : "";
    const surplus =
      moves.stash > 0 && moves.candidates.length > moves.stash
        ? ` — ${moves.candidates.length} eligible for ${moves.stash} slot${moves.stash === 1 ? "" : "s"}`
        : "";
    return {
      text: `${moves.off} off IR`,
      figure: `${moves.off}`,
      unit: "off IR",
      scope,
      state: "alert",
      title:
        `${reason}. After ${moves.off} off IR${on} the roster is ` +
        `${moves.after} of ${league.roster_max}${afterTail(moves.after, league.roster_max)}${surplus}. ${now}`,
    };
  }

  if (moves && moves.stash > 0) {
    const eligible = moves.candidates.length;
    return {
      text: `${moves.stash} to IR`,
      figure: `${moves.stash}`,
      unit: "to IR",
      scope,
      state: "alert",
      title:
        `${moves.free} IR slot${moves.free === 1 ? "" : "s"} open — ${eligible} player${eligible === 1 ? "" : "s"} ` +
        `eligible: ${who(moves.candidates)}. After ${moves.stash} on IR the roster is ` +
        `${moves.after} of ${league.roster_max}${afterTail(moves.after, league.roster_max)}. ${now}`,
    };
  }

  if (league.roster_count > league.roster_max) {
    const over = league.roster_count - league.roster_max;
    return {
      text: `${over} over`,
      figure: `${over}`,
      unit: "over",
      scope,
      state: "alert",
      title:
        `${held} filled — ${over} over the limit, and Sleeper will refuse an add ` +
        `until somebody is dropped${rest}${lockedOut}${caveat}`,
    };
  }

  // The taxi squad is asked only once the active roster is legal, so the one
  // tile never has to say two things at once; the title carries both regardless.
  if (league.taxi_max !== null && league.taxi_count > league.taxi_max) {
    // **Counted as an overage rather than printed as a ratio**, which is what
    // makes it fit beside the three figures above it: `1 over taxi` is the same
    // fact as `taxi 3/2` in the grammar every other arm is written in, and the
    // ratio survives in the title where there is room for it. A `3/2` set at
    // `--fs-17` in a 72px phone tile does not fit at all.
    const over = league.taxi_count - league.taxi_max;
    return {
      text: `${over} over taxi`,
      figure: `${over}`,
      unit: "over taxi",
      scope,
      state: "alert",
      title:
        `Taxi is over its own allowance — ${over} must come off. ` +
        `${held} filled${rest}${lockedOut}${caveat}`,
    };
  }

  if (league.roster_count < league.roster_max) {
    const open = league.roster_max - league.roster_count;
    return {
      text: `${open} open`,
      figure: `${open}`,
      unit: "open",
      scope,
      // **An open spot is an alert**, which reverses what this arm shipped as.
      // The state's one remaining job is whether the league is counted off (the
      // tile draws a figure either way), and an unfilled roster is a move the
      // reader has to make in Sleeper exactly as an over-full one is: a free
      // agent nobody has claimed is points left on the board every week it
      // stays open. The `count` state stays in the union for the tone a future
      // figure-that-is-not-a-fault would want.
      state: "alert",
      title: `${open} roster spot${open === 1 ? "" : "s"} open — ${held} filled${rest}${lockedOut}${caveat}`,
    };
  }

  return {
    text: "Full",
    figure: "",
    unit: "full",
    scope,
    state: "clear",
    title: `Every roster spot is filled — ${held}${rest}${lockedOut}${caveat}`,
  };
}

/** Each player as a title names him: the name the card prints, and his designation. */
function who(players: readonly LineupCheckIrPlayer[]): string {
  return players
    .map((player) => `${player.name ?? player.player_id} (${player.status ?? "healthy"})`)
    .join(", ");
}

/** What the roster is after the IR moves, against its limit. */
function afterTail(after: number, max: number): string {
  if (after > max) return ` and ${after - max} must then be dropped`;
  if (after < max) {
    const open = max - after;
    return ` with ${open} spot${open === 1 ? "" : "s"} open`;
  }
  return ", full";
}

/**
 * The one thing the tile did not measure, appended to whichever arm answered.
 *
 * A league with no IR slots at all has nothing to have checked, so a null
 * reading there says nothing; one with slots says the reading was not made.
 * Unjudged players are counted rather than hidden, because a `Full` over two
 * of them is a claim about players nobody looked at.
 */
function irCaveat(league: LineupCheckLeague, moves: IrMoves | null): string {
  if (!moves) return "";
  if (!moves.checked) {
    return (league.ir_max ?? 0) > 0 ? ". IR eligibility could not be checked" : "";
  }
  if (moves.unknown > 0) {
    return `. ${moves.unknown} player status${moves.unknown === 1 ? "" : "es"} unread`;
  }
  return "";
}

/**
 * How many of these leagues have something to act on — the league count the
 * console's attention window shows.
 *
 * Counted over leagues rather than over points, seats or spots, because that is
 * the question the page answers: how many of your lineups want a press. A
 * league off for three reasons is one league, and one trip to Sleeper.
 *
 * The two new checks join it on their **alert** state alone, and `rosterCell`
 * answers `alert` for a roster that is under its limit as well as one that is
 * over — and for an IR that wants a move either way: all of them are a trip to
 * Sleeper, which is what this count is of. Only a `Full` roster with its IR
 * set is clear.
 */
export function needsAttention(
  leagues: readonly { league_id: string }[],
  checked: Readonly<Record<string, LineupCheckLeague>>,
): number {
  let count = 0;
  for (const league of leagues) {
    const entry = checked[league.league_id];
    if (!entry) continue;
    if (isOff(entry)) count++;
  }
  return count;
}

/** Whether one league is off, on any of the four reasons. */
function isOff(entry: LineupCheckLeague): boolean {
  return (
    entry.points_left > 0 ||
    (entry.kickoff_moves ?? 0) > 0 ||
    superflexCell(entry).state === "alert" ||
    rosterCell(entry).state === "alert"
  );
}

/** The attention window's four rows. */
export type AttentionReasons = {
  points: number;
  kickoff: number;
  superflex: number;
  roster: number;
};

/**
 * Leagues off, per reason.
 *
 * **These do not sum to {@link needsAttention}** — one league can be off for
 * two reasons and is one league there and two rows here — which is why the
 * window labels them by reason and prints the league count separately rather
 * than letting a reader add the column up.
 *
 * Each reason reads the same rule its tile does, through the same function, so
 * a row that says two and a page with three lit tiles cannot happen.
 */
export function attentionByReason(
  leagues: readonly { league_id: string }[],
  checked: Readonly<Record<string, LineupCheckLeague>>,
): AttentionReasons {
  const reasons: AttentionReasons = {
    points: 0,
    kickoff: 0,
    superflex: 0,
    roster: 0,
  };
  for (const league of leagues) {
    const entry = checked[league.league_id];
    if (!entry) continue;
    if (entry.points_left > 0) reasons.points++;
    if ((entry.kickoff_moves ?? 0) > 0) reasons.kickoff++;
    if (superflexCell(entry).state === "alert") reasons.superflex++;
    if (rosterCell(entry).state === "alert") reasons.roster++;
  }
  return reasons;
}

import type { LineupCheckLeague } from "@/shared/contract";

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
 * Every tile says one of four things, and no two of them may render alike:
 *
 * - an **alert** — a number the reader can act on, in the error tone;
 * - a **clear** — a real and good answer (`Set`, `In order`, `QB seated`,
 *   `Full`). The tile draws a **checkmark** and keeps the word as its
 *   accessible name;
 * - a **count** — a real figure that is *not* a problem. Two open roster spots
 *   is a number worth reading and a check there would delete it, which is the
 *   whole reason this state is not folded into `clear`;
 * - a **none** — no answer at all: the em dash.
 *
 * A zero and an absence must never render the same. That is what the whole
 * contract is written to — `points_left: 0` beside `kickoff_moves: null` is a
 * lineup that is optimal in a league whose seat order cannot be known — and a
 * tile that printed `0` for both would quietly claim the second was checked.
 *
 * **It was a boolean `alert`, and the checkmark is what ended that.** A mark
 * saying "nothing to do here" is not the same answer as a figure that merely
 * happens not to be a problem, and one flag cannot tell the two apart. The
 * state is a union rather than a second boolean so the tile's own `switch` has
 * to place a fifth tone before it will compile.
 */

/** One tile's reading. */
export type MetricCell = {
  /**
   * The figure or word to print — and, in the `clear` state, the checkmark's
   * `sr-only` name rather than nothing at all: the mark is the whole of what a
   * sighted reader gets, so the word has to stay for everyone else.
   */
  text: string;
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
      state: "none",
      title: `Starting ${starting} — Sleeper seats a best-ball lineup itself, so there is nothing to move`,
    };
  }
  if (league.points_left === 0) {
    return {
      text: "Set",
      state: "clear",
      title: `Starting ${starting}, which is the best lineup still reachable`,
    };
  }
  return {
    text: `−${points(league.points_left)}`,
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
      title: league.best_ball
        ? "No seat order to set — Sleeper seats a best-ball lineup after the games"
        : "No kickoff order for this week — Sleeper has published no kickoff times",
    };
  }
  if (moves === 0) {
    return {
      text: "In order",
      state: "clear",
      title:
        "Every starter is already seated for kickoff — strict slots lock first, " +
        "the flexes stay open longest. Games within an hour of each other count as one kickoff",
    };
  }
  return {
    text: `${moves} to move`,
    state: "alert",
    title:
      `${moves} starter${moves === 1 ? "" : "s"} could trade seats so the flexes lock last — ` +
      "open the league for the moves",
  };
}

/**
 * A kickoff as a short local time, or null where there is none to show.
 *
 * The reader's own zone deliberately: this is the one number on the page they
 * check against a clock on the wall, and an ET time on a Pacific afternoon is a
 * lineup set an hour late.
 */
export function kickoffTime(at: number | null): string | null {
  if (at === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

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
      title: league.best_ball
        ? "No seat to spend — Sleeper seats a best-ball lineup after the games"
        : "No superflex slot in this league",
    };
  }

  const spent = seats.filter(
    (seat) => seat.player !== null && !seat.player.positions.includes("QB"),
  );
  if (spent.length === 0) {
    return {
      text: "QB seated",
      state: "clear",
      title: `Every superflex seat is a quarterback — ${seats.length} seat${
        seats.length === 1 ? "" : "s"
      } checked`,
    };
  }

  return {
    text: `${spent.length} non-QB`,
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
 * Whether the roster is under or over what the league allows.
 *
 * **Three limits, counted apart.** Sleeper enforces IR and taxi against their
 * own allowances rather than against the active roster, so a legal roster with
 * two players stashed on taxi is not two over — see the contract's
 * `roster_count`. Folding them together is how this tile would report a fault
 * nobody can fix.
 *
 * **Under is a `count` and not an alert**, which is the whole reason that state
 * exists: an open roster spot is an opportunity — a waiver claim to make — and
 * drawing it in the error tone would send a reader to fix a league that is
 * fine. Over is an alert, because Sleeper refuses adds until somebody is
 * dropped. IR and taxi over their own limits are alerts too — an ineligible
 * player parked on IR is the common real case — and the roster figure is
 * preferred when both are wrong, with the title carrying the rest.
 */
export function rosterCell(
  league: LineupCheckLeague | null | undefined,
): MetricCell {
  if (!league || league.roster_max === null) {
    return { ...NO_ANSWER, title: "No roster limit on file for this league" };
  }

  const held = `${league.roster_count} of ${league.roster_max} roster spots`;
  const spare = [
    league.ir_max === null ? null : `IR ${league.ir_count}/${league.ir_max}`,
    league.taxi_max === null ? null : `taxi ${league.taxi_count}/${league.taxi_max}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const rest = spare ? ` — ${spare}` : "";

  if (league.roster_count > league.roster_max) {
    const over = league.roster_count - league.roster_max;
    return {
      text: `${over} over`,
      state: "alert",
      title:
        `${held} filled — ${over} over the limit, and Sleeper will refuse an add ` +
        `until somebody is dropped${rest}`,
    };
  }

  // The spare squads are asked only once the active roster is legal, so the one
  // tile never has to say two things at once; the title carries both regardless.
  const overIr = league.ir_max !== null && league.ir_count > league.ir_max;
  const overTaxi = league.taxi_max !== null && league.taxi_count > league.taxi_max;
  if (overIr || overTaxi) {
    return {
      text: overIr
        ? `IR ${league.ir_count}/${league.ir_max}`
        : `Taxi ${league.taxi_count}/${league.taxi_max}`,
      state: "alert",
      title:
        `${overIr ? "IR" : "Taxi"} is over its own allowance — an ineligible player is parked there. ` +
        `${held} filled${rest}`,
    };
  }

  if (league.roster_count < league.roster_max) {
    const open = league.roster_max - league.roster_count;
    return {
      text: `${open} open`,
      state: "count",
      title: `${open} roster spot${open === 1 ? "" : "s"} open — ${held} filled${rest}`,
    };
  }

  return {
    text: "Full",
    state: "clear",
    title: `Every roster spot is filled — ${held}${rest}`,
  };
}

/**
 * How many of these leagues have something to act on — the league count the
 * console's attention window shows.
 *
 * Counted over leagues rather than over points, seats or spots, because that is
 * the question the page answers: how many of your lineups want a press. A
 * league off for three reasons is one league, and one trip to Sleeper.
 *
 * The two new checks join it on their **alert** state alone — `rosterCell`'s
 * `count` is an open spot, which is an opportunity rather than a fault and must
 * never send a reader to a league that is in perfectly good order.
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

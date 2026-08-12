import type { TeamGamePayload } from "@/shared/contract";

/**
 * What a roster row says about the NFL game its player is in this week: who he
 * plays, and when it kicks off.
 *
 * **A lineup tool's rows were missing the two facts a lineup is set on.** The
 * row named the player's club and nothing about the game it was in, so which of
 * his starters had already played, which kicked off in ten minutes and which was
 * on a bye were three questions a reader had to leave the panel to answer — and
 * the whole point of a week panel is that it is the lineup you are about to
 * change.
 *
 * Pure and tested, and the reason is the same one `head-to-head` beside it
 * gives: the decision is mostly **refusals**, and every one of them reads as a
 * corner case while being an ordinary state of a schedule this app has not
 * fetched. A row that guessed here would render perfectly well while telling a
 * manager his starter is on a bye.
 *
 * Three absences and they are three different answers:
 *
 * - **An empty `games` map is no schedule at all**, so the row says nothing. It
 *   is what a failed or unpublished schedule read comes back as (see
 *   `getWeekGames`), and spelling it as byes would put `BYE` on every row of
 *   every lineup.
 * - **A team absent from a *non-empty* map is on a bye**, which is the one
 *   reading worth the whole week's games crossing the wire rather than the
 *   rostered clubs' — a bye is an absence, so it can only be read against a
 *   population.
 * - **A missing half of a game is not a missing game.** Sleeper's schedule can
 *   name a kickoff without an opponent (or the reverse), and each half is worth
 *   drawing on its own: the time is what says whether he has played, the
 *   opponent is what says who he is up against.
 */

/** Weekday names, so the string reads the same wherever the page is opened. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the row draws for one player's game — each half absent on its own terms. */
export type PlayerGame = {
  /**
   * The matchup as a box score writes it: `@ KC` away, `vs KC` at home, `BYE`
   * where the week has no game for his club. Null where the schedule named the
   * kickoff and not the other side.
   */
  matchup: string | null;
  /** `Sun 1:05p`, or null on a bye and where the schedule gives only a date. See {@link formatKickoff}. */
  kickoff: string | null;
  /** Both halves spelled out, for the hover a truncated cell needs. */
  title: string;
};

/**
 * One player's game, read off the week's schedule by the NFL team already on his
 * row — or null where there is nothing honest to say.
 *
 * `team` is what `PlayerSummary` carries, so an unfilled slot and a player the
 * cache doesn't know both arrive here as null and draw nothing: a row with
 * nobody on it has no game, and a player whose club we don't know is not a
 * player on a bye.
 */
export function playerGame(
  team: string | null | undefined,
  games: Record<string, TeamGamePayload>,
): PlayerGame | null {
  // No schedule read at all — not a week in which nobody plays.
  if (Object.keys(games).length === 0) return null;
  if (!team) return null;

  const game = games[team];
  if (!game) return { matchup: "BYE", kickoff: null, title: `${team} are on bye` };

  const kickoff = game.kickoff === null ? null : formatKickoff(game.kickoff);
  const matchup =
    game.opponent === null ? null : `${game.home ? "vs" : "@"} ${game.opponent}`;

  // Spelled out rather than joining the two cells, since the hover is what a
  // truncated one falls back to and `@ KC` is not a sentence.
  const against =
    game.opponent === null
      ? team
      : game.home
        ? `${team} host ${game.opponent}`
        : `${team} at ${game.opponent}`;

  return {
    matchup,
    kickoff,
    title: kickoff ? `${against} · ${kickoff}` : `${against} · kickoff time not set`,
  };
}

/**
 * A kickoff instant the way a TV listing writes one: `Sun 1:05p`, `Sun 12p`,
 * `Thu 8:20p`.
 *
 * Read in the **reader's own zone**, which is the `todayIso` side of the
 * two-todays rule: `TODAY_ET` is Eastern because it decides what the NFL has
 * already played, where this is a wall-clock reading of a moment for whoever is
 * looking at it — "is his game before or after I next open this". It is spelled
 * out by hand rather than through `toLocaleTimeString` for the reason the trade
 * card's own clock is, so the digits read the same in every locale.
 *
 * The weekday is not decoration on a lineup panel: Thursday, Sunday and Monday
 * are the difference between a seat that is already committed, one being set
 * now, and one there is another day to think about.
 *
 * **Both compressions — a one-letter meridiem and no `:00` — are measured
 * rather than stylistic, and this is where the spelling parts company with the
 * trade card's `3:07 PM`.** That clock sits on a plate with room; this one
 * shares a **90px** cell with the matchup on a 390px phone (measured in the
 * rendered panel — see `SectionLayout.gameSeat` for where the cell comes from).
 * In Geist at `0.65rem` the pair that has to fit is `vs WAS` beside a noon
 * kickoff, which is not a corner case at all: it is what every Central-time
 * reader sees for the ordinary 1pm ET slot, and three quarters of NFL clubs
 * have a three-letter code. Spelled `vs WAS Sun 12:00 PM` that is 99px, and
 * `Sun 12:00p` is still 96px — both clipped to `Sun 12:0…`, which reads as a
 * rendering fault rather than as a time. `Sun 12p` is 74px.
 *
 * Dropping `:00` is exactly the case that overflows and nothing else: a kickoff
 * on the hour is what an ET slot becomes in every zone west of it, while the
 * `:05`/`:20`/`:25` starts that carry real information keep their minutes. It
 * is not the `formatPoints` rule inverted, either — that one holds a *column*
 * of figures to one width so it can be scanned down; this is a token in a line
 * of prose, and a listing that writes `12:00p` is padding, not alignment.
 */
function formatKickoff(at: number): string {
  const d = new Date(at);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = d.getMinutes();
  const clock = minutes === 0 ? `${hour12}` : `${hour12}:${String(minutes).padStart(2, "0")}`;
  return `${WEEKDAYS[d.getDay()]} ${clock}${hours < 12 ? "a" : "p"}`;
}

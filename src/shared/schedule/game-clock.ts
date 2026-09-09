/**
 * Reading a week's scoreboard for *where each game is*, rather than for when
 * it starts.
 *
 * `./parse` reads the same rows for one thing — the kickoff instant — and is
 * deliberately blind to everything else on them. This is the other reading:
 * whether a game has kicked off, is running, or is over, and if it is running,
 * **how much of it is still to be played**. That share is the one number the
 * gametime tool is built on: a player's live projection is what he has scored
 * plus what he was projected to score times the share of his game that is
 * left, and the second factor is what this module answers.
 *
 * Pure, on `./parse`'s terms — its one import is the Sleeper type — so every
 * rule below tests under Node's runner against hand-written rows. The wired
 * half is `./live`, which is the same feed `./kickoff` reads on a very
 * different clock: a schedule barely moves and holds for half a day, where a
 * game clock moves every play and holds for seconds.
 *
 * **Every field on a scoreboard row is optional and this reads all of them
 * defensively.** The endpoint is undocumented; what it sends was checked on the
 * 2026 opener's day and is recorded on the type. A row this cannot read is a
 * game that has not started, which is the reading that costs a reader least —
 * a projection left whole is an ordinary Sunday-morning number, where a game
 * wrongly marked final is a lineup priced at what it has scored so far.
 */

import type { SleeperScoreGame } from "../sleeper/types/sleeper.types.ts";

/** Where a game is: not yet kicked off, in progress, or over. */
export type GamePhase = "pre" | "live" | "final";

/** One NFL team's game this week, read for its clock rather than its kickoff. */
export type GameClock = {
  game_id: string | null;
  phase: GamePhase;
  /**
   * The share of the game still to be played, 0 to 1 — the factor a live
   * projection multiplies the initial projection by.
   *
   * `1` before kickoff, `0` at the final whistle, and `0` in overtime as well:
   * regulation is what a projection is a projection *of*, so once it is spent
   * there is nothing of the projection left to add, however long the game goes
   * on. Between the two it is seconds left in regulation over the 3,600 a game
   * has — see {@link remainingShare} for the fallbacks.
   */
  remaining: number;
  /** The quarter in progress, 1–4, or null when the game is not running. */
  quarter: number | null;
  /** `mm:ss` left in that quarter, or null when the game is not running. */
  clock: string | null;
  overtime: boolean;
  /** Kickoff, epoch ms — `./parse`'s own reading of the same field. */
  kickoff: number | null;
  /** The other team, or null where the row names only this side. */
  opponent: string | null;
  home: boolean;
  /**
   * The score from this team's side, or null before the game has started —
   * `0–0` before kickoff is a claim about a game nobody has played.
   */
  score: { team: number; opponent: number } | null;
};

/** Seconds of regulation. Four quarters of fifteen minutes. */
const REGULATION_S = 4 * 15 * 60;

/** Bounds a kickoff must land in to be believed — `./parse`'s own window. */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

const believable = (at: number | null | undefined): at is number =>
  typeof at === "number" &&
  Number.isFinite(at) &&
  at >= MIN_PLAUSIBLE_MS &&
  at <= MAX_PLAUSIBLE_MS;

/**
 * Which phase a row describes.
 *
 * The booleans are read before the status strings, because the booleans are
 * the fields Sleeper's own scoreboard flips and the strings are a vocabulary
 * nobody has published: `is_over` and `is_in_progress` were both present on
 * every row checked, where the top-level `status` read `pre_game` and
 * `complete` and its in-game spelling could only be guessed. A guess is what the
 * string fallback is for, and it is written to fail toward `pre`.
 */
export function gamePhase(game: SleeperScoreGame): GamePhase {
  const meta = game?.metadata ?? null;
  if (meta?.is_over === true) return "final";
  if (game?.status === "complete") return "final";
  if (meta?.is_in_progress === true) return "live";
  if (meta?.has_started === true) return "live";
  const status = game?.status ?? meta?.status ?? null;
  if (status === "in_game" || status === "in_progress" || status === "inprogress") {
    return "live";
  }
  return "pre";
}

/** `mm:ss` as seconds, or null for anything else. */
export function parseClock(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 0 && seconds <= 15 * 60 ? seconds : null;
}

/** The quarter in progress as a number, or null for `""` and anything else. */
export function parseQuarter(raw: number | string | null | undefined): number | null {
  const n = typeof raw === "string" ? (raw.trim() === "" ? NaN : Number(raw)) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 4) return null;
  return n;
}

/**
 * The share of regulation still to be played.
 *
 * Three readings, most exact first, and each one a fact the row actually
 * carries rather than an estimate:
 *
 * - **Quarter and clock.** `(4 − quarter) × 900 + seconds left` over 3,600,
 *   which is thelab2026's own arithmetic for its playoff scoring. A quarter with
 *   `00:00` on the clock reads as that quarter finished, so halftime is exactly
 *   `0.5`.
 * - **Which quarters have started**, where the clock is missing or unreadable:
 *   `n` quarters started leaves at most `4 − n` whole ones, and reading it as
 *   exactly that is the conservative side — a quarter in progress is counted as
 *   spent, which under-projects by less than a quarter's worth rather than
 *   crediting a projection the game has already had its chance at.
 * - **Half**, where a game is running and says nothing else. A game that is in
 *   progress has spent *some* of itself, and the middle is the reading with the
 *   smallest possible error against a row that will not say more.
 *
 * Overtime is `0` whatever the clock says — see {@link GameClock.remaining} —
 * and a game that is not running is `1` or `0` by its phase, never by its
 * clock: a row carrying `15:00` before kickoff (the next game to start does)
 * is the same `1` as one carrying nothing.
 */
export function remainingShare(game: SleeperScoreGame, phase = gamePhase(game)): number {
  if (phase === "pre") return 1;
  if (phase === "final") return 0;
  const meta = game?.metadata ?? null;
  if (meta?.is_overtime === true) return 0;

  const quarter = parseQuarter(meta?.quarter_num);
  const clock = parseClock(meta?.time_remaining);
  if (quarter !== null && clock !== null) {
    const left = (4 - quarter) * 15 * 60 + clock;
    return clamp(left / REGULATION_S);
  }

  const started = [
    meta?.has1st_quarter_started,
    meta?.has2nd_quarter_started,
    meta?.has3rd_quarter_started,
    meta?.has4th_quarter_started,
  ].filter((flag) => flag === true).length;
  if (started > 0) return clamp((4 - started) / 4);

  return 0.5;
}

const clamp = (share: number): number => Math.min(1, Math.max(0, share));

/**
 * Team → its game's clock, both sides of every game filed.
 *
 * The same walk `./parse`'s `weekGames` makes, reading the rest of the row.
 * Deliberately a second walk rather than a field added to `TeamGame`: that
 * type is what a half-day schedule cache holds, and a clock on it would be a
 * clock twelve hours stale that nothing on the type says is stale.
 *
 * A team listed twice keeps the first entry that is *running or over* — a
 * scoreboard row that has moved past `pre` is the one describing the game
 * being played — and otherwise the first listing. An empty map is a week this
 * process could not read, which callers tell apart from a team on a bye by
 * testing the map rather than the entry, as `weekGames`' readers do.
 */
export function gameClocks(games: readonly SleeperScoreGame[]): Map<string, GameClock> {
  const byTeam = new Map<string, GameClock>();

  const named = (team: string | null | undefined): string | null =>
    typeof team === "string" && team !== "" ? team : null;
  const points = (n: number | null | undefined): number | null =>
    typeof n === "number" && Number.isFinite(n) ? n : null;

  for (const game of games) {
    const meta = game?.metadata ?? null;
    const home = named(meta?.home_team);
    const away = named(meta?.away_team);
    const phase = gamePhase(game);
    const remaining = remainingShare(game, phase);
    const live = phase === "live";
    const quarter = live ? parseQuarter(meta?.quarter_num) : null;
    const clock = live && parseClock(meta?.time_remaining) !== null
      ? (meta?.time_remaining as string).trim()
      : null;
    const homeScore = points(meta?.home_score);
    const awayScore = points(meta?.away_score);
    const scored = phase !== "pre" && homeScore !== null && awayScore !== null;
    const kickoff = believable(game?.start_time) ? game.start_time : null;
    const gameId = typeof game?.game_id === "string" ? game.game_id : null;

    for (const side of [
      { team: home, opponent: away, home: true, mine: homeScore, theirs: awayScore },
      { team: away, opponent: home, home: false, mine: awayScore, theirs: homeScore },
    ]) {
      if (side.team === null) continue;
      const entry: GameClock = {
        game_id: gameId,
        phase,
        remaining,
        quarter,
        clock,
        overtime: live && meta?.is_overtime === true,
        kickoff,
        opponent: side.opponent,
        home: side.home,
        score: scored ? { team: side.mine as number, opponent: side.theirs as number } : null,
      };
      const held = byTeam.get(side.team);
      if (held === undefined || (held.phase === "pre" && phase !== "pre")) {
        byTeam.set(side.team, entry);
      }
    }
  }

  return byTeam;
}

/**
 * The cheapest honest signal that a scoreboard has moved.
 *
 * Phase, quarter, clock and score per game, in team order — everything a live
 * projection reads off a row and nothing it does not, so two ticks that would
 * price every lineup identically compare equal and a room sends nothing.
 */
export function clockSignature(clocks: ReadonlyMap<string, GameClock>): string {
  const parts: string[] = [];
  for (const [team, game] of [...clocks].sort(([a], [b]) => a.localeCompare(b))) {
    const score = game.score ? `${game.score.team}-${game.score.opponent}` : "";
    parts.push(
      `${team}:${game.phase}:${game.quarter ?? ""}:${game.clock ?? ""}:${game.overtime ? "ot" : ""}:${score}`,
    );
  }
  return parts.join("|");
}

/** How many games on the board are in each phase. */
export function phaseCounts(
  clocks: ReadonlyMap<string, GameClock>,
): Record<GamePhase, number> {
  const counts: Record<GamePhase, number> = { pre: 0, live: 0, final: 0 };
  const seen = new Set<string>();
  for (const game of clocks.values()) {
    // Both sides of a game are filed; count the game once where it has an id.
    const key = game.game_id ?? `${game.home ? "h" : "a"}:${game.opponent ?? ""}:${game.kickoff ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[game.phase] += 1;
  }
  return counts;
}

import type { ManagerLeague } from "@/shared/contract";

/**
 * How many of a week's lineups seated each player, and how many left him off.
 *
 * The week's answer to the question `playerShares` answers for a season, and
 * folded on the client for the same reason that one is: a week tool narrows its
 * league list five ways, and a share counted over anything but the leagues in
 * front of the reader is a different question. A reader narrowed to dynasty
 * wants their dynasty week.
 *
 * The `leagues` argument is therefore the caller's business, and there is
 * exactly one right answer for it: **the league-filtered list, before any
 * subject selection.** Counted over the selection instead, every row would
 * collapse to the row just picked and could not be widened without clearing
 * first — the rule `facetsQuery` already enforces for the trades board's own
 * menus and `playerShares` for the manager page's.
 *
 * **It is `features/shared` because two tools ask it**, which is the line
 * `league-subjects.ts`, `shares-drawer.tsx` and `subject-tokens.tsx` all moved
 * on. The lineup checker asks it of the lineups a reader *set*, and gametime
 * asks it of the same lineups as they are being *played* — the same fold over
 * the same leagues, and two copies of it would be two chances for one to count
 * differently from the other, which is the failure nobody could see: both
 * would render.
 *
 * **So it reads a normalised side rather than either tool's payload.** Their
 * two wires are genuinely different shapes — the checker's league carries
 * `lineup`/`bench` and three `opponent_*` fields, gametime's carries a `mine`
 * and an `opponent` side — and each is adapted at its own page, in one place,
 * where the choice of {@link WeekSharePlayer.figure} is also made and written
 * down. A fold that read both would be a fold with a `switch` in it.
 *
 * Pure, and the contract arrives as an erased `import type`, so it tests under
 * Node's runner without a render behind it.
 */

/** Which side of the week's games a fold is counting. */
export type WeekSide = "starter" | "opponent";

/**
 * One rostered player, as a week panel compares him.
 *
 * A projection to the checker and a live projection to gametime — which is why
 * the field is `figure` rather than `points`. Named for the *reading* rather
 * than for either tool's number, because a shared type spelling `points` would
 * read as "projected points" on the one page where it is emphatically not
 * that. The label a reader sees is the caller's too — see the drawer's
 * `figureLabel`.
 */
export type WeekSharePlayer = {
  player_id: string;
  name: string | null;
  positions: string[];
  team: string | null;
  /**
   * The one figure this tool's panels compare players on, or null where it has
   * no answer for him — never zero, on both wires' own grammar.
   */
  figure: number | null;
};

/** One starting slot of a lineup. */
export type WeekShareSeat = {
  slot: string;
  /** Null for a slot Sleeper is carrying empty. */
  player: WeekSharePlayer | null;
};

/** The seats and the bench one side of a league's game fielded. */
export type WeekShareSide = {
  lineup: readonly WeekShareSeat[];
  bench: readonly WeekSharePlayer[];
};

/** One league's contribution, already adapted out of a payload by the caller. */
export type WeekLineupEntry = {
  league: ManagerLeague;
  /** The manager's own side. */
  mine: WeekShareSide;
  /**
   * The other side of the game, or **null where there is no answer** — a future
   * week, a week Sleeper filed without a pairing, an opponent whose roster is
   * not stored. Never an empty side for any of them: a panel counting opposing
   * players over an empty list would report that the opponent fielded nobody in
   * a league that has simply not been asked yet.
   */
  opponent: WeekShareSide | null;
  /**
   * Whether the manager set this lineup themselves.
   *
   * False in a best-ball league, where Sleeper seats the team from the whole
   * roster after the games are played — so the lineup on the wire is whatever
   * the draft left behind (the checker) or what the live figures solve to
   * (gametime), and neither is a call anybody made. The shares still count it,
   * because who is on a roster and who got seated are real readings; the
   * decisions walk skips it. See `decisionsFor`.
   */
  set_by_manager: boolean;
};

/** One player, and how the week's lineups treated him. */
export type WeekPlayerShare = {
  player_id: string;
  /** The stored name, else the id — a searchable token beats a blank. */
  name: string;
  /** His first listed position, or null where the feed didn't say. */
  position: string | null;
  team: string | null;
  /**
   * His {@link WeekSharePlayer.figure}, where every counted league that priced
   * him agrees, and **null where they do not**.
   *
   * Either tool's figure is a stat line scored by the league's own settings, so
   * a player is worth one number in a PPR league and another in a half-PPR one
   * — and a row here spans leagues. There is no honest single figure across two
   * scorings, and the two ways of inventing one are both worse than an em dash:
   * an average is a number no league pays, and picking the first league's is
   * that same number with the arbitrariness hidden.
   *
   * It is answerable far more often than that makes it sound, because the view
   * that reads it narrows: pick a counterpart and the fold runs again over the
   * leagues that pairing was actually made in, which on a single league is
   * always one scoring and always a number. The per-league deltas beside it are
   * never affected — those are computed inside one lineup, where the scoring is
   * whatever that league says.
   */
  figure: number | null;
  /** How many of the counted lineups started him. */
  started: number;
  /** How many benched him. `started + benched` is every league he was on. */
  benched: number;
  /** The leagues he appears on at all, in the order they were given. */
  leagues: ManagerLeague[];
};

export type WeekPlayerShares = {
  /**
   * The denominator: leagues that **contributed a lineup**, not leagues on
   * screen.
   *
   * A league the read answered nothing for is skipped rather than counted as
   * one starting nobody — and on the opponent side, so is a league with no
   * opponent to read (a future week, an unpaired week, an unstored roster). A
   * partly-answered account therefore reports its shares over fewer leagues
   * than the count beside it, which is the same rule `PlayerShares.league_count`
   * is written by. Zeroing it would quietly deflate every share on the page.
   */
  league_count: number;
  /** Most-started first, then most-benched, ties broken by name. */
  players: WeekPlayerShare[];
};

/** The side a fold or a walk is reading, or null where there is none. */
export function sideOf(
  entry: WeekLineupEntry,
  side: WeekSide,
): WeekShareSide | null {
  // **Null is not an empty lineup**, and the difference is the whole reason
  // both wires keep the opponent nullable — see {@link WeekLineupEntry.opponent}.
  return side === "starter" ? entry.mine : entry.opponent;
}

/**
 * Fold one week's lineups into a share per player.
 *
 * A league is counted once, in the denominator, as soon as it has a lineup to
 * read; a player is counted once per league however many times that league's
 * arrays name him. Sleeper's roster padding never reaches here — the seats
 * carry a null player and the bench is built from real ids — so there is no
 * phantom row held, by construction, in every league.
 */
export function weekPlayerShares(
  entries: readonly WeekLineupEntry[],
  side: WeekSide,
): WeekPlayerShares {
  const rows = new Map<string, WeekPlayerShare>();
  let leagueCount = 0;

  for (const entry of entries) {
    const fielded = sideOf(entry, side);
    // Absent is not empty — see `league_count`.
    if (!fielded) continue;
    leagueCount++;

    const league = entry.league;

    // Which of this league's two arrays a player was in, resolved before any
    // counting: one lineup is one decision per player, so a roster naming him
    // twice must not count twice, and a player somehow in both must not be
    // counted as started *and* benched in the same week.
    const seen = new Set<string>();

    const count = (player: WeekSharePlayer, started: boolean) => {
      if (seen.has(player.player_id)) return;
      seen.add(player.player_id);

      let row = rows.get(player.player_id);
      if (!row) {
        row = {
          player_id: player.player_id,
          name: player.name ?? player.player_id,
          position: player.positions[0] ?? null,
          team: player.team,
          figure: player.figure,
          started: 0,
          benched: 0,
          leagues: [],
        };
        rows.set(player.player_id, row);
      } else if (row.figure !== player.figure) {
        // Two leagues that price him differently have no shared answer — see
        // `figure`. Null once, null for the rest of the fold: a later league
        // agreeing with the first cannot un-disagree the one in between.
        row.figure = null;
      }

      if (started) row.started++;
      else row.benched++;
      row.leagues.push(league);
    };

    for (const seat of fielded.lineup) {
      if (seat.player) count(seat.player, true);
    }
    for (const player of fielded.bench) count(player, false);
  }

  const players = [...rows.values()].sort(
    (a, b) =>
      b.started - a.started ||
      b.benched - a.benched ||
      a.name.localeCompare(b.name),
  );

  return { league_count: leagueCount, players };
}

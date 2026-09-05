import type { LineupCheckLeague, ManagerLeague } from "@/shared/contract";

/**
 * How many of a week's lineups seated each player, and how many left him off.
 *
 * The week's answer to the question `playerShares` answers for a season, and
 * folded on the client for the same reason that one is: this page narrows its
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
 * Pure, and the contract arrives as an erased `import type`, so it tests under
 * Node's runner without a render behind it.
 */

/** Which side of the week's games a fold is counting. */
export type WeekSide = "starter" | "opponent";

/** One player, and how the week's lineups treated him. */
export type WeekPlayerShare = {
  player_id: string;
  /** The stored name, else the id — a searchable token beats a blank. */
  name: string;
  /** His first listed position, or null where the feed didn't say. */
  position: string | null;
  team: string | null;
  /**
   * His projection, where every counted league that priced him agrees, and
   * **null where they do not**.
   *
   * A projection is a stat line scored by the league's own settings, so a
   * player is worth one number in a PPR league and another in a half-PPR one —
   * and a row here spans leagues. There is no honest single figure across two
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
  points: number | null;
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
   * A league the check answered nothing for is skipped rather than counted as
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

/** One league's contribution, already picked out of the payload by the caller. */
export type WeekLineupEntry = {
  league: ManagerLeague;
  entry: LineupCheckLeague;
};

/** The seats and the bench one side of a league's game fielded. */
function sideOf(entry: LineupCheckLeague, side: WeekSide) {
  if (side === "starter") {
    return { lineup: entry.lineup, bench: entry.bench };
  }
  // **Null is not an empty lineup**, and the difference is the whole reason the
  // contract keeps these nullable: a week nobody is scheduled for has no
  // opposing players to count, where an empty list would report that the
  // opponent fielded nobody.
  if (!entry.opponent_lineup || !entry.opponent_bench) return null;
  return { lineup: entry.opponent_lineup, bench: entry.opponent_bench };
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

  for (const { league, entry } of entries) {
    const fielded = sideOf(entry, side);
    // Absent is not empty — see `league_count`.
    if (!fielded) continue;
    leagueCount++;

    // Which of this league's two arrays a player was in, resolved before any
    // counting: one lineup is one decision per player, so a roster naming him
    // twice must not count twice, and a player somehow in both must not be
    // counted as started *and* benched in the same week.
    const seen = new Set<string>();

    const count = (
      player: {
        player_id: string;
        name: string | null;
        positions: string[];
        team: string | null;
        points: number | null;
      },
      started: boolean,
    ) => {
      if (seen.has(player.player_id)) return;
      seen.add(player.player_id);

      let row = rows.get(player.player_id);
      if (!row) {
        row = {
          player_id: player.player_id,
          name: player.name ?? player.player_id,
          position: player.positions[0] ?? null,
          team: player.team,
          points: player.points,
          started: 0,
          benched: 0,
          leagues: [],
        };
        rows.set(player.player_id, row);
      } else if (row.points !== player.points) {
        // Two leagues that price him differently have no shared answer — see
        // `points`. Null once, null for the rest of the fold: a later league
        // agreeing with the first cannot un-disagree the one in between.
        row.points = null;
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

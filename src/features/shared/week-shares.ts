import type { ManagerLeague } from "@/shared/contract";

import type { WeekReading } from "./league-subjects.ts";

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
 * **So it reads a normalised entry rather than either tool's payload.** Their
 * two wires are genuinely different shapes — the checker's league carries
 * `lineup`/`bench` and three `opponent_*` fields, gametime's carries a `mine`
 * and an `opponent` side — and each is adapted at its own page, in one place,
 * where the choice of {@link WeekSharePlayer.figure} is also made and written
 * down. A fold that read both wires would be a fold with a `switch` in it.
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
 * One player, and how the week's lineups treated him — **on both sides at
 * once**.
 *
 * This used to be two types folded by two calls, one per panel. The two panels
 * this replaces asked one question each and a reader comparing them had to hold
 * two lists in their head: the same player, twice, in two corners of the
 * screen, under two denominators. One row with four counts is the same four
 * numbers with the comparison already made.
 */
export type WeekTwoSidedShare = {
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
   *
   * **Both sides answer it**, because it is a fact about the *player* rather
   * than about which roster he happens to be on: two leagues that disagree
   * disagree however he got there.
   */
  figure: number | null;
  /** How many of the manager's own lineups started him, and benched him. */
  started: number;
  benched: number;
  /** The same two over the lineups facing them. */
  oppStarted: number;
  oppBenched: number;
  /**
   * The leagues behind each of the four counts, keyed by the reading.
   *
   * Kept rather than derived because two things read them and neither can
   * recompute one cheaply: the deck's chip says how many leagues a row's
   * narrowing leaves, which is the union of the picked readings' sets, and the
   * decisions view narrows to a counterpart's own leagues.
   */
  leagues: Record<WeekReading, ManagerLeague[]>;
};

export type WeekTwoSidedShares = {
  /**
   * The manager's own denominator: leagues that **contributed a lineup**, not
   * leagues on screen, and the scale the two `mine` columns are read against.
   *
   * A league the read answered nothing for is skipped rather than counted as
   * one starting nobody, which is the same rule `PlayerShares.league_count` is
   * written by. Zeroing it would quietly deflate every share on the panel.
   */
  starter_league_count: number;
  /**
   * The opposing denominator, and it is **legitimately lower** — a future week,
   * a week Sleeper filed without a pairing, an opponent whose roster is not
   * stored. Both numbers are on the wire because two of the four columns are
   * scaled by each, and a row reading `18/79` where only 74 leagues had an
   * opponent to read would understate every opposing share on the panel.
   */
  opponent_league_count: number;
  /** Most-started first, then most-benched, ties broken by name. */
  players: WeekTwoSidedShare[];
};

/** An empty set of the four league lists — a fresh one per row. */
const noLeagues = (): Record<WeekReading, ManagerLeague[]> => ({
  start: [],
  bench: [],
  "opp-start": [],
  "opp-bench": [],
});

/**
 * Fold one week's lineups into a share per player, **both sides in one walk**.
 *
 * A side is counted once, in its own denominator, as soon as it has a lineup to
 * read; a player is counted once per league per side however many times that
 * side's arrays name him; an absent side is skipped rather than counted as one
 * that fielded nobody. Sleeper's roster padding never reaches here — the seats
 * carry a null player and the bench is built from real ids — so there is no
 * phantom row held, by construction, in every league.
 *
 * **The two sides are counted apart and a player is never on both in one
 * league**, which is what makes the four counts add up to something a reader
 * can reason about: he is on one roster per league, so his four counts partition
 * the leagues he appears in rather than overlapping them. That is also the fact
 * the row's narrowing rests on — see {@link Subject.readings}.
 *
 * One walk rather than one call per side, because the fold has to resolve one
 * `figure` and one sort order across both, and merging two results afterwards
 * would be a second place for either to be decided.
 */
export function weekTwoSidedShares(
  entries: readonly WeekLineupEntry[],
): WeekTwoSidedShares {
  const rows = new Map<string, WeekTwoSidedShare>();
  let starterLeagues = 0;
  let opponentLeagues = 0;

  for (const entry of entries) {
    const league = entry.league;

    for (const side of ["starter", "opponent"] as const) {
      const fielded = sideOf(entry, side);
      // Absent is not empty — see `WeekLineupEntry.opponent`.
      if (!fielded) continue;
      if (side === "starter") starterLeagues++;
      else opponentLeagues++;

      // One lineup is one decision per player, so a side naming him twice must
      // not count twice and a player somehow in both its arrays must not be
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
            oppStarted: 0,
            oppBenched: 0,
            leagues: noLeagues(),
          };
          rows.set(player.player_id, row);
        } else if (row.figure !== player.figure) {
          // Null once, null for the rest of the fold — see `figure`.
          row.figure = null;
        }

        const reading: WeekReading =
          side === "starter"
            ? started
              ? "start"
              : "bench"
            : started
              ? "opp-start"
              : "opp-bench";

        if (reading === "start") row.started++;
        else if (reading === "bench") row.benched++;
        else if (reading === "opp-start") row.oppStarted++;
        else row.oppBenched++;

        row.leagues[reading].push(league);
      };

      for (const seat of fielded.lineup) {
        if (seat.player) count(seat.player, true);
      }
      for (const player of fielded.bench) count(player, false);
    }
  }

  // **Ordered by the manager's own side first**, which is the panel's own claim
  // about what it is for: the four columns are one reading of a week and the
  // two on the left are the reader's. A row nobody on either side fielded
  // cannot exist, so the tiebreak never has to reach past the name.
  const players = [...rows.values()].sort(
    (a, b) =>
      b.started - a.started ||
      b.benched - a.benched ||
      b.oppStarted - a.oppStarted ||
      b.oppBenched - a.oppBenched ||
      a.name.localeCompare(b.name),
  );

  return {
    starter_league_count: starterLeagues,
    opponent_league_count: opponentLeagues,
    players,
  };
}

/**
 * The five populations a week narrowing is answered from — the four readings,
 * and the resting one a picked row with no reading chosen means.
 *
 * **It is here rather than in either page** because it is the same walk both of
 * them were doing by hand over their own wire, and a second spelling is a page
 * whose grid narrows differently from the page beside it. Each page adapts its
 * payload to {@link WeekLineupEntry} already; this is what that adaptation is
 * for.
 *
 * `either` is the resting reading: everybody either side fielded, which is what
 * pressing a row before touching its tray has always meant.
 *
 * **A league with no opposing side simply has no row in the two `opp-*`
 * maps**, which {@link matchesSubjects} reads as "this league does not hold
 * them" — correct, and a different state from the map not having arrived.
 */
export function weekSubjectRolls(
  entries: readonly WeekLineupEntry[],
): Record<WeekReading | "either", Record<string, string[]>> {
  const rolls: Record<WeekReading | "either", Record<string, string[]>> = {
    either: {},
    start: {},
    bench: {},
    "opp-start": {},
    "opp-bench": {},
  };

  for (const entry of entries) {
    const id = entry.league.league_id;
    const either: string[] = [];

    for (const side of ["starter", "opponent"] as const) {
      const fielded = sideOf(entry, side);
      if (!fielded) continue;

      const started = fielded.lineup.flatMap((seat) =>
        seat.player ? [seat.player.player_id] : [],
      );
      const benched = fielded.bench.map((p) => p.player_id);

      rolls[side === "starter" ? "start" : "opp-start"][id] = started;
      rolls[side === "starter" ? "bench" : "opp-bench"][id] = benched;
      either.push(...started, ...benched);
    }

    // A league neither side answered for gets no row at all, which is the
    // absent-is-not-empty rule the two denominators above are written by.
    if (either.length > 0 || sideOf(entry, "starter")) rolls.either[id] = either;
  }

  return rolls;
}

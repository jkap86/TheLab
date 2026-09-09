/**
 * The gametime tool's answer: for one week, what each league's lineup has
 * scored so far, what it is on course to score, and where every starter's game
 * is.
 *
 * Types only, like everything in `contract/`. A sibling of `./lineup-check`
 * rather than a widening of it, on that file's own argument about `./lineups`:
 * the checker asks what a lineup *projects* against the best still reachable,
 * and this asks what it has *done* against what it will do — a player here has
 * a game clock and two figures where the checker's has a kickoff and one, and
 * neither tool reads the other's fields.
 *
 * **The live projection is one formula, spelled in `manager/gametime` and
 * nowhere else:** `scored + projected × remaining`, where `remaining` is the
 * share of the player's game still to be played. Before kickoff that is the
 * projection whole; at the final whistle it is what he scored; in between it
 * is both. Every total on this wire is a sum of that per-player figure, so a
 * reader adding the seat rows up must arrive at the number on the plate.
 */

/** Where a game is — the pure module's own vocabulary, restated for the wire. */
export type GametimePhase = "pre" | "live" | "final";

/** One starter's game, as the scoreboard reads it this second. */
export type GametimeGame = {
  phase: GametimePhase;
  /**
   * The share of the game still to be played, 0 to 1. `1` before kickoff, `0`
   * at the final whistle and in overtime — regulation is what a projection is
   * a projection of.
   */
  remaining: number;
  /** The quarter in progress, or null when the game is not running. */
  quarter: number | null;
  /** `mm:ss` left in that quarter, or null when the game is not running. */
  clock: string | null;
  overtime: boolean;
  /** Kickoff, epoch ms, or null where the scoreboard did not say. */
  kickoff: number | null;
  /** The NFL opponent, or null where the scoreboard names only this side. */
  opponent: string | null;
  home: boolean;
  /** The game's score from this team's side, or null before kickoff. */
  score: { team: number; opponent: number } | null;
};

/** One rostered player, priced live. */
export type GametimePlayer = {
  player_id: string;
  name: string | null;
  positions: string[];
  team: string | null;
  /**
   * This week's initial projection under the league's own scoring, or null
   * where the projections feed has no row for him. A row with no game is a
   * real zero — a bye — on the checker's own grammar.
   */
  projected: number | null;
  /**
   * What he has scored so far under the league's own scoring, or **null
   * before his game has started** — nothing has happened yet, which is a
   * different answer from a game he has played and scored nothing in. A
   * player whose game is running or over and who has no stat line is a real
   * zero.
   */
  scored: number | null;
  /**
   * `scored + projected × remaining` — see the module note. Null only where
   * neither figure exists: no projection and no game to have scored in.
   *
   * His game is **not on the row**: it is the payload's `board`, keyed by his
   * `team`. A game object on every seat of every roster was most of a frame's
   * bytes, repeated once per player on the same team, and a frame is pushed to
   * every reader every time the scoreboard moves.
   */
  live: number | null;
};

/** One starting slot of the lineup as set. */
export type GametimeSeat = {
  slot: string;
  /** Null for a slot Sleeper is carrying empty. */
  player: GametimePlayer | null;
};

/** How many of a lineup's starters are done, playing, or yet to kick off. */
export type GametimeStatus = {
  done: number;
  live: number;
  pending: number;
};

/** One side of a matchup: a lineup and its three totals. */
export type GametimeSide = {
  roster_id: number;
  /** The team's name on `leagueTeamName`'s rule, or null where none is stored. */
  team_name: string | null;
  /** Points scored so far, over the starters. A real zero before any kickoff. */
  scored: number;
  /** The initial projection, over the starters — what the checker prints. */
  projected: number;
  /** The live projection, over the starters. */
  live: number;
  /**
   * The starters by game phase. An empty seat, or a starter with no game this
   * week, counts as `done` — there is nothing left for that seat to score.
   */
  status: GametimeStatus;
  /** The lineup as set, in the league's own slot order. */
  lineup: GametimeSeat[];
  /** Everyone else on the roster, live projection first. */
  bench: GametimePlayer[];
};

/** One league's week, live. */
export type GametimeLeague = {
  roster_id: number;
  best_ball: boolean;
  /** `getManagerWeekLineups`' own reading — the week's stored lineup or the live roster's. */
  as_of: "week" | "current";
  mine: GametimeSide;
  /**
   * The other side of the game, or **null where there is no answer** — a
   * future week, a week Sleeper filed without a pairing, an opponent whose
   * roster is not stored. The checker's own three reasons, and never an empty
   * side for any of them.
   */
  opponent: GametimeSide | null;
  /**
   * The league's median, priced the same three ways, or null where the league
   * runs no median matchup, is too small for one, or has no other rosters
   * stored — `LineupCheckLeague.median_points`' own grammar.
   */
  median: { scored: number; projected: number; live: number } | null;
  /** Starting slots this build doesn't recognise, left out of both lineups. */
  unknown_slots: string[];
};

/** Whether a feed behind the numbers could be read at all. */
export type GametimeFeedStatus = "ok" | "error";

/** `GET /api/user/[username]/gametime` — one week, every league, live. */
export type ManagerGametimePayload = {
  season: string;
  /** Always echoed; null when the season has no week to score — a past season. */
  week: number | null;
  /**
   * `"error"` means the projections read failed and no league could be
   * priced; the checker's own reading of that status. The two feeds beside it
   * degrade rather than empty the page: a failed `stats` read leaves every
   * `scored` null and prices the week as a projection, and a failed `scores`
   * read leaves every `game` null and every projection whole.
   */
  projections: GametimeFeedStatus;
  stats: GametimeFeedStatus;
  scores: GametimeFeedStatus;
  /** When the feeds behind this answer were read, epoch ms. */
  read_at: number;
  /** Games on the NFL scoreboard by phase — what says whether the week is live at all. */
  games: { pre: number; live: number; final: number };
  /**
   * The scoreboard, keyed by NFL team, both sides of every game filed. A
   * player's game is `board[player.team]`; a team absent from it is on a bye,
   * and an empty board is a scoreboard this process could not read (`scores`
   * says which). Once per payload rather than once per seat — see
   * `GametimePlayer.live`.
   */
  board: Record<string, GametimeGame>;
  /** Keyed by league id; absent where nothing could be solved — no slots on file. */
  leagues: Record<string, GametimeLeague>;
};

/**
 * What the SSE route sends, discriminated so `if (m.type === "payload")` is
 * also the type guard — `PicktrackerStreamMessage`'s own shape.
 *
 * `stale` is a note beside a usable answer: the feeds have stopped moving
 * behind it. `error` is terminal, and the client closes on it — an
 * `EventSource` reconnects on any close, so a stream that will never work
 * must say so before it goes.
 */
export type GametimeStreamMessage =
  | { type: "payload"; payload: ManagerGametimePayload }
  | { type: "delta"; delta: GametimeDelta }
  | { type: "stale"; error: string }
  | { type: "error"; error: string };

/**
 * What a tick sends once a reader holds a payload: the payload's own header
 * — statuses, the read instant, the phase counts, the board — and **only the
 * leagues whose answer moved**, with the ids of any that left.
 *
 * A frame of every league was a megabyte on a hundred-league account, pushed
 * every twenty seconds while a game ran; a Thursday-night tick moves a handful
 * of them. The client folds a delta over what it holds, so the two shapes are
 * one payload seen at two grains, and a reader who missed a delta (a stalled
 * socket drops payloads and deltas alike) is caught up by the full payload the
 * next join sends.
 */
export type GametimeDelta = Omit<ManagerGametimePayload, "leagues"> & {
  leagues: Record<string, GametimeLeague>;
  removed: string[];
};

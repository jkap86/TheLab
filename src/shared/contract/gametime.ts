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
  /**
   * How many of this side's players have a game running right now — the
   * card's own in-play reading, and the one figure on it that says whether
   * there is anything to watch in this league.
   *
   * **It is `status.live` in a managed league and a count over the whole
   * roster in a best-ball one**, which is the same rule {@link lineup} is
   * seated by rather than a second one. A managed lineup is what will be
   * scored, so its seats are the population; a best-ball team is seated by
   * Sleeper after the games, so "starters in play" is not a statement about a
   * lineup anybody set and every rostered player is one Sleeper may yet seat.
   * `status` counts seats and cannot answer that, which is why this is a field
   * beside it rather than a fourth arm of it.
   *
   * **It rides the wire rather than being counted on the client**, and the
   * reason is two-fold. A closed card is handed no scoreboard — the board is a
   * new object every frame and only the open card takes it, which is what
   * keeps a hundred closed cards' memos holding through a live Sunday — so a
   * count walked from the board would read zero on every card but one. And
   * under `scores: "error"` the board on the payload is the last one read
   * rather than the current one, a caption rather than a factor; this is
   * counted from the same phases `live` was priced against, so the reading and
   * the figure it stands beside degrade together.
   */
  players_in_play: number;
  /**
   * The lineup, in the league's own slot order — **as set in a managed league
   * and as *solved* in a best-ball one**, which is the league's own rule
   * rather than a choice this makes. Sleeper seats a best-ball team itself,
   * from the whole roster, after the games are played, so its `starters`
   * array holds whatever the draft left behind and is not a lineup anybody
   * will be scored on. See `manager/gametime`'s `solveSide` for what it is
   * solved by and why.
   */
  lineup: GametimeSeat[];
  /** Everyone else on the roster, live projection first. */
  bench: GametimePlayer[];
};

/** One league's week, live. */
export type GametimeLeague = {
  roster_id: number;
  /**
   * Whether Sleeper seats this league's lineup for you — and therefore
   * whether `mine.lineup`, `opponent.lineup` and the rosters behind `median`
   * were seated from the whole roster rather than read off `starters`. See
   * {@link GametimeSide.lineup}.
   */
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

/**
 * The four positions the stat board reads.
 *
 * The board's whole vocabulary, and narrower than Sleeper's on purpose: it is
 * a fantasy reading of an NFL week, so a kicker, a team defence and an
 * individual defender have no column on it — there is nothing in `Passing`,
 * `Rushing` or `Receiving` for them to fill, and a scoring formula that priced
 * them would need three more groups and a different board. A player whose
 * `fantasy_positions` name none of these is simply not on it.
 */
export type StatBoardPosition = "QB" | "RB" | "WR" | "TE";

/**
 * One player's week, as the stat board reads it: who he is and what he did.
 *
 * **Every figure is a count, and a zero is a real zero.** This is the one
 * place on this wire where zero and absent are the same reading, and the
 * board prints an em dash for it — a player who caught nothing caught nothing,
 * and there is no third state for the columns to be missing rather than empty.
 * That is what lets the nine numbers always ship rather than being omitted
 * when they are nought.
 *
 * **His game is not on the row**, on {@link GametimePlayer.live}'s own rule
 * one grain over: the opponent, the clock and the phase are the payload's
 * `board`, keyed by his `team`. Two hundred rows each carrying a copy of one
 * of thirty-two games is most of a frame's bytes, repeated once per player on
 * the same team.
 *
 * **And no fantasy points ride it either.** The board prices its own rows on
 * one stated basis (`ppr` / `half` / `std`), because it is account-wide and
 * spans leagues on different scorings — a per-league number would be a claim
 * no single league could support, and a number computed here would have to
 * pick one of them to be. See `features/gametime/helpers/stat-board`.
 */
export type GametimeStatLine = {
  player_id: string;
  name: string | null;
  position: StatBoardPosition;
  /**
   * His NFL team, which is also the key his game is under on `board`. Null is
   * "the feed did not say" and never a guess — such a row still prints its
   * figures, with its opponent and its clock left as dashes.
   */
  team: string | null;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_yd: number;
  rush_td: number;
  rec: number;
  rec_yd: number;
  rec_td: number;
  fumbles_lost: number;
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
   * priced; the checker's own reading of that status.
   *
   * The two feeds beside it degrade rather than empty the page, and each
   * degrades **into the reading that claims least**:
   *
   * - A failed `stats` read leaves every `scored` null and prices the week as
   *   a projection — the whole projection, not the share of it the clock has
   *   left, because with no feed nothing is *known* to have been scored and
   *   charging the elapsed clock would price the week on the arithmetic that
   *   nothing was.
   * - A failed `scores` read still carries the last scoreboard on `board`,
   *   because a reading twenty seconds old beats none, but it is not what the
   *   week is priced against: a player with a stat line is priced as half
   *   played and one without as not started. A stale clock left in the
   *   arithmetic would go on dividing one dead instant into every roster in
   *   the league for as long as the feed was out.
   *
   * **All three ride every frame**, so a reader is told when a feed fails and
   * when it comes back, even where not one number moved in between — see
   * `gametime/live-rules`' `feedsMoved`.
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
   * and an empty board is a scoreboard this process has never read. Once per
   * payload rather than once per seat — see `GametimePlayer.live`.
   *
   * **`scores: "error"` beside a populated board is the last one read rather
   * than the current one**, and it is a caption at that point rather than a
   * factor: it is what the seat rows print and it is *not* what `live` was
   * computed from. See the statuses above.
   */
  board: Record<string, GametimeGame>;
  /**
   * Every skill player with a scoring line this week, keyed by player id —
   * the stat board's whole population, and **the account's own leagues have
   * nothing to do with it**.
   *
   * It is one read of the week for everybody watching it rather than a fact
   * about any roster, which is why it rides here beside `board` rather than
   * inside `leagues`: a hundred league entries would each carry a copy of it.
   * Empty where the stats feed could not be read — see `stats` above, and
   * `statBoardLines` for which rows a published feed produces.
   */
  players: Record<string, GametimeStatLine>;
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
export type GametimeDelta = Omit<ManagerGametimePayload, "leagues" | "players"> & {
  leagues: Record<string, GametimeLeague>;
  removed: string[];
  /**
   * The stat lines that moved, and the ids that left it — the same two-part
   * diff as the leagues above, over the payload's `players`.
   *
   * **It is diffed rather than carried whole, and that is what keeps a Sunday
   * affordable.** The board is a few hundred rows and its identity half —
   * name, position, team — cannot change for the length of a week; what moves
   * on a tick is the handful of players who touched the ball since the last
   * one. Ridden whole on the header it would be by some distance the largest
   * thing on this wire, pushed every twenty seconds to every reader, most of
   * whom never open the board at all — which is the cost the delta was
   * introduced to remove, reintroduced one field over.
   */
  players: Record<string, GametimeStatLine>;
  removed_players: string[];
};

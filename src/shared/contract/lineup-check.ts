/**
 * The lineup checker's answer: for one week, what each league's lineup projects
 * against the best one still reachable from it, and whether its starters are
 * seated in the order they lock best in.
 *
 * Types only, like everything in `contract/` — the route builds this on the
 * server and the cards render it, so it must be importable from a `"use
 * client"` module without dragging `pg` or the solver along.
 *
 * **A separate file from `./lineups`, deliberately.** That one answers a
 * rest-of-season question: its `LineupPlayer` carries `adp_value`, the fallback
 * key for pricing an unprojected stash across a whole season, and carries
 * nothing about kickoffs because a season has none. This one is a *week* — a
 * player is locked or he is not, he kicks off at an instant or the schedule
 * does not say. Two grains, two types.
 */

/** One rostered player, as this week's solve priced him. */
export type LineupCheckPlayer = {
  player_id: string;
  /** From the projections feed; null where the feed doesn't know the id. */
  name: string | null;
  /** Sleeper `fantasy_positions`; empty seats the player nowhere. */
  positions: string[];
  /**
   * This week's projected points under the league's own scoring.
   *
   * **Null and zero are different answers.** Null is "the feed has no row for
   * this id at all". Zero is a row with no game — a bye, or a player nobody
   * projects — which is a real projected zero and is what the solve seats him
   * on. Both start on the bench; only one of them is worth printing a number
   * for.
   */
  points: number | null;
  /** His NFL team, or null where the feed didn't say. */
  team: string | null;
  /**
   * Kickoff of his game, epoch ms. Null is "not known" — a bye, or a week the
   * schedule has not published — and never "never plays".
   */
  kickoff: number | null;
  /**
   * His game has kicked off. He is still in the lineup and still scoring, but
   * he is no longer a *choice*: the seat he holds is held as it stands and he
   * is out of the pool for every other seat.
   */
  locked: boolean;
};

/** One starting slot of the lineup as it is currently set. */
export type LineupCheckSeat = {
  slot: string;
  /** Null for a slot Sleeper is carrying empty. */
  player: LineupCheckPlayer | null;
  /**
   * The slot kickoff order would seat him in instead, or null where he stays
   * put — which is also what every seat reads when there is no ordering to be
   * had (see {@link LineupCheckLeague.kickoff_moves}).
   *
   * Derived on the server with `kickoffMoves`, the same function the count is
   * derived from, so a card's badge and its per-row marks cannot disagree.
   */
  move_to: string | null;
};

/** One league's week. */
export type LineupCheckLeague = {
  roster_id: number;
  /** Sleeper seats this lineup itself, so there is no gap and no seat order. */
  best_ball: boolean;
  /**
   * Whether the graded lineup is the week's own stored one or the roster's
   * live one — see `getManagerWeekLineups`. `"current"` on any week the sync
   * has no matchup row for, which a card must say rather than imply.
   */
  as_of: "week" | "current";
  /** What the lineup as set projects. */
  current_points: number;
  /**
   * What this week's opponent's lineup as set projects, or **null where there
   * is no answer** — a week with no stored matchup rows (every future week, by
   * construction), a week Sleeper filed without a `matchup_id`, or an opponent
   * whose roster is not stored.
   *
   * Never zero for any of those: a zero is a roster genuinely projected to
   * score nothing, and the card draws a projected *win* from the comparison.
   * Solved through the same `compareLineup` the manager's own total comes from,
   * so the two figures on the plate are the same measurement twice.
   */
  opponent_points: number | null;
  /**
   * What the best lineup **still reachable** projects — seats held by a player
   * whose game has kicked off stay as they are, the rest are solved. Part-way
   * through a week that is a different number from the best lineup outright,
   * and it is the one worth sending: the other names moves Sleeper will refuse.
   */
  optimal_points: number;
  /**
   * `optimal − current`: points that can still be had by moving somebody. Zero
   * is a real answer and a good one — the lineup is already the best available.
   */
  points_left: number;
  /** Benched players the optimal lineup starts. */
  start: string[];
  /** Started players the optimal lineup benches. */
  sit: string[];
  /**
   * How many starters sit in a different seat than kickoff order wants —
   * earlier games in the strict slots, later games in the flexes, so the
   * interchangeable seats stay open longest for a late scratch.
   *
   * Kickoffs within an hour of each other count as one (`KICKOFF_BUFFER_MS`),
   * so the Sunday 4:05 and 4:25 windows never generate a move on their own: a
   * seat freed twenty minutes earlier frees no decision.
   *
   * **Zero is a real answer — the lineup already locks strict-seats-first —
   * where null is no answer at all**: a best-ball league, or a week the
   * schedule publishes no kickoff instants for.
   */
  kickoff_moves: number | null;
  /** The lineup as set, in the league's own slot order. */
  lineup: LineupCheckSeat[];
  /** Everyone else, best first. */
  bench: LineupCheckPlayer[];
  /**
   * The roster census, as the league counts it: how many players are held
   * against how many the league allows, with taxi and IR counted against their
   * own limits rather than against the active roster — which is how Sleeper
   * enforces them.
   *
   * **Null is "not on file" and zero is "this league has none".** A league with
   * no `taxi_slots` key and no `TAXI` seat simply has no taxi squad
   * (`taxi_max: 0`); a league whose settings were never synced cannot be
   * answered for (`null`), and the tile draws an em dash rather than claiming
   * the roster is empty. The same three-way grammar every other figure on this
   * wire is written in.
   *
   * The counts are the *live* roster's, not the stepped week's: Sleeper stores
   * no historical `reserve` or `taxi`, and the question the check answers —
   * will Sleeper refuse an add — is a question about now. It is the one figure
   * on the card that does not move with the week stepper.
   */
  roster_count: number;
  roster_max: number | null;
  ir_count: number;
  ir_max: number | null;
  taxi_count: number;
  taxi_max: number | null;

  /**
   * Starting slots this build doesn't recognise, left out of the comparison.
   * Non-empty means the numbers cover only part of the real lineup.
   */
  unknown_slots: string[];
};

/** Whether the projections behind the numbers could be read at all. */
export type LineupCheckStatus = "ok" | "error";

/** `GET /api/user/[username]/lineup-check` — one week, every league. */
export type ManagerLineupCheckPayload = {
  season: string;
  /**
   * The week these numbers are for, always echoed so the client reads one
   * answer rather than assuming its own. Null when the season has no week to
   * check — a past season — which is a fact about the season and not a failure.
   */
  week: number | null;
  /**
   * `"error"` means the projections read failed: the leagues below are real and
   * their numbers are absent, rather than a page of confident zeroes. A failed
   * *schedule* read is not this — it degrades to `kickoff_moves: null` per
   * league and leaves everything else standing.
   */
  projections: LineupCheckStatus;
  /**
   * Keyed by league id. A league is **absent** where nothing could be solved
   * for it — no slots or scoring on file — which is a different answer from a
   * zero gap.
   */
  leagues: Record<string, LineupCheckLeague>;
};

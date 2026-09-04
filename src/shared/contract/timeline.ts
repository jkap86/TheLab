import type { KtcFormat } from "./ktc";
import type { PlayerSummary } from "./names";

/**
 * A league's rosters at any moment its stored move log can reach — answered by
 * `GET /api/league/[leagueId]/timeline`.
 *
 * **The log crosses the wire, not the answer**, which is the whole design. A
 * stop on the rail is the current rosters with everything since it reversed,
 * and there is a stop per move — so an answer per stop would be the league's
 * rosters times its transactions, where the log is the transactions alone and
 * the reversal is arithmetic a browser does thousands of times a second. One
 * request buys every stop, so scrubbing costs nothing after it.
 *
 * **An unanswerable timeline is `null`, and its host draws no rail at all.** A
 * league nobody has moved a player in has nothing to rewind, and a league whose
 * rosters are not stored has nothing to rewind *from*. Neither is an error, and
 * neither stops the league being shown as it stands.
 *
 * The reconstruction's own two limits ride along and are worth knowing before
 * trusting a stop — see `shared/timeline/rewind`: a draft is not a transaction,
 * so a stop reaching back across a rookie draft over-reports that class; and the
 * pick horizon is today's, so a pick in a season already drafted is absent
 * unless a reversed trade names it.
 */
export type RosterTimelinePayload = {
  /**
   * The timeline itself, or null where there is none to draw — see above.
   *
   * Nested rather than flattened into nullable fields so that "no timeline" is
   * one check rather than three that could disagree.
   */
  timeline: {
    league_id: string;
    /** Every roster in the league, in roster-id order. */
    rosters: TimelineRosterPayload[];
    /**
     * The league's completed moves, **newest first** — ending with the oldest
     * one on file.
     *
     * Newest-first is the direction the reversal runs and the order the trades
     * board is read in; the rail turns it into a left-to-right run of stops.
     */
    events: TimelineEventPayload[];
  } | null;
  /**
   * Player ids → name/position/team for everyone the timeline can name — every
   * current roster, plus everyone added or dropped in the window.
   *
   * The union rather than the current rosters alone, because a stop's whole
   * point is the players who are no longer there: a roster read back to October
   * holds people the league has since dropped, and the card's own payload knows
   * nothing about them.
   */
  players: Record<string, PlayerSummary>;
  /**
   * Today's boards, so a past roster can be priced at **what it would be worth
   * now** — see {@link TimelinePricingPayload}.
   *
   * Null where the league itself is not stored, which is the same case
   * `timeline` is null for and the only one where there is nothing to price.
   */
  pricing: TimelinePricingPayload | null;
};

/**
 * What a rewound roster is priced against: today's projections, today's draft
 * capital, today's KeepTradeCut market and today's pick grid.
 *
 * **The question a past stop answers is a counterfactual, not a reconstruction
 * of the numbers as they stood.** Nothing here is a historical price — this
 * database keeps no history of any of the three boards — and pretending
 * otherwise would be the claim the rest of this payload is built to avoid. What
 * a reader gets instead is the one question the stored data can answer
 * honestly: *what would that roster be worth today*, which is what makes a
 * trade or a drop legible after the fact.
 *
 * **The boards must be the same ones the card in front of the rail reads.**
 * A past total measured on a different ADP board or a different KTC market than
 * the present one is not a comparison, so this route takes the same `season`,
 * `user` and `ktc_board` the lineups route does and resolves all three the same
 * way. That is why a league-scoped read carries a manager parameter at all: the
 * ADP fallback board is built from *that manager's* synced drafts.
 *
 * **It is the solver's own inputs rather than a table of answers**, which is
 * the same trade the rest of this payload makes. One stop is one roster set,
 * and there is a stop per move; shipping totals would be the league's rosters
 * times its transactions, where shipping the boards is the boards alone and the
 * solve is arithmetic the browser runs per stop. `shared/manager`'s solve chain
 * is pure precisely so a browser can call it.
 */
export type TimelinePricingPayload = {
  /** What `solveLeagueLineup` reads about the league itself. */
  league: {
    total_rosters: number;
    roster_positions: string[] | null;
    /**
     * The league's own scoring. It is what turns a stat line into points, which
     * is why the lines below travel unscored: a TE-premium or 6-pt-pass league
     * differs by exactly the margin that misseats a bench.
     */
    scoring_settings: Record<string, number> | null;
  };
  /**
   * Today's rest-of-season line for every player the timeline can name.
   *
   * **`stats` carries only the keys this league scores**, which is exact rather
   * than an approximation: `scoreStatLine` is driven by the scoring settings, so
   * a category the league does not score is never read and shipping it would be
   * wire weight nothing multiplies. `weeks` rides along because its emptiness is
   * what separates "no projection" from "a projected zero".
   */
  projections: Record<string, TimelineProjectionPayload>;
  /** Today's average draft position for the same players, and its board. */
  adp: Record<string, { board: "full" | "rookie"; adp: number }>;
  /** Today's KTC price on **this league's** market and QB board; unpriced absent. */
  ktc_values: Record<string, number>;
  /**
   * Every cell of the league's pick grid, resolved once — keyed by
   * `season|round|origin roster`, the key `pickCellKey` writes.
   *
   * Holder-independent by construction, which is what makes a rewound portfolio
   * a lookup rather than a second resolution of the draft order: a stop moves
   * cells between rosters and changes nothing about a cell.
   */
  picks: Record<string, TimelinePickCellPayload>;
  /** Which week the projections start from; null when none were read. */
  from_week: number | null;
  /** Which KTC market answered and when it was scraped; null on a failed read. */
  ktc: { board: KtcFormat; updated_at: string | null } | null;
};

/** One player's summed rest-of-season line — `RosPlayerProjection` on the wire. */
export type TimelineProjectionPayload = {
  player_id: string;
  stats: Record<string, number>;
  weeks: number[];
  name: string | null;
  positions: string[];
};

/** One pick cell, resolved — `PickCell` on the wire. */
export type TimelinePickCellPayload = {
  slot: number | null;
  origin_name: string;
  value: number | null;
};

/**
 * One roster as it stands now — the state the replay rewinds *from*, already
 * named.
 *
 * **The name is resolved here rather than shipped as a manager map**, which is
 * where this parts company with TheLabX's payload: it carries `managers` keyed
 * by user id because a pick's origin could be a roster its card had never
 * heard of. This payload carries *every* roster in the league, so an origin is
 * always a row on this list and naming it is a lookup the client already has in
 * hand. One name per roster, by `leagueTeamName`'s one spelling — team name,
 * then the owner's display name, then "Roster N" — so a team is called the same
 * thing here as it is in the card's own teams pane.
 *
 * There is deliberately no avatar on it: the teams pane this rail swaps for
 * draws none. Re-adding a field is cheap.
 */
export type TimelineRosterPayload = {
  roster_id: number;
  /** What to call this team — see above. Never empty. */
  name: string;
  /**
   * Who holds it today, or null on an orphaned roster.
   *
   * It is on the wire for one reason: the solve that prices a past stop ranks
   * a *manager* among the league, and the card knows which roster is theirs
   * rather than which user id. This is the join between the two.
   */
  user_id: string | null;
  players: string[];
  /** The future picks it holds, named by the roster each originally belongs to. */
  picks: TimelineHeldPickPayload[];
};

/** A future pick as a roster holds it, named by where it came from. */
export type TimelineHeldPickPayload = {
  season: string;
  round: number;
  /** The roster the pick originally belongs to — Sleeper's own `roster_id`. */
  roster_id: number;
};

/**
 * One move in a league, as the timeline replays and labels it.
 *
 * **The blobs travel in Sleeper's own spelling**, which is what lets the browser
 * hand an event straight to `rewindRosters` — the reversal is one function, and
 * a normalised wire shape would mean a second reading of the same three columns
 * on this side of the wire. `adds` and `drops` are player id → roster id, and
 * `draft_picks` carries the origin plus both ends of the move, because that is
 * what undoing one needs.
 */
export type TimelineEventPayload = {
  transaction_id: string;
  /** Sleeper's `type` — `trade`, `waiver`, `free_agent`, `commissioner`. */
  type: string | null;
  /** When it completed, epoch milliseconds. */
  at: number;
  /** The rosters it named. */
  roster_ids: number[];
  /** Player id → the roster that received him. */
  adds: Record<string, number>;
  /** Player id → the roster that gave him up. */
  drops: Record<string, number>;
  draft_picks: TimelinePickPayload[];
};

/** A pick as one move handed it over. */
export type TimelinePickPayload = {
  season: string;
  round: number;
  /** The roster the pick originally belongs to — Sleeper's own `roster_id`. */
  roster_id: number;
  /** Who took it, and who sent it. Null where Sleeper named neither. */
  owner_id: number | null;
  previous_owner_id: number | null;
};

import type {
  AdpBoardStats,
  AdpBoardType,
  AdpFilters,
  AdpRosterValue,
  DraftDensityMonth,
  LeagueDetail,
  Leaguemate,
  LeagueRank,
  LeagueTeam,
  ManagerLeague,
  ProjectedRank,
  SyncProgress,
  SyncSummary,
} from "@/shared/manager";
import type { KtcRosterValue, KtcValue } from "@/shared/ktc";
import type { PlaceholderPick } from "@/shared/picktracker";
import type { PlayersSyncSummary, PlayerSummary } from "@/shared/players";
import type { Trade } from "@/shared/trades";
import type { StatsSyncSummary } from "@/shared/stats";
import type {
  LeagueOutlook,
  ProjectionFilters,
  ProjectionsSyncSummary,
} from "@/shared/projections";

/**
 * The wire contract between this app's API routes and the client that reads
 * them — every route's payloads and stream messages, in one module.
 *
 * Declared once, here, and imported by both sides: the route handlers annotate
 * what they send with these types and the `manager` feature annotates what it
 * receives, so a change to one end that the other doesn't follow is a type
 * error rather than a runtime surprise.
 *
 * Types only, and everything it pulls from the domain modules comes in with
 * `import type` — those imports are erased at compile time, which is what lets
 * client code import this module without dragging `pg` into the bundle, and
 * what keeps the manager-module references here from being a runtime cycle.
 */

/** The public user shape returned by the app's user/leagues APIs. */
export type UserInfo = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  avatar_url: string | null;
};

/**
 * A team as sent to the client. The database stores an avatar *id*; the client
 * needs a URL, so the route resolves it and drops the raw id.
 */
export type LeagueTeamPayload = Omit<LeagueTeam, "manager"> & {
  manager:
    | (Omit<NonNullable<LeagueTeam["manager"]>, "avatar"> & {
        avatar_url: string | null;
      })
    | null;
};

/**
 * Per-player KeepTradeCut and ADP values on the board this league reads, for the
 * roster panel's selectable value columns.
 *
 * Both are keyed by player id with unpriced ids *absent* rather than zeroed — an
 * em dash on the roster, not a value of zero, the same reading the collapsed
 * card's KTC total takes. The board a value was read on travels with it
 * (`superflex`, `adp_board`), since the same player is worth materially
 * different totals across boards and reading a roster off the wrong one is wrong
 * at every position.
 */
export type LeagueRosterValues = {
  /**
   * Which board priced these: superflex where the league starts more than one
   * quarterback, 1QB otherwise. Shared by both lenses' hovers.
   */
  superflex: boolean;
  /** When the KTC rows were scraped, ISO 8601; null when nothing here is priced. */
  ktc_updated_at: string | null;
  /**
   * The league-type board the ADP values were averaged over: dynasty leagues
   * read the dynasty side of the fetch, redraft and keeper leagues the redraft
   * one.
   */
  adp_board: AdpBoardType;
  /** How many crawled drafts stood behind the ADP board — a thin board is noisy. */
  adp_draft_count: number;
  /** Player id → KTC dynasty value on this league's board; unpriced ids absent. */
  ktc: Record<string, number>;
  /** Player id → ADP-derived draft-capital value on this league's board; unpriced absent. */
  adp: Record<string, number>;
  /** Player id → the raw average draft position behind that ADP value, for the hover. */
  adp_position: Record<string, number>;
};

/**
 * A points-per-game reading, with the population behind it.
 *
 * `games` travels with `average` rather than being left to be derived, the habit
 * `outlook.weeks`, KTC's `priced` of `rostered` and `aggregateRecord`'s league
 * count all keep: an average over two games and one over eleven are different
 * claims, and only the denominator says which is on screen.
 */
export type PpgPayload = { average: number; games: number };

/** One seat of a lineup: which slot, and who is in it (null for an empty one). */
export type LineupSlotPayload = { slot: string; player_id: string | null };

/**
 * One team's week: the two totals, the lineup behind them, and the swaps between.
 *
 * **The lineup is what that team is *actually* starting**, which is what the
 * week panel's roster half lists — a reader who arrived at a lineup is asking
 * what to change, and a list of the best available answers a different question.
 * It is sent rather than rebuilt from `starters` on the client because a client
 * cannot reproduce it: the slots this app doesn't recognise are dropped by the
 * solver's own rule, and a **best-ball** league's `starters` array is not its
 * lineup at all — Sleeper seats the optimal one there, so that is what this
 * carries and `sit`/`start` are empty (see `compareLineup`).
 *
 * `sit` and `start` are the two ends of the same swaps, so a starter to move out
 * and the bench player to move in are one answer read from two lists. Points are
 * *not* on a seat: every one of them is on `projection`, under the same player
 * id, and a number written twice is a number that can disagree with itself.
 */
export type TeamWeekProjectionPayload = {
  optimal: number;
  current: number;
  points_left: number;
  lineup: LineupSlotPayload[];
  sit: string[];
  start: string[];
  /**
   * The same starters re-seated so the lineup locks its strict seats first —
   * earlier kickoffs in dedicated slots, later ones in the flexes, in the same
   * seat order as `lineup`, so the two diff index by index. Which players move
   * (and to where) is read off the pair with `kickoffMoves`
   * (`shared/projections/kickoff-order`, pure and client-importable) — the
   * same function the matchups route counts {@link MatchupProjectionPayload.kickoff_moves}
   * with, so the card's count and the panel's marks cannot disagree.
   *
   * Null is "no answer", never "already ordered": a best-ball league (Sleeper
   * seats that lineup after the games), or a week the schedule supplies no
   * kickoff instants for. Already ordered is this array equal to `lineup`.
   */
  kickoff_order: LineupSlotPayload[] | null;
};

/**
 * One league read as a **week** — what each subject projects for it, and what
 * each has actually been averaging coming into it.
 *
 * Sent only when the caller asked for a week (`?week=`), which the lineup
 * checker does and the leagues list and trades board do not: everything else
 * that panel shows is a rest-of-season shape, which is the right question when a
 * reader arrives at a league and the wrong one when they arrive at a *lineup*.
 *
 * Null where the week's read failed. The rosters are the point of that route and
 * this is a pair of columns on top of them, so a failure here costs the columns
 * and not the panel — the call `outlook` already makes beside it.
 */
export type LeagueWeekViewPayload = {
  week: number;
  /**
   * Which season the averages were counted over, how many weeks contributed, and
   * whether this is the previous season standing in for a window with nothing in
   * it (week 1, or a season not yet backfilled).
   *
   * A property of the *read*, not of a row: the fallback fires because the window
   * is empty, never because one player missed every game in it — a player with no
   * games inside a real window is an em dash. Mixing the two would put two
   * seasons' numbers in one column with nothing saying which was which.
   */
  ppg_source: { season: string; weeks: number; prior: boolean };
  /** Player id → his projected points for the week, in this league's scoring. */
  projection: Record<string, number>;
  /** Player id → his points per game over the window; absent where he has none. */
  ppg: Record<string, PpgPayload>;
  /** Roster id → that team's best and current lineup for the week. */
  team_projection: Record<string, TeamWeekProjectionPayload>;
  /** Roster id → that team's points per game over the same window. */
  team_ppg: Record<string, PpgPayload>;
};

/** `GET /api/league/[leagueId]` — standings and rosters for one league. */
export type LeagueDetailPayload = Omit<LeagueDetail, "teams"> & {
  teams: LeagueTeamPayload[];
  /** Player ids → resolved name/position/team, for rendering rosters. */
  players: Record<string, PlayerSummary>;
  /**
   * Per-player KTC and ADP values on this league's board, for the roster panel's
   * selectable value columns. Always present — an empty set of maps where nothing
   * on these rosters is priced — so the client needn't guard its shape.
   */
  values: LeagueRosterValues;
  /**
   * Every roster's best starting lineup for the rest of the season, ranked on
   * each player's projected points aggregated over `outlook.weeks` and scored
   * with *this* league's `scoring_settings` — so the same player is worth
   * different totals in two leagues, which is the point.
   *
   * One lineup per team rather than one per week: `optimal` answers "who belongs
   * in your starting slots from here", and `current`/`points_left`/`start`/`sit`
   * diff that against what the roster is starting today.
   *
   * `weekly_optimal_points` is the team total for the same horizon and is a
   * different number: it re-sets the lineup every week, so it covers byes and
   * alternating starts, and is the one to show as "what this team projects to
   * score" rather than either lineup's total. `weekly_split` is that same total
   * attributed player by player — how much of each one's projection lands in a
   * starting slot and how much of it never leaves the bench — so it is keyed by
   * player id but scoped to a team, since being stuck behind someone is.
   * `weekly_bench_points` is the team-level sum of those bench halves: the depth a
   * roster is carrying without playing, which is why it sits beside the projected
   * total in the standings rather than being folded into it.
   *
   * The horizon is the weeks actually stored, which the sync keeps a short window
   * of — read `outlook.weeks` rather than assuming it runs to week 18, and say
   * how far ahead the numbers reach wherever they surface.
   *
   * null when the league can't be projected: no slots or scoring settings on
   * file, or no weeks left on the schedule.
   */
  outlook: LeagueOutlook | null;
  /**
   * The same league read as one week, when the caller asked for one — see
   * {@link LeagueWeekViewPayload}.
   *
   * Absent rather than null when no `?week=` was sent, which is the honest
   * spelling of "not asked for": null is what a *failed* week read answers with,
   * and a panel needs to tell "these columns have no data" from "these columns
   * were never requested".
   */
  week_view?: LeagueWeekViewPayload | null;
};

/** A manager's leagues, sent once from cache and again after a refresh. */
export type LeaguesResultMessage = {
  type: "result";
  user: UserInfo;
  season: string;
  leagues: ManagerLeague[];
  /**
   * true when the leagues sent are **not known-current** — cached past their
   * TTL, or left short by a sync that failed, lost the lock or was throttled.
   * It is the negation of {@link SyncSummary.complete} on the post-refresh
   * message, and never merely "a refresh is running".
   */
  stale: boolean;
  /** true when a refresh is running and a second `result` will follow. */
  refreshing: boolean;
  /** Present only on the post-refresh message. */
  summary?: SyncSummary;
};

/** Per-league sync progress, so a 100+ league account can show a bar. */
export type LeaguesProgressMessage = SyncProgress & {
  type: "progress";
  /** `initial` is a cold foreground sync; `refresh` runs behind sent cache. */
  phase: "initial" | "refresh";
};

export type LeaguesErrorMessage = { type: "error"; error: string };

/**
 * `GET /api/user/[username]/players` — the manager's own roster in every league
 * they're in, which is what a count of player shares is built from.
 *
 * Rosters carry ids and nothing else: the client already has the league list off
 * the leagues stream and joins on `league_id`, so a league's name, record and
 * settings aren't repeated once per rostered player. `players` resolves the
 * union of those ids once for the same reason — a player on twenty rosters is
 * one entry here, where a per-roster payload would carry him twenty times.
 *
 * Read-only, and deliberately: the leagues stream is what syncs these rosters,
 * so a manager who has never been looked up comes back with an empty `rosters`
 * rather than triggering a second sync of their own.
 */
export type ManagerPlayersPayload = {
  season: string;
  /** League id → the player ids on the manager's roster there. */
  rosters: Record<string, string[]>;
  /** Player ids → name/position/team, for every id above the cache knows. */
  players: Record<string, PlayerSummary>;
};

/** A league member as sent to the client (avatar id resolved to a URL). */
export type LeaguematePayload = Omit<Leaguemate, "avatar"> & {
  avatar_url: string | null;
};

/**
 * `GET /api/user/[username]/leaguemates` — every member of every league the
 * manager is in, which is what a count of shared leagues is built from.
 *
 * The same shape as {@link ManagerPlayersPayload} with user ids where it has
 * player ids, for the same reasons: the client joins `members` against the
 * league list it already holds, and `users` resolves each id once however many
 * leagues share it. `members` keeps the manager's own id — its presence is what
 * marks a league as cached even when they share it with nobody — and the client
 * drops it from the counts, since it knows whose page it is on.
 *
 * Read-only like the sibling `players` route: it reads the membership the
 * leagues stream stored, so a manager it has never run for gets `{}` back.
 */
export type ManagerLeaguematesPayload = {
  season: string;
  /** League id → the user ids in that league's cached member list. */
  members: Record<string, string[]>;
  /** User ids → display name and avatar, for every id above. */
  users: Record<string, LeaguematePayload>;
};

/**
 * `GET /api/trades` — one page of the trades board, newest first.
 *
 * Not a manager route, and that is the whole shape of it: the trades worth
 * reading are the market's, not one account's, so this reads the leagues this
 * database has crawled rather than the leagues someone plays in.
 *
 * **It used to stream the whole season and it is now filtered and paginated,
 * which is the largest performance change in the app.** The old shape followed
 * from one constraint: every chip on the page was applied in the browser and the
 * filter menus were read off the trades themselves, so the browser needed the
 * unnarrowed season — ~48k trades and ~20MB of JSON on a busy one. Streaming it
 * in chunks made that cost progressive rather than removing it, and it stayed a
 * cost the reader paid before seeing anything useful: a season read, serialised,
 * gzipped, parsed and held live to render twenty cards.
 *
 * Three things had to move for pagination to preserve the page rather than
 * cripple it, and each has its own route or field:
 *
 * - **The filters moved to SQL.** Season, window, players, picks, managers and
 *   the match mode are query parameters now (`shared/trades/params`), so a
 *   narrowed board is narrowed by the database and the reader downloads matches
 *   rather than candidates.
 * - **The league rules stayed on the client**, because they are a slot-group and
 *   scoring-key engine over Sleeper's JSONB blobs and a second copy in SQL would
 *   drift invisibly. {@link TradeLeaguesPayload} hands the page every league of
 *   the season once; it evaluates the rules and sends back ids.
 * - **The filter menus moved to their own route.** {@link TradeFacetsPayload} is
 *   the option lists and their counts, computed over the same population, asked
 *   for only when the dialog opens.
 *
 * What is unchanged is the payload's own idea, carried over from the stream: a
 * trade names ids and the maps beside it resolve them, and the client merges
 * each page's maps into what it already holds rather than replacing them.
 *
 * What is *not* carried over is the stream's delta. It held a set of what it had
 * already sent, so a player crossed the wire once per season; pages are separate
 * requests, and the equivalent would be the client listing every id it holds on
 * each one — a few thousand of them in a query string, which is a 414 waiting
 * for the reader who scrolls furthest. A page is self-contained instead: it
 * re-sends the names its own ~400 distinct players share with earlier pages,
 * which is ~8KB compressed and bounded by the page size rather than the season.
 *
 * Read-only over what the crawl and the manager syncs stored: a league nobody
 * has looked up has no transactions here rather than being fetched on demand.
 */
export type TradesPagePayload = {
  season: string;
  /** Newest first, continuing after the cursor the request carried. */
  trades: Trade[];
  /**
   * The token for the next page, or null at the end of the board.
   *
   * Opaque, and null is the *only* end-of-board signal — a page shorter than the
   * limit is one too, but a page that happened to end exactly on the limit is
   * not, so the two are collapsed into this one field rather than left to the
   * client to infer from a length.
   */
  nextCursor: string | null;
  /**
   * How many trades match this query in full, or null when it wasn't counted.
   *
   * **Counted on a first page and never on a later one**, which is what makes
   * pagination cheaper than the stream rather than more expensive: a count is a
   * scan of the population, and a scan per page would be fifty of them. The
   * client carries the first page's answer across the rest of the set.
   *
   * The unnarrowed count — the state the page opens in — is not counted at all;
   * it is read out of `trade_market_stats`, refreshed by the crawler that writes
   * the trades behind it.
   */
  total: number | null;
  /**
   * How many trades the **league filters alone** leave, or null when it wasn't
   * counted (a later page, or a query where it equals `total`).
   *
   * This is the `M` in the page's "N of M trades": the league filters say which
   * leagues' trades are on the board at all, and the trade filters say which of
   * those are worth looking at. Two numbers because they are two questions, the
   * same distinction the two filter dialogs draw.
   */
  scopeTotal: number | null;
  /** Player ids → name/position/team, for players the client said it lacks. */
  players: Record<string, PlayerSummary>;
  /**
   * User ids → display name and avatar, for sides the client said it lacks. A
   * side naming a user id that never arrives is one whose member row isn't
   * stored; the client falls back to the roster number.
   */
  managers: Record<string, LeaguematePayload>;
  /**
   * Player ids → **both** KTC boards, for players the client said it lacks.
   *
   * Both numbers rather than one, because the board is a fact about the *league*
   * a trade happened in and this route spans every crawled league: a two-QB room
   * reads the superflex board and a 1QB room the other, and the same player is
   * worth materially different totals on the two. The client picks per trade
   * from the league's own lineup ({@link ManagerLeague.roster_positions}), the
   * same predicate that groups a draft into an ADP board population.
   *
   * A player KTC doesn't price is **absent** rather than zeroed — its board is
   * ~500 dynasty skill players deep, so a kicker or a rookie IDP is off it
   * entirely, which is a different claim from being worth nothing.
   */
  ktc: Record<string, KtcValue>;
  /**
   * KTC's **rookie-pick** rows, for the picks on this page — keyed by
   * {@link ktcPickKey}, which is a season, a round and a third of that round.
   *
   * A second map rather than more entries in the one above, because a pick is
   * not a player anywhere: it has no Sleeper id to be keyed by, which is why
   * these rows sat unread in `ktc_values` while the card said draft picks
   * weren't on KTC's board at all.
   *
   * **The whole board travels, not the rows this page's picks land on.** Two
   * reasons, and the second is why it is no longer narrowed. Which third of a
   * round a pick falls in needs the league's draft order *and* its size, and the
   * size is on the league list the client already holds — so the tier is
   * resolved there, and every tier of a row has to be here for it to resolve
   * against ({@link ktcPickPrice} is that lookup, and what decides the fallback
   * for a pick whose draft doesn't exist yet). Beyond that, the ADP column
   * discounts a future pick by the ratio of its row to the **nearest priced
   * season's**, which is a fact about the board rather than about any pick on
   * the page: a page naming no 2027 pick could not have asked for the row that
   * answers it. The board is a few dozen rows, so it is sent whole rather than
   * narrowed to a superset nobody can compute.
   */
  pickKtc: Record<string, KtcValue>;
  /**
   * Where a traded pick falls, for the picks on this page whose league has set
   * the order — keyed by {@link pickSlotKey}, so a card names a pick the way
   * Sleeper does ("2026 1.05") where the order is known and by its round
   * ("2026 1st") where it isn't.
   *
   * **Absent means unordered**, never zero: most picks on a board are two or
   * three seasons out, and a draft that doesn't exist yet has no slots to give.
   * It rides beside the trades rather than on each pick because a slot is a fact
   * about a league's draft — one entry serves every trade that names that
   * roster's pick, of which a busy league has many.
   */
  pickSlots: Record<string, number>;
};

/**
 * `GET /api/trades/leagues` — every league with a trade on a season's board.
 *
 * The league filters' whole input. It is a separate route rather than a field on
 * the page above because it is asked for **once per season** and the pages are
 * asked for many times: bundling it would re-send a few hundred leagues' worth
 * of `settings`, `roster_positions` and `scoring_settings` blobs with every
 * scroll. Separated, it is one request the client caches for fifteen minutes,
 * and it serves three readers at once — the filter dialog's option counts and
 * breakdown rows, the ids the trades query is narrowed by, and the name every
 * trade card puts on its league.
 *
 * Restricted to leagues that actually traded, which is what the old stream's
 * league list converged on (it accumulated them as their trades arrived), so the
 * dialog's counts mean what they meant.
 */
export type TradeLeaguesPayload = {
  season: string;
  leagues: ManagerLeague[];
};

/** One selectable value in a trade filter menu, and how many trades name it. */
export type TradeFacet = {
  value: string;
  count: number;
};

/**
 * `GET /api/trades/facets` — the trade filter dialog's three menus, and how many
 * trades the draft selection would leave.
 *
 * **The menus are read off the trades and always were**; what changed is only
 * where the counting happens. A fixed list would offer players nobody traded
 * while hiding the one someone wants, so the options are whatever the season
 * actually moved — which was free while the browser held the season and is a
 * grouped aggregate now that it doesn't.
 *
 * The counts are over the population narrowed by everything **except the
 * selection itself** — the league filters and the window, not the picked players
 * — because a menu counted over its own selection collapses to that selection
 * the moment you make one and can't be widened without being cleared first.
 *
 * **Which is why the board's own total is not here.** It is counted *with* the
 * selection, so it changes on every checkbox, while nothing in this payload can.
 * Together they would make one checkbox re-run a grouped aggregate over the
 * season for a number the page already has: the filters commit live, so the
 * narrowed total arrives on the first page of {@link TradesPagePayload} and this
 * is fetched once per league scope and window.
 *
 * **The values are ids and the labels are not here**, with one exception. A
 * pick's label is a pure formatting of its own token (`"2026-1"` → `"2026 1st"`)
 * and the client already owns that function, so sending it would be sending a
 * string derivable from the one beside it. Player and manager labels are not
 * derivable — they are rows in other tables — so those arrive in `names`, which
 * is the same shape and the same merge as a page's own maps. A facet can name a
 * player no loaded page does, which is exactly why they travel together.
 *
 * Asked for only while the filter ledge is open, which is what makes the cost
 * acceptable: a reader who never opens it never pays for it.
 */
export type TradeFacetsPayload = {
  season: string;
  managers: TradeFacet[];
  players: TradeFacet[];
  picks: TradeFacet[];
  /** Names for the ids above, for the ones the page's own maps may not hold. */
  names: {
    players: Record<string, PlayerSummary>;
    managers: Record<string, LeaguematePayload>;
  };
};

/** A future pick as a roster held it before a trade. */
export type TradeRosterPickPayload = {
  season: string;
  round: number;
  /**
   * The roster the pick *originally* belongs to, which is what names it — the
   * same spelling {@link TradePickAsset} uses, so a held pick and a traded one
   * read alike.
   */
  roster_id: number;
  /**
   * The manager holding that origin roster, resolved server-side for the reason
   * {@link TradePickAsset.user_id} is: a portfolio holds picks from rosters that
   * are nowhere in the trade, and a client seeing only the sides could never name
   * them. Null on an uncached or orphaned roster.
   */
  user_id: string | null;
};

/** What one participating roster held immediately before a trade. */
export type TradeRosterPayload = {
  roster_id: number;
  /** Player ids held then, as stored — the client groups them for display. */
  players: string[];
  picks: TradeRosterPickPayload[];
};

/**
 * `GET /api/trades/rosters?trade=<id>` — what each side of one trade held
 * immediately before it.
 *
 * **Its own route, fetched on a press, rather than a field on
 * {@link TradesPagePayload}.** A card states what moved; this states what it
 * moved *off*, which is the question a card cannot answer at any height — three
 * receivers for a first reads one way off a team that had eight and another off a
 * team that had three. But a pre-trade roster is 25–50 player ids per side, so a
 * page of two hundred trades would carry ~16,000 of them plus the names for a
 * vocabulary the board otherwise never mentions: several hundred KB on every
 * page, for a disclosure most readers never open on most cards. The board's whole
 * design is that a reader downloads the trades they are looking at, and this is
 * the same rule one level down — see the split-at-the-press habit the ADP drawer
 * and the columns editor already follow.
 *
 * **An absent snapshot is `rosters: []`, and it is not an error.** The walk
 * behind these skips an undated trade outright (there is no honest moment to
 * rewind to), and a league the crawler has not visited since the table existed
 * has none yet. Absent reads as "not known", never as "held nothing" — the card
 * says so rather than drawing an empty roster.
 *
 * Two limits ride on the reconstruction itself and are worth knowing before
 * trusting one, since neither is visible in the payload: a draft is not a
 * transaction, so a snapshot reaching back across a rookie draft over-reports
 * that class; and the pick horizon is today's, so a pick in a season already
 * drafted is absent unless a reversed trade names it. See `shared/trades/rewind`.
 */
export type TradeRostersPayload = {
  transaction_id: string;
  /**
   * One entry per participating roster with a snapshot stored, in roster-id
   * order — the order {@link Trade.sides} is in, so a card can pair them up
   * without sorting either.
   */
  rosters: TradeRosterPayload[];
  /** Player ids → name/position/team, for everyone named above. */
  players: Record<string, PlayerSummary>;
  /** User ids → display name and avatar, for the pick origins named above. */
  managers: Record<string, LeaguematePayload>;
};

/**
 * One move in a league, as the sheet's timeline replays and labels it.
 *
 * **The blobs travel in Sleeper's own spelling**, which is what lets the browser
 * hand an event straight to `rewindRosters` — the reversal is one function, and
 * a normalised wire shape would mean a second reading of the same three columns
 * on this side of the wire. `adds` and `drops` are player id → roster id, and
 * `draft_picks` carries the origin plus both ends of the move, because that is
 * what undoing one needs.
 */
export type TradeTimelineEventPayload = {
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
  draft_picks: TradeTimelinePickPayload[];
};

/** A pick as one move handed it over. */
export type TradeTimelinePickPayload = {
  season: string;
  round: number;
  /** The roster the pick originally belongs to — Sleeper's own `roster_id`. */
  roster_id: number;
  /** Who took it, and who sent it. Null where Sleeper named neither. */
  owner_id: number | null;
  previous_owner_id: number | null;
};

/** One roster as it stands now — the state the replay rewinds from. */
export type TradeTimelineRosterPayload = {
  roster_id: number;
  /** Who holds it, for naming the block. Null on an orphaned roster. */
  user_id: string | null;
  players: string[];
  /**
   * The future picks it holds, named by the roster each originally belongs to.
   *
   * **No holder resolved onto the pick**, which is where this parts company with
   * {@link TradeRosterPickPayload}: that one carries a `user_id` because the card
   * it fed knew only the trade's own sides, and a portfolio holds picks from
   * rosters nowhere near the trade. This payload carries *every* roster in the
   * league, so the origin's holder is a lookup the client can already do — and
   * one it has to do anyway, since a rewound roster's picks are computed here
   * rather than sent.
   */
  picks: TradeTimelineHeldPickPayload[];
};

/** A future pick as a roster holds it, named by where it came from. */
export type TradeTimelineHeldPickPayload = {
  season: string;
  round: number;
  /** The roster the pick originally belongs to — Sleeper's own `roster_id`. */
  roster_id: number;
};

/**
 * `GET /api/trades/timeline?trade=<id>` — everything needed to read a league's
 * rosters at any moment between one trade and today.
 *
 * **The log crosses the wire, not the answer**, which is the whole design. A stop
 * on the rail is the current rosters with everything since it reversed, and there
 * is a stop per move — so an answer per stop would be the league's rosters times
 * its transactions, where the log is the transactions alone and the reversal is
 * arithmetic a browser does thousands of times a second. One request buys every
 * stop, so scrubbing costs nothing.
 *
 * **It replaced a disclosure on the card, and is a strictly wider answer than the
 * one that lived there.** That block asked what the *participants* held *before*
 * the trade, off the stored `trade_rosters` snapshot; this answers what **any**
 * roster held at **any** point from the trade forward, of which "the sides,
 * before it" is the leftmost stop. What it costs is a derivation per request
 * rather than a row read — acceptable here for the reason `getTradeTimeline`
 * states: one league, on a press, in a modal.
 *
 * **An unanswerable trade is `null`, and the sheet draws no rail at all.** A
 * trade Sleeper filed with no timestamp has no moment to rewind to (the rule the
 * snapshot walk already keeps), and a league whose rosters are not stored has
 * nothing to rewind from. Neither is an error, and neither stops the sheet
 * showing the league as it stands.
 *
 * The reconstruction's own two limits ride along and are worth knowing before
 * trusting a stop: a draft is not a transaction, so a stop reaching back across a
 * rookie draft over-reports that class; and the pick horizon is today's, so a
 * pick in a season already drafted is absent unless a reversed trade names it.
 * See `shared/trades/rewind`.
 */
export type TradeTimelinePayload = {
  transaction_id: string;
  /**
   * The timeline itself, or null where this trade has none — see above.
   *
   * Nested rather than flattened into nullable fields so that "no timeline" is
   * one check rather than three that could disagree.
   */
  timeline: {
    league_id: string;
    /** When the trade completed, epoch milliseconds — the rail's oldest stop. */
    traded_at: number;
    /** Every roster in the league, in roster-id order. */
    rosters: TradeTimelineRosterPayload[];
    /**
     * The league's completed moves from the trade forward, **newest first**,
     * ending with the trade itself.
     *
     * Newest-first is the direction the reversal runs and the order the board is
     * read in; the rail turns it into a left-to-right run of stops.
     */
    events: TradeTimelineEventPayload[];
  } | null;
  /**
   * Player ids → name/position/team for everyone the timeline can name — every
   * current roster, plus everyone added or dropped in the window.
   *
   * The union rather than the current rosters alone, because a stop's whole point
   * is players who are no longer there: a roster read back to October holds people
   * the league has since dropped, and the panel's own player map knows nothing
   * about them.
   */
  players: Record<string, PlayerSummary>;
  /** User ids → display name and avatar, for the roster holders and pick origins. */
  managers: Record<string, LeaguematePayload>;
};

/**
 * The manager's place in one league across the metrics a league card ranks it
 * on. Each is independently nullable, because they don't all answer at the same
 * time: a league that has been drafted but not played has a projected rank and
 * no standings, and one nothing is projected in has the reverse.
 */
export type LeagueRankSet = {
  /** By record — wins, then points for as Sleeper breaks its own ties. */
  standing: LeagueRank | null;
  /** By points for. Carries the total, for saying what the rank is of. */
  points: (LeagueRank & { pointsFor: number }) | null;
  /** By projected points (`weekly_optimal_points`, this league's scoring). */
  proj: ProjectedRank | null;
  /**
   * By projected bench points (`weekly_bench_points`, this league's scoring) —
   * the depth a roster carries without playing, ranked highest-first so the
   * deepest bench is #1. Null on the same terms as `proj`: nothing left to
   * project, or every roster's bench prices at zero (an undrafted or shallow
   * league where no one is behind a starter). Carries the total, like `proj`.
   */
  proj_bench: ProjectedRank | null;
};

/**
 * `GET /api/user/[username]/ranks` — where the manager's roster sits in each of
 * their leagues, by record, by points for, by projected points, and by projected
 * bench.
 *
 * Several rankings rather than one because a card shows them side by side and two
 * of them (record, points for) cost nothing the rosters read wasn't already
 * fetching; only the projected ranks need the projections behind them, and the
 * starters and bench come out of one weekly solve. The KTC starter-value rank
 * travels with the sibling `ktc` route instead, since it is the one that already
 * has the prices.
 *
 * Read-only like the sibling `players` route: it ranks over the rosters and
 * projections the background work has stored, so a manager the leagues stream
 * has never run for gets `{}` rather than a sync of their own.
 */
export type ManagerRanksPayload = {
  season: string;
  /**
   * Weeks the projected totals cover, ascending — the horizon travels with the
   * number here as it does everywhere else. Empty when nothing remains to
   * project *or* when the projections read failed, in which case every `proj` is
   * null and the record and points ranks answer as usual — they are read off the
   * rosters and never depended on it. The two are not distinguished, the same
   * choice the KTC and ADP-value routes make for their own null `split`: what a
   * reader can act on is that there is no projection, not why.
   */
  weeks: number[];
  /**
   * League id → the manager's ranks there. A league is absent when none of the
   * three can be formed: the manager holds no roster in it, or its rosters
   * aren't cached; a league present with, say, a `standing` but a null `proj` is
   * one that's been played but has nothing left to project.
   */
  ranks: Record<string, LeagueRankSet>;
};

/**
 * The team on the other side of a matchup, as sent to the client — the database
 * stores an avatar *id*, so the route resolves it and drops the raw id, exactly
 * as {@link LeaguematePayload} does.
 *
 * Both names travel, because the reader picks: a list spanning a manager's whole
 * portfolio labels an opponent by their Sleeper username, so the same person
 * reads as the same person in every league they turn up in, and the team name is
 * the nickname behind it.
 */
export type MatchupOpponentPayload = {
  roster_id: number;
  /** Null for an orphan team — one nobody currently holds. */
  user_id: string | null;
  display_name: string | null;
  team_name: string | null;
  avatar_url: string | null;
};

/**
 * What a roster is starting this week against what it could be starting.
 *
 * The three travel together because two of them are only meaningful beside the
 * third: a gap of 12 points is a different report on a 90-point week than on a
 * 190-point one, and a reader who wants to know whether the gap is worth acting
 * on needs the totals it came out of.
 */
export type MatchupProjectionPayload = {
  /**
   * The best lineup still *reachable* from this roster, in the league's own
   * scoring — slots held by a player whose game has been played stay as they
   * are, the rest are solved. Part-way through a week that is a different
   * number from the best lineup outright, and it is the one worth sending: the
   * other names moves the platform will refuse.
   */
  optimal: number;
  /** What the lineup currently set projects for the same week. */
  current: number;
  /**
   * `optimal − current` — points the manager can still go and get by moving
   * somebody. Zero is a real answer and a good one: the lineup is already the
   * best one available.
   */
  points_left: number;
  /**
   * How many starters sit in a different seat than kickoff order wants —
   * earlier games belong in strict slots and later games in the flexes, so the
   * flexible seats stay open longest (see `shared/projections/kickoff-order`).
   *
   * Counted with `kickoffMoves` over the same `kickoff_order` the league
   * panel's week view marks player by player, so this badge and those marks
   * are one rule. Zero is a real answer — the lineup already locks
   * strict-seats-first — where null is no answer at all: a best-ball league,
   * or a week the schedule supplies no kickoff instants for.
   */
  kickoff_moves: number | null;
};

/** One league's matchup for the manager: their roster, and who it is playing. */
export type LeagueMatchupPayload = {
  roster_id: number;
  /**
   * Null where the league scheduled the manager nobody to play — a bye in an
   * odd-sized league, or a week with no matchup set. Distinct from the league
   * being absent from {@link ManagerMatchupsPayload.matchups} altogether, which
   * says the week has not been fetched for it.
   */
  opponent: MatchupOpponentPayload | null;
  /**
   * The manager's own lineup for the week, or null where the league can't be
   * projected — no slots or scoring on file, nothing stored for the week, or the
   * projections read failed outright. Null is "no answer" and never a zero, the
   * rule every projected number here keeps.
   */
  projection: MatchupProjectionPayload | null;
  /**
   * What the opponent's *current* lineup projects — the other half of a
   * projected result.
   *
   * Their current lineup rather than their best one, because the question this
   * answers is "am I winning this week as things stand", and crediting an
   * opponent with a lineup they have not set would answer a question nobody
   * asked. Null on a bye, and on the same terms {@link LeagueMatchupPayload.projection}
   * is.
   */
  opponent_projection: number | null;
};

/**
 * `GET /api/user/[username]/matchups` — who the manager plays this week in each
 * of their leagues, and what both sides project.
 *
 * Read-only like its siblings: it answers from the matchups the league crawler
 * has stored, so a league the crawler has not reached this week is simply absent
 * rather than fetched on demand.
 *
 * The projections ride on the same payload rather than on a route of their own
 * because they are the *same* question asked of the same rows: which week, whose
 * roster, and whose roster on the other side. Two routes would each resolve the
 * week and the rosters, and could disagree about them.
 *
 * The **week travels with the answer** because the caller cannot derive it: it is
 * read off stored game dates rather than a clock (see `getUpcomingWeek`), so a
 * season with nothing synced ahead of today answers `week: null` and no matchups
 * — which is a different thing from a week in which nobody has a game.
 */
export type ManagerMatchupsPayload = {
  season: string;
  week: number | null;
  /** League id → that league's matchup. Absent = the week isn't stored for it. */
  matchups: Record<string, LeagueMatchupPayload>;
};

/** One league's roster priced on KeepTradeCut, and how that value is split. */
export type LeagueKtcValue = KtcRosterValue & {
  /**
   * Which of KTC's two boards priced it: superflex where the league starts more
   * than one quarterback, 1QB otherwise. The same roster is worth materially
   * different totals on the two, so the board travels with the number instead of
   * being assumed by whoever reads it.
   */
  superflex: boolean;
};

/** A league's KTC value plus where its starter value ranks league-wide. */
export type LeagueKtcEntry = LeagueKtcValue & {
  /**
   * The manager's place among their leaguemates by starter KTC value — the
   * `split.starters` half, ranked across every team in the league.
   *
   * Null when the ranking can't be formed: the league can't be projected (so no
   * lineup to draw starters from), or every roster's starters price at zero
   * (an undrafted board). The card shows the rank where it exists and nothing
   * where it doesn't, the same way the projected rank does.
   */
  starters_rank: LeagueRank | null;
};

/**
 * `GET /api/user/[username]/ktc` — what the manager's own roster in each of
 * their leagues is worth on KeepTradeCut, and how much of that value is in a
 * starting lineup rather than behind one.
 *
 * Read-only like its `players` and `ranks` siblings under this prefix: it prices
 * the rosters the leagues stream has already written using the values the KTC
 * scrape has already stored, so a manager nobody has looked up comes back empty
 * rather than triggering a sync of their own.
 *
 * KTC publishes *dynasty* values and this app scrapes only that board, so the
 * numbers describe a keeper asset rather than a season's usefulness — they are
 * the wrong lens on a redraft league, and anything showing them should say
 * "dynasty" rather than leave it to be inferred.
 */
export type ManagerKtcPayload = {
  season: string;
  /**
   * When the KTC rows behind every number here were scraped, ISO 8601 — null
   * when nothing on these rosters is priced. A fifteen-minute cache of someone
   * else's numbers, so a client showing them should be able to say how old they
   * are, as `/api/projections` does.
   */
  updated_at: string | null;
  /**
   * Weeks the lineup behind every `split` was ranked over, ascending. Empty when
   * nothing remains to project, in which case every `split` is null and only the
   * totals are answerable.
   */
  weeks: number[];
  /**
   * League id → that roster's value and its starter-value rank. A league is
   * absent when the manager holds no roster in it; a league whose roster KTC
   * prices nothing is present with a zero total and `priced: 0`, which is a real
   * answer rather than a gap — a pre-draft roster is empty and a roster of
   * kickers is off the board.
   */
  leagues: Record<string, LeagueKtcEntry>;
};

/**
 * One league's roster priced on **one** league-type board, and how it splits.
 *
 * `rostered` is not here: how many players a roster holds is a fact about the
 * roster, not about the board reading it, and two copies of it are one edit away
 * from disagreeing. `priced` is per board and genuinely differs — a rookie is on
 * the dynasty board and absent from the redraft one — which is the whole reason
 * this is a shape rather than a number.
 */
export type LeagueAdpBoardValue = Omit<AdpRosterValue, "rostered"> & {
  /**
   * How many crawled drafts stood behind this board — this side of the fetch,
   * not both. Shipped with the number the way `/api/adp` reports what it
   * averaged: a thin board is a noisy one, and a board of zero is why a roster
   * can come back unpriced.
   */
  draft_count: number;
  /**
   * The manager's place among their leaguemates by starter ADP value *on this
   * board* — the `split.starters` half, ranked across every team. Null on the
   * same terms as the KTC rank: no lineup to draw starters from, or every roster
   * prices at zero (a board with no matching drafts, or a pre-draft league).
   */
  starters_rank: LeagueRank | null;
};

/**
 * A league's roster priced on both league-type boards, side by side.
 *
 * It used to carry one reading — whichever board matched the league's own type —
 * and that made a column of these incomparable down a list holding both kinds of
 * league: 38,400 in a dynasty league and 38,400 in a redraft one are two markets'
 * numbers under one heading. So the payload answers both and the *column* chooses,
 * exactly as `/api/adp` does for a player row.
 *
 * Both sides are real readings of any roster, which is why neither is an em dash
 * outside its own league type: a dynasty roster's redraft value is what a win-now
 * market would pay for the same players, and the gap between the two is the
 * clearest thing on the card about whether a team is built to win now or later.
 */
export type LeagueAdpEntry = {
  /**
   * Which ADP board priced it: superflex where the league starts more than one
   * quarterback, 1QB otherwise. A quarterback goes far earlier in superflex
   * drafts, so the same roster is worth a different total on the two — the board
   * travels with the number rather than being assumed by whoever reads it, the
   * same rule the KTC value follows. It applies to both readings below, since it
   * is a fact about the league's lineup rather than about either market.
   */
  superflex: boolean;
  /**
   * The market this league actually plays in — dynasty for Sleeper `settings.type`
   * 2, redraft for everything else, keeper included. Neither reading is gated on
   * it; it is what tells a reader which of the two columns is their league's
   * native answer and which is the comparison.
   */
  board: AdpBoardType;
  /** Distinct players held, valued or not — the same roster on either board. */
  rostered: number;
  /** This roster read off the redraft board's crawled drafts. */
  redraft: LeagueAdpBoardValue;
  /** The same roster read off the dynasty board's. */
  dynasty: LeagueAdpBoardValue;
};

/**
 * `GET /api/user/[username]/adp-value` — what the manager's roster in each league
 * is worth valued off crawled ADP, and where its starter value ranks.
 *
 * A third team-value lens beside `ktc` and the projected `ranks`: KTC is a
 * *dynasty* board and projections are a points model, where this reads the
 * *market consensus* of the drafts this app has actually crawled, priced against
 * the boards most like each league. Read-only over synced rosters and crawled
 * draft picks, like its siblings under this prefix.
 */
export type ManagerAdpValuePayload = {
  season: string;
  /**
   * Weeks the lineup behind every `split` was ranked over, ascending. Empty when
   * nothing remains to project, in which case every `split` is null and only the
   * totals answer.
   */
  weeks: number[];
  /**
   * League id → that roster priced on both league-type boards. Absent for a
   * league the manager holds no roster in; present with a zero total and
   * `priced: 0` on a board no rostered player appears on — a real, empty answer
   * rather than a gap, and the usual one for the board the league doesn't play in
   * when the drawer's window holds only the other market's drafts.
   */
  leagues: Record<string, LeagueAdpEntry>;
};

/**
 * One newline-delimited JSON message on the
 * `GET /api/user/[username]/leagues` stream. Discriminated by `type`.
 */
export type LeaguesStreamMessage =
  | LeaguesResultMessage
  | LeaguesProgressMessage
  | LeaguesErrorMessage;

/**
 * One player's ADP row, averaged per league-type board. Unlike the roster
 * payloads, the player is resolved inline rather than through a side map — each
 * player appears exactly once here, so there is nothing to deduplicate. `name`
 * falls back to the player id when the players cache doesn't know the id.
 *
 * A board that took the player in fewer than `min_picks` drafts is null — no
 * average worth trusting, which is a different answer from a bad one. At least
 * one board is always present, and there is no server-assigned rank: the rows
 * arrive ordered by the best average on either board (so a page cut keeps
 * whoever is early on either market), and the client numbers them for whichever
 * board(s) it displays.
 */
export type AdpPlayerPayload = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  /**
   * Whether he is in his first NFL season — Sleeper's `years_exp` of 0.
   *
   * It travels because ranking the rookies on a board *is* the rookie-pick
   * ladder: the first rookie off it is the 1.01, the second the 1.02, and so on,
   * which is what lets the trades board price a traded pick on the same scale as
   * a traded player. Sent per row rather than as a side list because the ladder
   * is a reading of these rows and nothing else — a rookie the board didn't
   * average is not a rung.
   *
   * The players cache carries no history, so this always names the class that is
   * a rookie *now*: a board for a past season simply contains none of them, and
   * the ladder there is empty rather than wrong.
   */
  rookie: boolean;
  /** His average over the redraft board's drafts (redraft + keeper leagues). */
  redraft: AdpBoardStats | null;
  /** His average over the dynasty board's drafts. */
  dynasty: AdpBoardStats | null;
};

/**
 * `GET /api/adp` — ADP over the crawled drafts matching the query, averaged
 * separately for the redraft and dynasty boards. The league type stopped being
 * a filter: one fetch answers both markets, and the display chooses.
 */
export type AdpPayload = {
  /** The filters actually applied, defaults included. */
  filters: AdpFilters;
  /** Drafts the filters matched, across both boards. */
  draft_count: number;
  /** How `draft_count` splits into the two boards; the halves sum to it. */
  redraft_drafts: number;
  dynasty_drafts: number;
  /** Players in the full filtered set; 0 when the requested page is past its end. */
  player_count: number;
  players: AdpPlayerPayload[];
  /**
   * KTC's **rookie-pick** rows, whole — keyed by {@link ktcPickKey}, a season, a
   * round and a third of that round.
   *
   * The board lists draft picks beside the players, and a pick is priced off the
   * rookie it returns — which is a reading of {@link AdpPlayerPayload.rookie} and
   * needs nothing from KTC. What ADP genuinely cannot answer is what *waiting*
   * costs: the class a 2028 first will spend is not a class anybody can name, so
   * a pick that far out has no rung to stand on. KTC publishes exactly that
   * opinion one row per season, and the *ratio* between two of its rows carries
   * it onto the ADP scale — a ratio being dimensionless is what makes this one
   * crossing between the two boards sound where a sum would not be.
   *
   * **Whole rather than narrowed**, for the reason `/api/trades` sends it whole:
   * the ratio's anchor is the *nearest season KTC still prices*, which is a fact
   * about the board rather than about any pick, and which seasons those are moves
   * through the year. It is also what says which seasons and rounds there are
   * picks worth listing for at all. A few dozen rows.
   *
   * Empty where KTC is unsynced or its names stopped parsing, which reads as
   * future picks being absent from the board rather than as picks priced off the
   * wrong season.
   */
  pick_ktc: Record<string, KtcValue>;
};

/**
 * `GET /api/adp/density` — crawled drafts per calendar month, for the strip the
 * board's date range is chosen against.
 *
 * A separate route from `/api/adp` rather than a field on it, because it answers
 * a question the board's filters must not touch: the histogram has to hold still
 * while a window is dragged across it. Sending it with the board would tie the
 * two together and refetch a whole shape every time one chip moves.
 */
export type AdpDensityPayload = {
  /** Ascending by month; months with no crawled drafts are absent, not zero. */
  months: DraftDensityMonth[];
};

/**
 * `GET /api/adp/leagues` — every league with a draft the board could average,
 * for one season.
 *
 * **The league rules' input, and the only reason this crosses the wire.** The
 * board's filters are the shared league-filters dialog — what a league starts,
 * what its scoring pays, how big it is — and that is a rule engine over
 * Sleeper's JSONB blobs which cannot be re-implemented in SQL without drifting
 * invisibly. So the browser evaluates them over this list and sends back ids,
 * exactly as {@link TradeLeaguesPayload} lets the trades board do; the dialog's
 * per-option counts and its breakdown rows are read off the same list, which is
 * what makes them describe the corpus a reader is actually cutting.
 *
 * A route of its own rather than a field on the board: it is asked for when the
 * dialog opens or when a rule is set, where the board is asked for on every
 * filter change, and it is much the larger of the two.
 */
export type AdpLeaguesPayload = {
  /** The season these leagues drafted in, or `"all"` for every season on file. */
  season: string;
  leagues: ManagerLeague[];
};

/**
 * One player's projection for a week. The player is resolved inline, as in
 * `AdpPlayerPayload` — a player appears once per week, so there is nothing a side
 * map would deduplicate.
 *
 * `team` comes from the projection rather than the players cache: they disagree
 * after a trade, and the one that matters is who the player was projected as
 * playing for that week.
 */
export type ProjectionPlayerPayload = {
  /** Position in the full filtered set, 1-based — not within the page. */
  rank: number;
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  opponent: string | null;
  /** `YYYY-MM-DD` of the game. */
  game_date: string | null;
  /** Projected points in the requested scoring; null when Sleeper published none. */
  points: number | null;
  /** The full projected stat line, only when `?stats=1` was asked for. */
  stats?: Record<string, number>;
};

/** `GET /api/projections` — a week of stored projections, ranked. */
export type ProjectionsPayload = {
  /** The filters actually applied, with `week` resolved if it was left out. */
  filters: ProjectionFilters;
  /**
   * When these rows were last written, ISO 8601 — null when the week has none.
   * This is a cache of Sleeper's numbers, so a client showing them should say how
   * old they are.
   */
  updated_at: string | null;
  /** Players in the full filtered set; 0 when the page is past its end. */
  player_count: number;
  players: ProjectionPlayerPayload[];
};

/**
 * One placeholder pick as sent to the client: the pick tracker's kicker pick,
 * with the picking manager's avatar *id* resolved to a URL (as in
 * `LeagueTeamPayload`) and the raw id dropped.
 */
export type PicktrackerPickPayload = Omit<PlaceholderPick, "picked_by"> & {
  picked_by:
    | (Omit<NonNullable<PlaceholderPick["picked_by"]>, "avatar"> & {
        avatar_url: string | null;
      })
    | null;
};

/** `GET /api/picktracker/[leagueId]` — a league's placeholder draft, live. */
export type PicktrackerPayload = {
  league: {
    league_id: string;
    name: string;
    avatar_url: string | null;
  };
  draft_status: string;
  /** Teams per round — what the round.slot labels are numbered against. */
  teams: number;
  picks: PicktrackerPickPayload[];
  /** The placeholder now on the clock; null once the draft is complete. */
  next_pick: string | null;
};

/**
 * What `/api/projections/sync` answers with. The sync routes have no client
 * reader today (they exist for operators and cron), but their payloads live
 * here with everyone else's — a payload declared beside its route is exactly
 * the drift this module exists to stop.
 */
export type ProjectionsSyncPayload = ProjectionsSyncSummary;

/** What `/api/players/sync` answers with — see {@link ProjectionsSyncPayload}. */
export type PlayersSyncPayload = PlayersSyncSummary;

/** What `/api/stats/sync` answers with — see {@link ProjectionsSyncPayload}. */
export type StatsSyncPayload = StatsSyncSummary;

/**
 * `GET /api/kickoff?season=YYYY` — when the season's first regular-season game
 * kicks off, per Sleeper's schedule call.
 *
 * `kickoff` is epoch ms, and null is a real answer, not a failure: Sleeper
 * hasn't scheduled the season (or has scheduled it only to the day), so there
 * is no instant to count down to. The client falls back to the NFL calendar
 * table's provisional date in that case — the same claim the ADP window's
 * draft anchor makes — rather than the server inventing an hour.
 */
export type KickoffPayload = {
  season: string;
  kickoff: number | null;
};

/** The error body every league API route returns on a non-2xx. */
export type ApiErrorPayload = { error: string };

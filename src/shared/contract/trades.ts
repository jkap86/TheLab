/**
 * The trades board's wire types.
 *
 * **The domain types live here rather than in `shared/trades`**, which inverts
 * TheLabX's direction (it declares `Trade` beside the assembler and the contract
 * imports it). The rule this folder is built on is that a `"use client"` module
 * must be able to name a payload without pulling a database client into the
 * browser, and a trade is named on both sides of that seam — the assembler
 * builds one, the card renders one. So the shape is declared here, with zero
 * runtime imports, and `shared/trades` imports it back with `import type`.
 */

import type { ManagerLeague } from "./leagues";
// Moved to `names.ts` when the shares drawers became their second reader.
// Re-exported so this module stays a complete surface for a trades caller.
import type { LeaguematePayload, PlayerSummary } from "./names";

export type { LeaguematePayload, PlayerSummary };

/** A future draft pick as it moves in a trade. */
export type TradePickAsset = {
  /** The draft's season, e.g. `"2026"`. Sleeper sends it as a string. */
  season: string;
  round: number;
  /**
   * The roster the pick *originally* belongs to, which is what names it: a 2026
   * 1st is a different asset depending on whose it is. Not who is trading it —
   * a pick can change hands several times before it is used.
   */
  roster_id: number;
  /**
   * The manager holding that roster, so a card can name the pick's origin as a
   * person rather than as a roster number.
   *
   * **It is resolved by the assembler rather than by the reader**, because a
   * pick can come from a roster that isn't in the trade at all — the
   * interesting case, since a third party's first is exactly the pick worth
   * naming an owner for — and the trade itself names only its participants. The
   * assembler holds the whole league's roster→owner map, so this costs nothing;
   * a client left to work it out could only ever resolve the sides. Null on an
   * uncached or orphaned roster, the same rule {@link TradeSide.user_id}
   * follows.
   */
  user_id: string | null;
};

/** One roster's half of a trade: what it came away with. */
export type TradeSide = {
  roster_id: number;
  /**
   * The manager holding that roster, or null where the league's rosters aren't
   * stored or the team is orphaned. A trade with a null side is still a real
   * trade, so it is kept rather than dropped.
   */
  user_id: string | null;
  /** Player ids received. */
  players: string[];
  picks: TradePickAsset[];
  /** FAAB received, in the league's own units; 0 where none moved. */
  faab: number;
};

/**
 * A completed trade, read back out of the `transactions` table the league sync
 * mirrors Sleeper into.
 *
 * Sleeper describes a trade as a flat set of maps — `adds` is player → roster,
 * `draft_picks` carries its own owners, `waiver_budget` its own sender and
 * receiver — with no notion of "sides". A reader thinks in sides, so
 * `assembleTrade` turns those maps into one entry per participating roster,
 * holding what that roster *received*. Everything given up is what the other
 * sides received, so it is never stored twice.
 */
export type Trade = {
  transaction_id: string;
  league_id: string;
  /** The scoring week Sleeper filed the trade under; null in the offseason. */
  week: number | null;
  /**
   * When the trade completed, epoch milliseconds — `status_updated` where
   * Sleeper sent one, else `created`. The two differ for a trade that sat
   * pending review, and the date a reader is looking for is when it went
   * through, not when it was offered.
   */
  completed_at: number | null;
  /**
   * One entry per participating roster, in roster-id order. Two for nearly
   * every trade, more for the three-way ones some leagues run.
   */
  sides: TradeSide[];
};

/**
 * `GET /api/trades` — one page of the trades board, newest first.
 *
 * Not a manager route, and that is the shape of it: the trades worth reading
 * are the market's, not one account's, so this reads every league this database
 * has stored rather than the leagues someone plays in. An account, when there
 * is one, buys the *circle* — a narrowing — rather than the question.
 *
 * Three things are worth stating about where the filtering happens, because the
 * split is the design:
 *
 * - **The trade filters are SQL.** Season, window, players, picks, managers and
 *   the match mode are query parameters (`shared/trades/params`), so a narrowed
 *   board is narrowed by the database and the reader downloads matches rather
 *   than candidates.
 * - **The league rules stay on the client**, because they are the slot-group
 *   and scoring-key engine `features/shared/league-filters` already owns and a
 *   second copy in SQL would drift invisibly — the symptom being a filter
 *   quietly returning the wrong leagues rather than an error.
 *   {@link TradeLeaguesPayload} hands the page every league of the season once;
 *   it evaluates the rules and sends back ids.
 * - **The filter menus are their own route.** {@link TradeFacetsPayload} is the
 *   option lists and their counts over the same population, asked for only when
 *   the search panel is open.
 *
 * A trade names ids and the maps beside it resolve them; the client merges each
 * page's maps into what it already holds rather than replacing them. A page is
 * self-contained — it re-sends the names its own players share with earlier
 * pages, which is bounded by the page size rather than by the season, where the
 * alternative (the client listing every id it holds) is a 414 waiting for the
 * reader who scrolls furthest.
 *
 * Read-only over what the manager syncs stored: a league nobody has looked up
 * has no transactions here rather than being fetched on demand.
 */
export type TradesPagePayload = {
  season: string;
  /** Newest first, continuing after the cursor the request carried. */
  trades: Trade[];
  /**
   * The token for the next page, or null at the end of the board.
   *
   * Opaque, and null is the *only* end-of-board signal — a page shorter than
   * the limit is one too, but a page that happened to end exactly on the limit
   * is not, so the two are collapsed into this one field rather than left to
   * the client to infer from a length.
   */
  nextCursor: string | null;
  /**
   * How many trades match this query in full, or null when it wasn't counted.
   *
   * **Counted on a first page and never on a later one**, which is what keeps
   * pagination cheap: a count is a scan of the population, and a scan per page
   * would be one per scroll. The client carries the first page's answer across
   * the rest of the set.
   */
  total: number | null;
  /**
   * How many trades the **league filters alone** leave, or null when it wasn't
   * counted (a later page, or a query where it equals `total`).
   *
   * This is the `M` in the page's "N of M trades": the league filters say which
   * leagues' trades are on the board at all, and the trade filters say which of
   * those are worth looking at. Two numbers because they are two questions, the
   * same distinction the two dialogs draw.
   */
  scopeTotal: number | null;
  /** Player ids → name/position/team, for every player this page names. */
  players: Record<string, PlayerSummary>;
  /**
   * User ids → display name and avatar. A side naming a user id that never
   * arrives is one whose member row isn't stored; the client falls back to the
   * roster number.
   */
  managers: Record<string, LeaguematePayload>;
  /**
   * Where a traded pick falls, for the picks on this page whose league has set
   * the order — keyed by `pickSlotKey`, so a card names a pick the way Sleeper
   * does ("2026 1.05") where the order is known and by its round ("2026 1st")
   * where it isn't.
   *
   * **Absent means unordered**, never zero: most picks on a board are two or
   * three seasons out, and a draft that doesn't exist yet has no slots to give.
   * It rides beside the trades rather than on each pick because a slot is a
   * fact about a league's draft — one entry serves every trade naming that
   * roster's pick, of which a busy league has many.
   */
  pickSlots: Record<string, number>;
  /**
   * What KeepTradeCut prices each asset on this page at, on **both** of its
   * markets — keyed by `assetKey`, which is league-scoped for the reason
   * `pickSlotKey` is: one league's 2027 first is not another's.
   *
   * **Both markets ship and the client picks between them**, which is the one
   * place the reader's board choice does not ride the request, and the
   * difference from `/api/user/[username]/lineups` is what the number is *for*.
   * There it is ranked, so the choice has to be resolved before a rank can
   * exist. Here it is only printed — so sending it would reset a scrolled
   * keyset walk to page one to change a display unit, which is the documented
   * cost of this board having no `keepPreviousData`.
   *
   * The **superflex** axis is still resolved server-side, because that is a
   * fact about the league rather than a reader's choice: a two-QB league reads
   * a different column, and which one is not something anybody chooses.
   *
   * An asset KTC cannot price is **absent**, and an asset it prices on one
   * market and not the other carries a null on that side — a kicker is on the
   * redraft board and nowhere near the dynasty one. Neither is a zero. FAAB is
   * never here at all: it is a league's own currency and no market prices it.
   */
  assetValues: Record<string, { dynasty: number | null; redraft: number | null }>;
};

/**
 * `GET /api/trades/leagues` — every league with a trade on a season's board.
 *
 * The league filters' whole input. A separate route rather than a field on the
 * page above because it is asked for **once per season** and the pages are
 * asked for many times: bundling it would re-send a few hundred leagues' worth
 * of `settings`, `roster_positions` and `scoring_settings` blobs with every
 * scroll. Separated, it is one request the client holds for the session, and it
 * serves three readers at once — the filter dialog's option counts, the ids the
 * trades query is narrowed by, and the name every card puts on its league.
 *
 * Restricted to leagues that actually traded, so the dialog's counts describe
 * the board rather than the database.
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
 * `GET /api/trades/facets` — the search panel's three menus, and how many
 * trades each option would leave.
 *
 * **The menus are read off the trades**, not from a fixed list: a fixed list
 * would offer players nobody traded while hiding the one someone wants, so the
 * options are whatever the season actually moved.
 *
 * The counts are over the population narrowed by everything **except the
 * selection itself** — the league filters and the window, not the picked
 * players — because a menu counted over its own selection collapses to that
 * selection the moment you make one and can't be widened without being cleared
 * first. `facetsQuery` in `shared/trades/params` is where that stripping lives,
 * so the route cannot forget it.
 *
 * **Which is why the board's own total is not here.** It is counted *with* the
 * selection, so it changes on every press, while nothing in this payload does;
 * the narrowed total arrives on the first page of {@link TradesPagePayload}
 * instead, and this is fetched once per league scope and window.
 *
 * **The values are ids and the labels are not here**, with one exception: a
 * pick's label is a pure formatting of its own token (`"2026-1"` → `"2026
 * 1st"`) and the client owns that function, so sending it would be sending a
 * string derivable from the one beside it. Player and manager labels are rows
 * in other tables, so those arrive in `names` — the same shape and the same
 * merge as a page's own maps. A facet can name a player no loaded page does,
 * which is exactly why they travel together.
 */
export type TradeFacetsPayload = {
  season: string;
  managers: TradeFacet[];
  players: TradeFacet[];
  picks: TradeFacet[];
  /** Names for the ids above, which the page's own maps may not hold. */
  names: {
    players: Record<string, PlayerSummary>;
    managers: Record<string, LeaguematePayload>;
  };
};

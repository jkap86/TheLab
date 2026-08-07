"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  HeaderSlot,
  LeagueFiltersPlaceholder,
  activeFilterCount,
  adpNarrowingCount,
  adpQueryString,
  rookieOrderingBoard,
  startupPricingBoard,
  todayIso,
  useAdp,
  useAdpControls,
  useAdpDensity,
  useStoredAccount,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import { AdpTrigger } from "@/features/shared/ui/adp-trigger";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { focusRosterFor } from "../exchange";
import { DEFAULT_TRADE_FILTERS, hasSideSelection, tradeRangeBounds } from "../filters";
import type { TradeFilters, TradeNames } from "../filters";
import { useFilteredTrades } from "../hooks/use-filtered-trades";
import { useTradeLeagues } from "../hooks/use-trade-leagues";
import { useTrades } from "../hooks/use-trades";
import type { Verdict } from "../incremental";
import { rookieLadder } from "../pick-value";
import { DEFAULT_TRADE_COLUMNS, TRADE_METRICS } from "../trade-metrics";
import { resolveLeagueScope, tradeQueryKey } from "../trade-query";
import type { AdpPlayerPayload, Trade } from "../types";
import type { OpenLeague } from "./league-sheet";
import { TradeFiltersLedge } from "./trade-filters-ledge";
import { TradeSearch } from "./trade-search";
import { TradeValuePicker } from "./trade-value";
import { TradesList } from "./trades-list";

/**
 * The league filters dialog, loaded on demand.
 *
 * It is not on screen at first paint — a trigger and a `<dialog>` only ever
 * shown by a press — and it is the largest client module this page pulls: ~970
 * lines with the whole slot-group and scoring-rule editor, its option tables and
 * its breakdown counts behind it. Statically imported, all of that was parsed
 * and evaluated before the first card could be drawn. The trade filters are
 * split the same way one layer in, at the ledge's panel rather than here, since
 * the ledge's own trigger and summary are not behind a press.
 *
 * `ssr: false` because there is nothing to prerender: a `<dialog>` that opens on
 * a press has no server-rendered state worth having, and rendering it would put
 * the markup back in the document that the split is removing.
 *
 * The trigger *is* the component, so the fallback is what holds its place in the
 * ledge's row while the chunk loads — a plain pill of the same size, so the row
 * doesn't reflow when it arrives (which would move the list under it and make
 * the virtualizer re-measure its own offset).
 */
const LeagueFiltersModal = dynamic(
  () =>
    import("@/features/shared/ui/league-filters-modal").then(
      (m) => m.LeagueFiltersModal,
    ),
  // "Leagues" is the trigger's own word — the placeholder is standing in for its
  // box, so it has to wear the same label or the row is a different width for
  // the moment the chunk is loading.
  { ssr: false, loading: () => <LeagueFiltersPlaceholder label="Leagues" /> },
);

/**
 * The ADP board, loaded the first time it is opened — the manager tool's own
 * split (`LeaguesViewLayout`), reused here now that this page reads the same
 * board. The **trigger** stays statically imported (it's in the app bar at
 * first paint and it's small); the drawer behind it — the pinned filter
 * block, the value-curve slider, the NFL-calendar layer, the lookback
 * counter and its density channel — is not on screen until pressed.
 */
const AdpDrawer = dynamic(
  () => import("@/features/shared/ui/adp-drawer").then((m) => m.AdpDrawer),
  { ssr: false },
);

/**
 * The league a card opens into, loaded the first time one is pressed.
 *
 * The heaviest thing on this page behind a press: the sheet pulls in the whole
 * `ui/league-detail` subtree — two dense tables, the rank dial, the draft-pick
 * list, two metric catalogues and a query hook — and none of it is on screen at
 * first paint. The seam is a module boundary rather than an export name, which is
 * what the split actually needs: the trigger is the card, three modules away, so
 * nothing static reaches this chunk. It is deliberately not re-exported from
 * `features/trades/index.ts` or from `features/shared`, since a barrel naming it
 * would put it back in the graph of every page importing anything from either.
 *
 * No `loading` fallback: nothing is holding its place on the page — the sheet is
 * a modal that appears where there was nothing — so a placeholder would be a
 * flash rather than a reserved box.
 */
const LeagueSheet = dynamic(
  () => import("./league-sheet").then((m) => m.LeagueSheet),
  { ssr: false },
);

/**
 * Every trade in every league this database has crawled, newest first, behind
 * two independent filter sets.
 *
 * The market rather than one account's corner of it: the leagues a reader plays
 * in are a fraction of the trades worth reading, and what a leaguemate — or a
 * stranger in a league shaped like theirs — gave up for a rookie first is the
 * question this page answers. Narrowing back to their own leagues is what the
 * circle filter does, so nothing is lost by opening the default.
 *
 * **The account is read here but never required, and the difference is what
 * keeps this the one tool the grid doesn't grey out.** A stored account buys the
 * circle — my leagues, my leaguemates' trades, my leaguemates' leagues — and
 * nothing else on the page changes without one: every other filter is a fact
 * about leagues or trades and asks nothing about who is reading. That is also
 * why the circle is the only narrowing sent *unresolved*: which leagues are
 * yours and who shares them is the database's answer, so the account id and the
 * word travel and `shared/trades/circle` turns them into ids.
 *
 * **It used to download the season and filter it here; it now asks for what it
 * is showing.** The old shape was honest about its constraint — the filter menus
 * were read off the trades, so the browser needed the unnarrowed season, so the
 * only lever was making ~20MB arrive progressively — and the constraint is what
 * moved. The filters are SQL, the menus are their own aggregate behind the
 * control that shows them, and what arrives here is a page of two hundred cards
 * with the next one following the scroll.
 *
 * **The page leads with its controls rather than with its name.** There was a
 * `Trades` heading and a scope line above all of this; the app bar already names
 * the tool, so the title said what was said a few pixels above it, and the scope
 * line said what the ledge's own summary now says beside the control that sets
 * it. What replaced ~96px of masthead is one line carrying the count, the
 * selection in words and every trigger on the page.
 *
 * Three things are arranged around keeping the page identical while the read
 * changed:
 *
 * - **The league rules still run here**, over `useTradeLeagues`'s list, because
 *   they read Sleeper's JSONB through the solver's own slot tables and a second
 *   implementation in SQL would drift silently. What crosses the wire is their
 *   *answer* — the league ids — so the narrowing is still the database's.
 * - **The headline still reads "N of M"**, with both numbers counted server-side
 *   over the two populations the two filter sets describe.
 * - **The residual pass stayed**, three-state now, for the window between the
 *   first page landing and the league list landing, and for the case where the
 *   id list is too long for a query string. Usually it judges nothing.
 */
export function TradesHome({ season }: { season: string }) {
  const [leagueFilters, setLeagueFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );
  const [tradeFilters, setTradeFilters] = useState<TradeFilters>(
    DEFAULT_TRADE_FILTERS,
  );

  // Everything laid out above the list, so the virtualizer can watch *this* for
  // the size changes that move the list down the page — rather than the body,
  // whose box the list's own growth changes on every measured card.
  const headerRef = useRef<HTMLDivElement>(null);

  // The cards' value column, chosen once for the whole list and remembered on
  // the device — the same mechanism the league and share lists use, at the grain
  // of one side of one trade. One slot rather than their four: a trade card is
  // already a table of the assets that make the number up.
  const { columns, setColumn, reset } = usePersistedColumns(
    "trade-side",
    DEFAULT_TRADE_COLUMNS,
    TRADE_METRICS,
  );
  const metric =
    TRADE_METRICS.find((m) => m.key === columns[0]) ?? TRADE_METRICS[0];

  const {
    leagues,
    byId: leaguesById,
    loading: leaguesLoading,
  } = useTradeLeagues(season);

  // The ADP board's own selection, seated in the app bar rather than beside
  // the trade filters below: it narrows the crawled *market*, not this
  // page's trades, the same split the manager tool draws between its league
  // filters and its board. `AdpControlsProvider` is mounted per-page around
  // `TradesHome` (see `app/trades/page.tsx`) rather than shared with the
  // manager tool's own store — a board chosen here describes a different
  // population (every crawled draft) than one seeded from a manager's own
  // leagues, and the two have no reason to share a selection.
  const {
    controls: adpControls,
    setControls: setAdpControls,
    resetControls: resetAdpControls,
    defaultSeason,
  } = useAdpControls();
  const [boardOpen, setBoardOpen] = useState(false);
  const [everOpenedBoard, setEverOpenedBoard] = useState(false);
  if (boardOpen && !everOpenedBoard) setEverOpenedBoard(true);
  const adpQuery = useMemo(
    () => adpQueryString(adpControls, todayIso()),
    [adpControls],
  );
  // The two boards a rookie *pick* is valued off, which are deliberately not
  // whichever one the panel is displaying — see `rookieOrderingBoard`. They are
  // the reader's own population with the round bounds fixed, so switching the
  // panel between "Startup" and "Rookie" changes what the *list* shows and
  // leaves every pick's value where it was.
  //
  // **This is one extra request, not two.** They are the same query string as
  // the displayed board wherever the rounds already match — which the default
  // (`Startup`) does — so React Query resolves the pricing board to the very
  // entry `adpQuery` is already fetching, and only the rookie-draft board is a
  // fetch of its own. No board is fetched per card, per trade or per pick: both
  // are read once into the ladders below.
  const rookieQuery = useMemo(
    () => adpQueryString(rookieOrderingBoard(adpControls), todayIso()),
    [adpControls],
  );
  const startupQuery = useMemo(
    () => adpQueryString(startupPricingBoard(adpControls), todayIso()),
    [adpControls],
  );
  // **Not gated on the drawer being open**, unlike the manager tool's Leagues
  // and Leaguemates tabs: the cards' value column reads this board, so it is on
  // screen either way — the same rule the Players tab follows for its own ADP
  // column. A closed drawer costs nothing extra, since both consumers share one
  // query key and one entry.
  const board = useAdp(adpQuery);
  const rookieBoard = useAdp(rookieQuery);
  const startupBoard = useAdp(startupQuery);
  const density = useAdpDensity(boardOpen);

  // The board by player id, which is how a card asks about one. Memoised on the
  // payload rather than rebuilt per render, because every windowed card takes it
  // as a prop and `TradeCard` is memoised on prop identity — a fresh object here
  // would re-render all ~26 of them at both ends of every scroll gesture.
  const adpByPlayer = useMemo(() => {
    const rows = board.data?.players;
    if (!rows) return EMPTY_MAP;
    const byId: Record<string, AdpPlayerPayload> = {};
    for (const row of rows) byId[row.player_id] = row;
    return byId;
  }, [board.data]);

  // The rookie-pick ladder: the class in the order the *rookie* drafts took
  // them, each rung carrying what the *startup* drafts pay for that player (see
  // `../pick-value`). Both markets, because a card reads the one its own league
  // plays in and this page spans leagues of both kinds; built once for the list
  // rather than per card, since it is a reading of two whole boards and not of
  // any one trade — which is also what keeps this off the per-card path.
  const adpLadders = useMemo(
    () => ({
      redraft: rookieLadder(
        rookieBoard.data?.players ?? [],
        startupBoard.data?.players ?? [],
        "redraft",
      ),
      dynasty: rookieLadder(
        rookieBoard.data?.players ?? [],
        startupBoard.data?.players ?? [],
        "dynasty",
      ),
    }),
    [rookieBoard.data, startupBoard.data],
  );

  // The one thing on this page that asks who is reading it, and it asks softly:
  // without an account the circle filter is inert and everything else is exactly
  // what it was. That is why the tools grid still lists this page as
  // `accountless` — an account buys a filter here, it doesn't unlock the tool.
  const account = useStoredAccount();

  // Resolved once per render rather than per trade, and against a date rather
  // than the clock, so the list only moves when the day does.
  const today = todayIso();
  const bounds = useMemo(
    () => tradeRangeBounds(tradeFilters.range, today),
    [tradeFilters.range, today],
  );

  const leagueFiltersActive = activeFilterCount(leagueFilters) > 0;
  const scope = useMemo(
    () => resolveLeagueScope(leagues, leagueFilters, leagueFiltersActive),
    [leagues, leagueFilters, leagueFiltersActive],
  );

  const request = useMemo(
    () => ({
      season,
      scope,
      filters: tradeFilters,
      bounds,
      user: account?.user_id ?? null,
    }),
    [season, scope, tradeFilters, bounds, account],
  );

  const { data, loading, loadingMore, stale, hasMore, loadMore, error } =
    useTrades(request);

  const trades = data?.trades ?? EMPTY_TRADES;

  /**
   * The residual verdict — see `../incremental` for why it has three answers.
   *
   * In the ordinary case there is nothing to decide: the server applied the
   * league narrowing, so every trade that came back is allowed. The two cases
   * that are left are the two the third state exists for — a page that arrived
   * before the league list did, and a league set too large to send as ids.
   */
  const judge = useCallback(
    (trade: { league_id: string }): Verdict => {
      if (scope.kind === "client") {
        return scope.allowed.has(trade.league_id) ? "allowed" : "denied";
      }
      // The server already narrowed, so nothing here can be denied — but while
      // the league list is still loading a card cannot be *named*, and the page
      // draws it either way (a league falls back to its id). Allowing it keeps
      // the first paint what it was under the stream.
      return "allowed";
    },
    [scope],
  );

  const { visible } = useFilteredTrades(
    trades,
    // Everything the verdict closes over except the leagues, which is its own
    // generation below — a change here throws the accumulated answer away, a
    // change there only revisits what was never decided.
    tradeQueryKey(request),
    leaguesLoading ? "loading" : `n${leagues.length}`,
    judge,
  );

  const total = data?.total ?? null;
  const scopeTotal = data?.scopeTotal ?? null;
  const players = data?.players ?? EMPTY_MAP;
  const managers = data?.managers ?? EMPTY_MAP;
  const ktc = data?.ktc ?? EMPTY_MAP;
  const pickKtc = data?.pickKtc ?? EMPTY_MAP;
  const pickSlots = data?.pickSlots ?? EMPTY_MAP;

  // How the scope line names what the bays hold. The page's own lookup maps are
  // the only names it has; a token for someone off the loaded pages falls back
  // to the id, which is the one true thing available and better than a count.
  const names: TradeNames = useMemo(
    () => ({
      player: (id) => players[id]?.name ?? id,
      manager: (id) => managers[id]?.display_name ?? id,
    }),
    [players, managers],
  );

  // Which league is open over the board, and whether the sheet is showing it.
  //
  // Two pieces of state rather than one, and the split is what the `dynamic()`
  // above is worth having: `openLeague` is kept past the close so the sheet is
  // not unmounted by its own dismissal and a second press is instant — the same
  // latch the ADP drawer keeps below. The panel *inside* it is still gated on
  // `sheetOpen`, so a closed sheet holds no read of its own.
  const [openLeague, setOpenLeague] = useState<OpenLeague | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // One callback for the whole list, so a card's props stay identical across the
  // re-renders the virtualizer triggers — see `TradeCardProps.onOpenLeague`. The
  // league's own name is read here rather than in the card, since the card is
  // given a `ManagerLeague | null` and this is where that map lives.
  const openLeagueFor = useCallback(
    (trade: Trade) => {
      const league = leaguesById.get(trade.league_id) ?? null;
      setOpenLeague({
        leagueId: trade.league_id,
        name: league?.name ?? trade.league_id,
        // Their own roster where they are in the trade, a participant otherwise
        // — the panel's own default is the projected leader, which is the right
        // answer for a reader who arrived at a league and the wrong one for a
        // reader who arrived at a trade.
        rosterId: focusRosterFor(trade, account?.user_id ?? null),
      });
      setSheetOpen(true);
    },
    [leaguesById, account],
  );

  return (
    <>
      {/* The board's trigger, seated in the app bar rather than the ledge
          below — it narrows the crawled market, not this page's trades, the
          same split the manager tool draws (and the same seat: directly to
          the left of the Tools menu). Only its *box* moves; it is still a
          child of this page, reading the same store and driving the drawer
          rendered at the end of this fragment. */}
      <HeaderSlot>
        <AdpTrigger
          range={adpControls.range}
          season={adpControls.season}
          draftCount={board.data?.draft_count ?? null}
          narrowed={adpNarrowingCount(adpControls, defaultSeason)}
          onClick={() => setBoardOpen(true)}
        />
      </HeaderSlot>

      {/* Everything above the list, watched by the virtualizer — which is what
          makes the ledge safe to expand in place: opening it moves the board
          down, and the observer on this element is how the list is told. */}
      <div ref={headerRef}>
        {/* The page deliberately leads with its controls rather than a title —
            the app bar already names the tool, which is the whole argument for
            deleting the masthead. What that left was a document whose first
            heading was a trade card, so the name it dropped is kept where only
            a heading outline can see it. */}
        <h1 className="sr-only">Trades</h1>

        {/* The page's front door, above the settings that used to hide it. Two
            bays wearing the trade card's own side plate: things in the same bay
            were on the same side of the trade, so a manager and a player
            together means he received him and on opposite sides means he gave
            him. It leads because it is what a reader arrives wanting — the
            ledge below says where they are standing, which is chosen once. */}
        <TradeSearch
          filters={tradeFilters}
          onChange={setTradeFilters}
          season={season}
          scope={scope}
          account={account}
          bounds={bounds}
          players={players}
          managers={managers}
        />

        <TradeFiltersLedge
          filters={tradeFilters}
          onChange={setTradeFilters}
          leagueFilters={leagueFilters}
          season={season}
          account={account}
          names={names}
          trailing={
            <>
              {/* The board's size, which is what the deleted heading's slot is
                  now spent on: a constant nobody re-reads, replaced by the one
                  number on the page that answers "did that filter do anything".
                  It leads the trailing group because the two triggers beside it
                  are what move it. */}
              <p
                // The number every filter on this page is pressed to move, and
                // the only feedback a press gives — the board itself is a
                // windowed list a reader may be nowhere near.
                role="status"
                className={`flex shrink-0 items-baseline gap-1.5 text-sm text-foreground/55 transition-opacity ${
                  // Dimmed while a narrowed board is on its way, so the number
                  // reads as the one being replaced rather than the answer to
                  // the filter just pressed. One small element rather than the
                  // list, which is the flash `keepPreviousData` exists to avoid.
                  stale ? "opacity-40" : ""
                }`}
              >
                {/* The body face, not `font-display`, which is the app's rule
                    for a number rather than a name — and load-bearing at this
                    one: Orbitron's zero is a slashed box, so a narrowing that
                    matches nothing rendered as a checkbox glyph beside the
                    word "of". */}
                <b className="text-lg font-semibold tabular-nums text-foreground">
                  {(total ?? visible.length).toLocaleString()}
                </b>
                <span className="text-xs">
                  {scopeTotal !== null && total !== null && scopeTotal !== total
                    ? `of ${scopeTotal.toLocaleString()} trades`
                    : "trades"}
                </span>
              </p>
              <TradeValuePicker
                metrics={TRADE_METRICS}
                metricKey={metric.key}
                onChange={(key) => setColumn(0, key)}
                onReset={reset}
              />
              <LeagueFiltersModal
                filters={leagueFilters}
                onChange={setLeagueFilters}
                leagues={leagues}
                label="Leagues"
              />
            </>
          }
        />

        {error && <Note tone="error">{error}</Note>}
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-foreground/60">
          {/* The flask already carries the `role="status"`, so the line under it
              is its label rather than a second announcement — `PanelLoading`'s
              own pairing. Left to the default the wait announced as "Loading"
              and the sentence saying what is being loaded was silent. */}
          <FlaskLoader label="Reading every league’s trades…" />
          <p aria-hidden="true" className="text-sm">
            Reading every league&rsquo;s trades…
          </p>
        </div>
      ) : visible.length === 0 ? (
        <Note>
          {tradeFilters.circle !== "all"
            ? // A circle is drawn out of *stored* leagues and membership, so an
              // account this database has never synced resolves to an empty one
              // — which is a different problem from a filter set that is merely
              // narrow, and the only one the reader can do something about.
              "No trades match these filters. A circle is drawn from the leagues this database has synced for your account — look it up on the tools page if it has never been read."
            : leagueFiltersActive || activeTradeSelection(tradeFilters)
              ? "No trades match these filters."
              : // Transactions arrive with the league syncs, so a season nothing
                // has been crawled for has none stored rather than none made.
                "No trades stored for this season yet. They arrive with the league syncs — look an account up on the tools page if this database is cold."}
        </Note>
      ) : (
        <>
          <TradesList
            trades={visible}
            leaguesById={leaguesById}
            players={players}
            managers={managers}
            metric={metric}
            ktc={ktc}
            pickKtc={pickKtc}
            adp={adpByPlayer}
            adpLadders={adpLadders}
            steepness={adpControls.steepness}
            pickSlots={pickSlots}
            headerRef={headerRef}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onOpenLeague={openLeagueFor}
          />
          {loadingMore && (
            // Below the list rather than over it: the cards above are readable
            // and are the ones being read, so this is a footnote about the tail
            // of the board and not a thing to watch.
            <p className="py-4 text-center text-xs text-foreground/45">
              Loading more trades…
            </p>
          )}
        </>
      )}

      {/* Latched on `openLeague` rather than on `sheetOpen`, the way the drawer
          below is latched: gated on the open flag, the sheet would be unmounted
          inside its own `close` handler and every reopen would go back through
          the `dynamic()` above. What it holds is a league id and a name, so
          keeping it costs nothing — the read behind it is gated separately. */}
      {openLeague && (
        <LeagueSheet
          league={openLeague}
          meta={leaguesById.get(openLeague.leagueId) ?? null}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {/* Latched rather than gated on `boardOpen`, so the drawer isn't
          unmounted by its own close and a second press is instant — the same
          reason the manager tool's `LeaguesViewLayout` latches it. */}
      {everOpenedBoard && (
        <AdpDrawer
          open={boardOpen}
          onClose={() => setBoardOpen(false)}
          controls={adpControls}
          onChange={setAdpControls}
          onReset={resetAdpControls}
          defaultSeason={defaultSeason}
          leagues={leagues}
          board={board}
          density={density}
        />
      )}
    </>
  );
}

/** Whether anything the reader set is narrowing — for the empty state's wording. */
function activeTradeSelection(filters: TradeFilters): boolean {
  return (
    filters.range.preset !== "all" ||
    filters.circle !== "all" ||
    hasSideSelection(filters)
  );
}

/**
 * The size and shape of a filter trigger, held while its chunk loads.
 *
 * Sized to match rather than left empty, because the ledge's row wrapping when
 * the real button arrives would move the list down the page — which the
 * virtualizer would then have to re-measure and re-lay-out from.
 */
/** Stable empties, so a render before the first page doesn't change identity. */
const EMPTY_TRADES: readonly never[] = [];
// Typed as a lookup rather than left as `{}`, which is not indexable: the scope
// line reads names out of these maps, and a bare object literal makes that a
// type error at the one call site that needed it.
const EMPTY_MAP: Record<string, never> = {};

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      // A read that failed is worth interrupting for; an empty board is not —
      // that one is the answer to the filter the reader just pressed, and the
      // count beside the trigger already announces it.
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-xl border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-400/25 bg-red-400/5 text-red-200"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/60"
      }`}
    >
      {children}
    </p>
  );
}

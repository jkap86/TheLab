"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  HeaderSlot,
  LeagueFiltersPlaceholder,
  activeFilterCount,
  adpNarrowingCount,
  adpBoardRead,
  rookieOrderingBoard,
  startupPricingBoard,
  todayIso,
  useAdp,
  useAdpControls,
  useAdpDensity,
  useAdpLeagues,
  useStoredAccount,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import { AdpTrigger } from "@/features/shared/ui/adp-trigger";
import { useLatchedDisclosure } from "@/features/shared/use-latched-disclosure";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { focusRosterFor } from "../exchange";
import {
  DEFAULT_TRADE_FILTERS,
  activeTradeFilterCount,
  sideSelectionCount,
  tradeSeekBounds,
} from "../filters";
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
import { SeekKey } from "./seek-key";
import { SearchKey } from "./search-key";
import { TRADE_RAIL_BOX, TradeControls, TradeIdentity } from "./trade-controls";
import { TradeValuePicker } from "./trade-value";
import { TradesList } from "./trades-list";

/**
 * The league filters dialog, loaded on demand.
 *
 * It is not on screen at first paint — a trigger and a `<dialog>` only ever
 * shown by a press — and it is the largest client module this page pulls: ~970
 * lines with the whole slot-group and scoring-rule editor, its option tables and
 * its breakdown counts behind it. Statically imported, all of that was parsed
 * and evaluated before the first card could be drawn. The trade *search* is
 * split at its own root now rather than one layer in: its bays used to be on
 * screen at first paint, so the seam had to fall between them and their results
 * panel; behind the rail's `Search` key the whole control is something a reader
 * may never open, which is the rule for what gets split. The trade filters
 * proper are not split at all — a scope key row and a date field are smaller
 * than the placeholder a split would need.
 *
 * `ssr: false` because there is nothing to prerender: a `<dialog>` that opens on
 * a press has no server-rendered state worth having, and rendering it would put
 * the markup back in the document that the split is removing.
 *
 * The trigger *is* the component, so the fallback is what holds its place in the
 * controls' trailing group while the chunk loads — a plain pill of the same
 * size, so the row doesn't reflow when it arrives (which would move the list
 * under it and make the virtualizer re-measure its own offset).
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
 * The board's search, loaded the first time the rail's key opens it.
 *
 * The bays, their tokens, the swap key and — one `dynamic()` further in — the
 * results panel and its facets query. None of it is on screen until a press, so
 * the seam is the whole control rather than the panel inside it, and it is a
 * module boundary rather than an export name: the trigger is {@link SearchKey},
 * a module of its own, so nothing static reaches this chunk.
 *
 * No `loading` fallback, for `LeagueSheet`'s reason: nothing is holding its
 * place — the control appears where there was nothing — so a placeholder would
 * be a flash rather than a reserved box. What holds the reader's place instead
 * is the key itself, which is already lit and badged when there is a selection
 * behind it.
 */
const TradeSearch = dynamic(
  () => import("./trade-search").then((m) => m.TradeSearch),
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
 * line named a population and a window that the controls under it now state for
 * themselves. What replaced ~96px of masthead is `TradeControls`: the scope, the
 * date the board is positioned at, the count and every trigger on the page.
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

  // Whether the search bays are open, and whether they have ever been.
  //
  // Two pieces of state for the reason the league sheet and the ADP drawer keep
  // two: the second is a *latch*, so a collapse doesn't unmount the control —
  // which would go back through the `dynamic()` above on every reopen and, worse,
  // throw away the names it remembered for tokens the loaded pages never named
  // (see `TradeSearch`). Shut, the control is `display: none` and costs the page
  // nothing but its own subtree.
  const {
    open: searchOpen,
    mounted: everOpenedSearch,
    toggle: toggleSearch,
  } = useLatchedDisclosure();
  const searchId = useId();

  // The three boxes laid out above the list, watched by the virtualizer for the
  // size changes that move the board down the page — rather than the body,
  // whose box the list's own growth changes on every measured card.
  //
  // **Three rather than one, because the rail pins.** They used to be one
  // wrapper, and could not stay one: a sticky element travels only as far as its
  // own parent's box, so a rail seated inside a box that scrolls off unpins with
  // it. The rail is a sibling now, which means the run above the list is no
  // longer a single element to observe — each of these can change height on its
  // own (the plate with the filter summary, the rail when it wraps, the bays
  // when a token is added), and any of them moves the list.
  const plateRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // Stable identity: the list's measuring effect depends on this, and a fresh
  // array per render would tear down and re-attach three observers each time.
  const above = useMemo(() => [plateRef, railRef, searchRef], []);

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
    scope: adpScope,
  } = useAdpControls();
  const {
    open: boardOpen,
    mounted: everOpenedBoard,
    show: openBoard,
    hide: closeBoard,
  } = useLatchedDisclosure();
  // Asked for only once the drawer has been opened — the dialog inside it counts
  // its options over this, and the controls store asks for the same entry
  // whenever a rule is set, so the two gates are one request.
  const { leagues: boardLeagues } = useAdpLeagues(adpControls.season, {
    enabled: everOpenedBoard,
  });
  const adpQuery = useMemo(
    () => adpBoardRead(adpControls, adpScope, todayIso()),
    [adpControls, adpScope],
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
    () => adpBoardRead(rookieOrderingBoard(adpControls), adpScope, todayIso()),
    [adpControls, adpScope],
  );
  const startupQuery = useMemo(
    () => adpBoardRead(startupPricingBoard(adpControls), adpScope, todayIso()),
    [adpControls, adpScope],
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
    () => tradeSeekBounds(tradeFilters.seek, today),
    [tradeFilters.seek, today],
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

  // Built once per request rather than per render: with a large league scope the
  // key carries every id in it, and it is read twice below — as the board's
  // cache key and as the residual pass's generation.
  const requestKey = useMemo(() => tradeQueryKey(request), [request]);

  /**
   * Travelling to a date takes the reader back to the top of the board.
   *
   * **This is what makes the date control a place to go rather than a slice to
   * look at.** A seek re-keys the board, and `keepPreviousData` deliberately
   * holds the reader where they were through a re-key — which is right for every
   * other filter here, where the point is that the list *doesn't* flash away,
   * and exactly wrong for a position: landing forty cards into a board that
   * begins at the requested date is the one place that date cannot be read.
   *
   * Three decisions in it:
   *
   * - **It scrolls the identity plate, not the list.** The list is unmounted
   *   whenever the board is empty — the "no trades" note takes its place — so a
   *   travel that lands on nothing has no list to scroll to, and a list that
   *   unmounts mid-change takes its own scroll target with it. The plate is
   *   always mounted and its top edge is where the board begins.
   *
   *   **Its `scroll-mt` clears the app bar and nothing else, even though a rail
   *   pins below the bar.** A sticky part is only pinned while its natural
   *   position would sit above the offset, and the rail comes *after* the plate:
   *   at the moment the plate's top is flush under the bar, the rail is at its
   *   resting place further down the page and is covering nothing. That is also
   *   why this page publishes no pinned height — nothing here has to clear the
   *   rail, so there is no second `--list-ledge-h` to measure and keep honest.
   * - **It only fires once the plate has scrolled off.** A reader still looking
   *   at the controls is already at the top, and pulling the page to hide the
   *   control they just pressed is worse than not moving at all.
   * - **It is skipped on mount**, since a board arriving is not a reader
   *   travelling — the ref opens holding the seek this render already has.
   *
   * The offset is the browser's arithmetic: `scroll-mt` on the header below is
   * how the pinned app bar is accounted for, the same mechanism the leagues list
   * scrolls an expanded card by. The scroll is not smooth, because a glide under
   * a list being replaced beneath it is two motions fighting.
   */
  const seek = tradeFilters.seek;
  const travelledTo = useRef(seek);
  useEffect(() => {
    if (travelledTo.current === seek) return;
    travelledTo.current = seek;
    const plate = plateRef.current;
    if (plate && plate.getBoundingClientRect().top < 0) {
      plate.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [seek]);

  const { data, loading, loadingMore, stale, hasMore, loadMore, error } =
    useTrades(request, requestKey);

  const trades = data?.trades ?? EMPTY_TRADES;

  /**
   * The residual verdict — see `../incremental` for why it has three answers.
   *
   * **There is nothing left for it to deny.** Every narrowing this page offers
   * is applied in SQL now, including a league set too large for a query string
   * (which travels as a POST body rather than falling back to the browser — the
   * false-empty bug that fallback caused is why it is gone). What survives is
   * the accumulator itself, which is what keeps the list's identity stable as
   * pages append: a page that admits everything hands the previous arrays back,
   * so the virtualizer's measurement cache rides through untouched.
   */
  const judge = useCallback((): Verdict => "allowed", []);

  const { visible } = useFilteredTrades(
    trades,
    // Everything the verdict closes over except the leagues, which is its own
    // generation below — a change here throws the accumulated answer away, a
    // change there only revisits what was never decided.
    requestKey,
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

  // Which card has its pre-trade rosters showing.
  //
  // **Here rather than in the card**, for the reason the leagues list keeps the
  // open league above its own list: a windowed card unmounts when it scrolls out,
  // so state held inside one would close itself behind the reader and hand a
  // remounted collapsed card an expanded card's measured height. One id rather
  // than a set, which is that list's rule too — a board where every card can be
  // left open is one whose total size churns as the reader scrolls back over
  // them. Each card is given a *boolean*, so opening one re-renders the two cards
  // involved rather than the whole window.
  const [openRosters, setOpenRosters] = useState<string | null>(null);
  const toggleRostersFor = useCallback((trade: Trade) => {
    setOpenRosters((prev) =>
      prev === trade.transaction_id ? null : trade.transaction_id,
    );
  }, []);

  return (
    <>
      {/* The board's trigger, seated in the app bar rather than beside the
          page's own controls — it narrows the crawled market, not this page's trades, the
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
          onClick={openBoard}
        />
      </HeaderSlot>

      {/* What board this is, in words — read once at the top and then scrolled
          away. It leads the page because the scope is its widest claim (every
          crawled league, or one account's corner of it) and because a bay
          reading `+ anyone` means "anyone *in this circle*": a reader who meets
          the search first is composing a question with no population stated to
          ask it of.

          It is also what the date control scrolls back to (see the effect
          above), which is what the `scroll-mt` is for: the app bar is pinned, so
          a plate scrolled flush to the viewport top would sit under it. */}
      <div ref={plateRef} className="scroll-mt-[var(--site-header-h)]">
        {/* The page deliberately leads with its own description rather than a
            title — the app bar already names the tool, which is the whole
            argument for deleting the masthead. What that left was a document
            whose first heading was a trade card, so the name it dropped is kept
            where only a heading outline can see it. */}
        <h1 className="sr-only">Trades</h1>

        <TradeIdentity filters={tradeFilters} account={account} />
      </div>

      {/* Everything a reader reaches for while reading, on one band pinned under
          the app bar — see {@link TradeControls} for why this is a sibling of
          the plate rather than a child of it, and for why the seek key is in it
          rather than floating over the board on a second pinned layer. */}
      <div ref={railRef} className={TRADE_RAIL_BOX}>
        <TradeControls
          filters={tradeFilters}
          onChange={setTradeFilters}
          leagueFilters={leagueFilters}
          season={season}
          account={account}
          names={names}
          trailing={
            <>
              {/* The board's size — the one number on the page that answers
                  "did that filter do anything", which is why it rides the rail
                  with the keys that move it rather than the plate that
                  describes it. */}
              <p
                // The number every filter on this page is pressed to move, and
                // the only feedback a press gives — the board itself is a
                // windowed list a reader may be nowhere near. On the rail it is
                // feedback the reader can still see at row nine hundred, which
                // the old block could not offer at all.
                role="status"
                className={`flex shrink-0 items-baseline gap-1.5 text-sm text-foreground/60 transition-opacity ${
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
              {/* Beside the league filters and after them, which is the order
                  the narrowing line beside these keys already reads in: what
                  these leagues are, then what happened in them. The two filter
                  sets stay two keys for the same reason they stay two controls
                  — one narrows leagues, the other trades — and they are the
                  same part in the same seat so that the row reads as a pair
                  rather than as a hierarchy. */}
              <SearchKey
                expanded={searchOpen}
                active={sideSelectionCount(tradeFilters)}
                controls={everOpenedSearch ? searchId : undefined}
                onToggle={toggleSearch}
              />
            </>
          }
          seek={
            <SeekKey
              value={tradeFilters.seek}
              today={today}
              onChange={(seek) => setTradeFilters({ ...tradeFilters, seek })}
            />
          }
        />
      </div>

      {/* The board's search, opened from the rail above it. Two bays wearing the
          trade card's own side plate: things in the same bay were on the same
          side of the trade, so a manager and a player together means he received
          him and on opposite sides means he gave him. It opens *here* rather
          than floating out of the key, because a bay is the card below it at the
          same size — a panel over the list would be filtering the very thing it
          was covering.

          The wrapper stays mounted whether or not the search is: it is one of
          the three boxes the list watches for the size changes that move the
          board down the page, and an unmounted observer target is a
          `scrollMargin` frozen at whatever it last read. */}
      <div ref={searchRef}>
        {everOpenedSearch && (
          <TradeSearch
            id={searchId}
            expanded={searchOpen}
            filters={tradeFilters}
            onChange={setTradeFilters}
            season={season}
            scope={scope}
            account={account}
            bounds={bounds}
            players={players}
            managers={managers}
          />
        )}

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
            : // The tested count, not a second predicate over the same fields:
              // the empty state's wording and `Clear` have to agree about
              // whether anything is narrowing, or a fourth filter dimension
              // added to one leaves the other lying.
              leagueFiltersActive || activeTradeFilterCount(tradeFilters) > 0
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
            above={above}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onOpenLeague={openLeagueFor}
            openRosters={openRosters}
            onToggleRosters={toggleRostersFor}
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
          scope={adpScope}
          onClose={closeBoard}
          controls={adpControls}
          onChange={setAdpControls}
          onReset={resetAdpControls}
          defaultSeason={defaultSeason}
          // The crawled leagues the *board's* rules run over, which is not this
          // page's own league list: that one is every league with a trade this
          // season, and this one is every league with a draft the board could
          // average. Two questions, two populations — the drawer's dialog counts
          // its options over the one it actually narrows.
          leagues={boardLeagues}
          board={board}
          density={density}
        />
      )}
    </>
  );
}

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

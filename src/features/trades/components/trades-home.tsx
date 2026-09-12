"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import {
  BubblingFlask,
  CONSOLE_KEY,
  DEFAULT_LEAGUE_FILTERS,
  FlaskDefs,
  LeagueFiltersDialog,
  activeFilterCount,
  filterSummary,
  storeTradeLeagueFilters,
  storeTradeValueBasis,
  useActiveCard,
  useKtcBoard,
  useTeamsColumn,
  useStoredAccount,
  useTradeDataStamp,
  useTradeLeagueFilters,
  useTradeValueBasis,
} from "@/features/shared";

import {
  DEFAULT_TRADE_FILTERS,
  DEFAULT_TRADE_SEEK,
  activeTradeFilterCount,
  tradeFilterSummary,
  tradeSeekBounds,
} from "../filters";
import type { TradeFilters, TradeNames, TradeSeek } from "../filters";
import { tradeCountLabel, tradeCountReading } from "../trade-count";
import { useTodayIso } from "../hooks/use-today-iso";
import { useTradeLeagues } from "../hooks/use-trade-leagues";
import { useTrades } from "../hooks/use-trades";
import { resolveLeagueScope, tradeQueryKey } from "../trade-query";
import type { TradeRequest } from "../trade-query";
import { CircleNote, CircleStepper } from "./trade-controls";
import { SeekKey } from "./seek-key";
import { ValuePanel } from "./value-panel";
import { TradeSearch } from "./trade-search";
import { TradesList } from "./trades-list";

/**
 * The trades board: every trade this database has stored for a season, narrowed
 * three ways.
 *
 * **The three narrowings are three different kinds of thing, and the split is
 * the design.**
 *
 * - **The league rules run here, in the browser**, and only their *answer*
 *   crosses the wire. They are the same engine the manager page filters its
 *   leagues with, over Sleeper's own JSONB blobs; a second implementation in
 *   SQL would drift silently, and the symptom would be a filter quietly
 *   returning the wrong leagues rather than an error.
 * - **The bays run in SQL.** Which players, picks and managers were on which
 *   side is a question about the trades themselves, and answering it in the
 *   browser would mean downloading the season to filter it.
 * - **The circle crosses unresolved**, as a word and an account id. What "my
 *   leagues" and "my leaguemates" stand for is the database's answer; a browser
 *   holding it would have had to be told it first.
 *
 * Two things must keep reading the **unfiltered** list, on the leagues console's
 * rule: the league dialog's own option counts, and the scope resolution itself.
 * Taken off a narrowed list they would each describe the selection rather than
 * the population it was made from.
 */
export function TradesHome({
  season,
  heading,
}: {
  season: string;
  /** Static copy, rendered on the server — see the page. */
  heading: ReactNode;
}) {
  const account = useStoredAccount();
  const today = useTodayIso();
  // When this device last saw a sync land. It joins both reads' subjects so a
  // reader who has just synced is not answered out of a browser cache filled
  // before they did — see `features/shared/trade-freshness` for why the two
  // routes keep their cache headers and this rides the URL instead.
  const { stamp, resolved: stampResolved } = useTradeDataStamp();
  const {
    leagues,
    byId,
    loading: leaguesLoading,
    error: leaguesError,
  } = useTradeLeagues(season, stamp, stampResolved);

  // **The league narrowing is the device's and outlives the visit**, on its own
  // key rather than the one the three manager-scoped tools share: this board's
  // leagues are every league in the corpus that traded this season rather than
  // anybody's account, and its filters cross the wire as a league scope where
  // theirs narrow a list already in hand. See
  // `features/shared/league-filters-store`. Nothing has to be gated for it — the
  // paging hook already waits on `stampResolved`, which flips on the same
  // post-hydration render the stored selection lands on, so the first page
  // fetched is the narrowed one.
  const leagueFilters = useTradeLeagueFilters();
  const setLeagueFilters = storeTradeLeagueFilters;
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_TRADE_FILTERS);
  const [seek, setSeek] = useState<TradeSeek>(DEFAULT_TRADE_SEEK);
  const [searchOpen, setSearchOpen] = useState(false);
  // The value basis and the KTC market this device reads. Unlike the manager
  // page neither rides the request: this board only *prints* the number, so
  // putting either in `TradeRequest` would reset a scrolled keyset walk to page
  // one to change a display unit — and flipping basis is comparative, so that
  // cost would land in exactly the case the control exists for. The payload
  // carries every basis and both markets and the card picks — see
  // `TradesPagePayload.assetValues`.
  const basis = useTradeValueBasis();
  const ktcBoard = useKtcBoard();
  /**
   * What the standings pane inside an open card reads.
   *
   * Read once here on `basis` and `ktcBoard`'s own rule — a hook inside a card
   * would subscribe every row of a board that appends a hundred at a time — and
   * it is a *different* preference from `ktcBoard` beside it: that one is which
   * market the asset figures on every card are printed in, this one is the
   * column one card's expanded league is totalled and ordered by, on its own
   * ledge with its own picker.
   */
  const teamsColumn = useTeamsColumn();

  const narrowingLeagues = activeFilterCount(leagueFilters) > 0;
  /**
   * Whether the scope this request would carry is the one the reader asked for.
   *
   * `resolveLeagueScope` answers `all` for a population that has not loaded —
   * deliberately, since `include: []` would blank the board for the beat before
   * the leagues arrive — so a reader whose narrowing is **stored** rather than
   * pressed has a request that is honest and wrong the moment the page hydrates:
   * it fetches the unnarrowed page one, paints trades from leagues they have
   * filtered out, and re-fetches when the list lands. That is
   * `useTradeDataStamp`'s own argument one input over, and it waits the same way
   * — a round trip it is about to throw away, and this one shows the reader the
   * wrong rows on the way.
   *
   * It waits only where the wait buys something. With nothing narrowed the scope
   * is `all` whether or not the leagues are in, so the common case pays nothing;
   * and `loading` settles on a failure as well as an answer, so a leagues read
   * that fails leaves the board unnarrowed with its own error beside it — that
   * hook's documented degradation — rather than hanging on a list that is never
   * coming.
   */
  const scopeReady = !narrowingLeagues || !leaguesLoading;

  // The request is memoised because it is the paging hook's input and the
  // subject key is derived from it; rebuilding it per render is fine, but the
  // key must be stable for an unchanged question.
  const request = useMemo<TradeRequest>(
    () => ({
      season,
      scope: resolveLeagueScope(leagues, leagueFilters, narrowingLeagues),
      filters,
      bounds: tradeSeekBounds(seek, today),
      user: account?.user_id ?? null,
      stamp,
    }),
    [season, leagues, leagueFilters, narrowingLeagues, filters, seek, today, account, stamp],
  );
  const requestKey = tradeQueryKey(request);

  // The facets read the same scope and window with **no selection** — see
  // `TradeSearchPanel`. Built here so both the request and its key are one
  // memo rather than the panel re-deriving them per render.
  const facetsRequest = useMemo<TradeRequest>(
    () => ({ ...request, filters: { ...filters, sides: DEFAULT_TRADE_FILTERS.sides } }),
    [request, filters],
  );
  const facetsKey = tradeQueryKey(facetsRequest);

  // `error` is the first page's — nothing loaded, so it replaces the board.
  // `loadMoreError` is the walk's, and it deliberately does not: the reader is
  // looking at trades that loaded fine, and a dropped request must not take
  // them off screen. See `useTrades`.
  const {
    data,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    retryLoadMore,
    retry,
    error,
    loadMoreError,
  } = useTrades(request, requestKey, {
    enabled: stampResolved && scopeReady,
  });

  // Names come off whatever the board has loaded; a facet can name a player no
  // loaded page does, which is why the panel merges its own `names` in. The id
  // is the fallback rather than a placeholder — it is the only true thing
  // available, and a summary reading "1 player" beside a bay drawing a name is
  // how the old shape gave itself away.
  const names = useMemo<TradeNames>(
    () => ({
      player: (id) => data?.players[id]?.name ?? id,
      manager: (id) => data?.managers[id]?.display_name ?? id,
    }),
    [data],
  );

  const selection = tradeFilterSummary(filters, names);
  const searchCount = activeTradeFilterCount(filters);

  /**
   * **An open card is the screen, and it is a link** — `?trade=<id>` here,
   * where the two league tools name a league. The park, the lock and the param
   * are `useActiveCard`'s; this page owns which rows may be opened and standing
   * its own header down while one is.
   *
   * `ids` is every trade the walk has loaded, which on this board is the only
   * list there is: a narrowing restarts the keyset walk from page one, so a
   * card whose trade is no longer among them closes rather than parking a shell
   * around a row that is gone. It costs a `map` per appended page, which is the
   * one place this board's own memoisation argument does not reach — and it is
   * an array of ids the page already holds rather than anything rebuilt.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(
    () => (data ? data.entries.map((e) => e.trade.transaction_id) : []),
    [data],
  );
  const card = useActiveCard({ param: "trade", ids, listRef });

  return (
    // The page sits on the ground the route renders rather than on a panel of
    // its own — see `ConsoleGround`, and the lineup checker, which took the
    // same edit for the same measured reason. The panel's inset and border were
    // ~106px at 1280 and ~50px at 390 that this page spent and `/manager` did
    // not, so the same card over the same league was narrower here on a shell
    // both pages already set to `console`. With the panel gone the two agree by
    // construction rather than by two spellings of a width.
    <div className="relative">
      {/* The flask's gradients and its clip, once for the whole page rather
          than once per flask — see `FlaskDefs`.

          **Above the ternary, not inside either arm**, and that is the one
          thing about the placement that matters: this page has two loading
          states in two *exclusive* branches — the first page's indicator below,
          which replaces the board, and the load-more note inside the board it
          replaces. Mounted in either one, the other draws a vessel whose fill,
          fluid and bubbles resolve to nothing, which reads as an *empty* flask
          rather than as a broken page. */}
      <FlaskDefs />
      {/* **Everything above the board stands down while a card is parked.**
          One wrapper rather than a class on each of the six, and
          `display: contents` off it — so the page's own layout is byte for byte
          what it was when nothing is open, and none of these is unmounted: the
          two dialogs keep their drafts and the search panel its query.

          `chromeClass` is a constant that the stylesheet reads against the
          stage on the `<main>`: it fades the six out during the settle and in
          again on the return, and is `hidden` in between. It takes a box for as
          long as it is fading, since opacity has no effect on an element with
          none. */}
      <div className={`contents ${card.chromeClass}`}>
        <header className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-0">
            {heading}
            <p className="mt-1 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
              {season}
            </p>
          </div>
          <div className="ml-auto">
            <CircleStepper
              circle={filters.circle}
              onChange={(circle) => setFilters({ ...filters, circle })}
              hasAccount={account !== null}
            />
          </div>
        </header>

        <div className="relative mt-3">
          <CircleNote circle={filters.circle} hasAccount={account !== null} />
        </div>

        {/* The controls rail. The rule fills what the keys leave, so they read as
            mounted on the console's trim rather than floating above the list.

            **The rail is the value panel's positioning context, and it is raised
            above the cards.** Anchored to its own key the panel would be a 23rem
            box hanging off a control two thirds of the way along the row, and at
            a phone's width it would leave the viewport; anchored here its right
            edge is the shell's own gutter. The `z-30` is what lets it overlap the
            first card rather than being painted under it. */}
        <div className="relative z-30 my-7 flex flex-wrap items-center gap-3">
          <div
            aria-hidden
            className="h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
          />
          <p
            role="status"
            className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] tabular-nums text-foreground/70"
          >
            <TradeCount data={data} loading={loading} hasMore={hasMore} />
          </p>
          <SeekKey seek={seek} onChange={setSeek} today={today} />
          {/* The dialog takes the **unfiltered** list: every count in it is over
              the whole population, which is what makes them counts rather than a
              description of what is already selected. */}
          <LeagueFiltersDialog
            filters={leagueFilters}
            onChange={setLeagueFilters}
            leagues={leagues}
          />
          {/* What every figure on the board is, and — inside it — which
              KeepTradeCut market answers when that is the basis. The board keys
              used to stand out here on the rail, where they read as a control
              over every number on the page rather than over one basis of three;
              moving them in is the same call that put them at the foot of the
              manager page's Columns dialog. */}
          <ValuePanel
            basis={basis}
            onBasis={storeTradeValueBasis}
            board={ktcBoard}
            sources={data?.values ?? null}
          />
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-expanded={searchOpen}
            className={CONSOLE_KEY}
          >
            Search
            {searchCount > 0 && (
              <span className="ml-2 rounded-full bg-active/15 px-1.5 py-0.5 text-active">
                {searchCount}
              </span>
            )}
          </button>
        </div>

        {/* What the two hidden filter sets have narrowed to. Both dialogs hide
            their own state, so this line is the only thing on the page saying
            so — and it says the *relation* ("X gave Y"), which is the one part of
            a bay selection that has nowhere else to surface. */}
        {(narrowingLeagues || selection) && (
          <p className="relative -mt-3 mb-6 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
            {[narrowingLeagues ? filterSummary(leagueFilters) : null, selection]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {searchOpen && (
          <TradeSearch
            filters={filters}
            onChange={setFilters}
            names={names}
            request={facetsRequest}
            requestKey={facetsKey}
          />
        )}

        {leaguesError && (
          // The leagues request failing costs the cards their league *names* and
          // the dialog its options; the trades are a different request and are
          // unaffected, so this is a note rather than the page.
          <p className="relative mb-5 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
            League names unavailable — {leaguesError}
          </p>
        )}
      </div>

      {/* **The first page's failure only.** A later page failing leaves the
          board exactly as the reader left it and says so under the last card —
          see `TradesList`. Replacing a hundred loaded cards with this box over
          one dropped request is the thing that split `error` in two. */}
      {error ? (
        <div className="relative flex flex-wrap items-center gap-4">
          <p
            role="alert"
            className="m-0 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[length:var(--fs-13)] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
          >
            <span
              aria-hidden
              className="size-[0.4375rem] rounded-full bg-error shadow-[0_0_10px_var(--error)]"
            />
            {error}
          </p>
          {/* The board restarts on a subject change, so without this the only
              way to ask the same question again was to touch a filter — which
              asks a different one. */}
          <button
            type="button"
            onClick={retry}
            className="shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <TradesLoading />
      ) : !data || data.trades.length === 0 ? (
        <EmptyBoard
          narrowed={narrowingLeagues || searchCount > 0 || seek !== null}
          circle={filters.circle !== "all"}
          onClear={() => {
            setLeagueFilters(DEFAULT_LEAGUE_FILTERS);
            setFilters({ ...DEFAULT_TRADE_FILTERS, circle: filters.circle });
            setSeek(DEFAULT_TRADE_SEEK);
          }}
        />
      ) : (
        <TradesList
          data={data}
          card={card}
          listRef={listRef}
          leaguesById={byId}
          basis={basis}
          board={ktcBoard}
          teamsColumn={teamsColumn}
          // The page's own season, and the stored account read once here rather
          // than by each of hundreds of memo'd cards — `TradeCard` carries the
          // rule. An opened card solves and rewinds the league it names, and
          // both of those are priced against these two.
          season={season}
          username={account?.username ?? null}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={loadMore}
          onRetry={retryLoadMore}
        />
      )}
    </div>
  );
}

/**
 * The board's first page, in flight.
 *
 * It was the words `Reading the board…` and nothing else, which is a page that
 * has said what it is doing and then shows no sign of doing it. This is the
 * app's own mark bubbling beside the copy, over a sweep bar.
 *
 * **The bar is indeterminate by construction** rather than by omission: nothing
 * on this board knows how many trades are coming — the count beside the filters
 * is a `Reading…` of its own until the first page lands and the total is
 * answered on that page alone. So a determinate bar would be a fraction of a
 * denominator nobody has. `--progress-fill` is the cold sync's own segmented
 * ramp, which is the right vocabulary for the same reason it is there: discrete
 * segments read as an instrument counting, where a solid fill reads as a
 * painted rectangle sliding about.
 *
 * **This is the `loading` arm and not a thing beside it**, which is what keeps
 * the promise that a flask is never left bubbling behind a failed request: the
 * error arm above replaces this one whole, and the empty state below it does
 * too. There is no path on which both are on screen.
 *
 * The whole block is one `role="status"` region, so the flask is decoration —
 * the copy already says what it says, and a named flask beside it would be the
 * same news read twice.
 */
function TradesLoading() {
  return (
    <div role="status" aria-live="polite" className="relative flex items-center gap-[1.125rem] pt-5">
      <span
        aria-hidden
        className="relative inline-flex size-22 shrink-0 items-center justify-center"
      >
        {/* The halo is a sibling rather than part of the svg: a `filter` cannot
            pulse on its own, and the cast the flask already carries is a
            different job — this is the light the glass throws on the ground
            around it while it works. `loud` only; at a well flask's size a
            breathing halo is a flicker. */}
        <span
          className="lab-anim absolute -inset-2 rounded-full bg-[image:var(--flask-halo)]"
          style={{ animation: "fl-glow 2.6s ease-in-out infinite" }}
        />
        <BubblingFlask size={88} tone="loud" label={null} className="relative" />
      </span>
      <div className="min-w-0">
        <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
          {/* The ellipsis breathes on its own so the words do not: a whole line
              of copy fading in and out reads as a fault. */}
          Loading trades
          <span className="lab-anim" style={{ animation: "fl-ellipsis 1.4s ease-in-out infinite" }}>
            …
          </span>
        </p>
        <span
          aria-hidden
          className="mt-2.5 block h-1 w-44 overflow-hidden rounded-full bg-[color:var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.9),inset_0_-1px_0_rgba(255,255,255,0.06)]"
        >
          {/* 42% of the channel over a −108%→196% travel. A narrower bar over a
              longer range leaves the channel visibly empty for part of every
              cycle, and an indicator that is blank a third of the time reads as
              static. */}
          <span
            className="lab-anim block h-full w-[42%] bg-[image:var(--progress-fill)]"
            style={{ animation: "fl-sweep 1.9s cubic-bezier(0.55,0.1,0.45,0.9) infinite" }}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * "N of M trades" — what the filters left, over what the league rules and the
 * circle leave.
 *
 * Two numbers because they are two questions, the same distinction the two
 * dialogs draw. **A count that failed is not a count of what loaded**: it used
 * to fall back to `data.trades.length` and print that as the answer, so the
 * first page of a board with thousands of trades read "100 trades". The rule
 * and its four readings live in `../trade-count`, which is pure and tested —
 * the difference between an exact total and a floor is one character of markup
 * and a claim the reader cannot check.
 */
function TradeCount({
  data,
  loading,
  hasMore,
}: {
  data: { trades: readonly unknown[]; total: number | null; scopeTotal: number | null } | null;
  loading: boolean;
  /** Whether the walk can still go on, which is what makes a floor a floor. */
  hasMore: boolean;
}) {
  return <>{tradeCountLabel(tradeCountReading(data, loading, hasMore))}</>;
}

/**
 * Two empty states, because they are two claims: one is about the database, the
 * other about the selection — and only the second has anything the reader can
 * undo.
 */
function EmptyBoard({
  narrowed,
  circle,
  onClear,
}: {
  narrowed: boolean;
  circle: boolean;
  onClear: () => void;
}) {
  if (!narrowed && !circle) {
    return (
      <p className="relative font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
        No trades stored for this season — look a manager up on Tools to sync
        their leagues.
      </p>
    );
  }

  return (
    <div className="relative flex flex-wrap items-center gap-4">
      <p className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
        {circle && !narrowed
          ? "No trades in this circle."
          : "No trades match these filters."}
      </p>
      {narrowed && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

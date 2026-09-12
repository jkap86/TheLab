"use client";

import { memo, useMemo, useState, type MouseEvent } from "react";

import type {
  LineupColumn,
  ManagerLeague,
  ManagerLineupsPayload,
  MetricRank,
  Trade,
  TradeSide,
} from "@/shared/contract";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { pickSlotKey } from "@/shared/trades/pick-slots";
import {
  CardBilletRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  DateBillet,
  ExpandedPanel,
  formatInstantDate,
  formatInstantTime,
  LeagueConfigWindow,
  LeagueBillet,
  rankColor,
  rankFill,
  rankPercentile,
  Scanlines,
  SummaryFold,
  SummaryReadingsKey,
  useLeagueLineup,
} from "@/features/shared";

// Named by module path rather than through `@/features/shared`, and that is the
// whole reason the timeline sits outside that barrel: a component file is one
// module to the bundler, so a `TimelineView` reached through the barrel would
// ship the rail, the rewind and the fetch hook to every page importing anything
// shared. Named here, the chunk belongs to this route.
import {
  TimelineHistoryKey,
  TimelineView,
} from "@/features/shared/ui/timeline";

import {
  assetPrice,
  bundleValue,
  formatAssetValue,
  TRADE_BASIS_NOTES,
  TRADE_BASIS_UNITS,
  type ValueLens,
} from "../asset-value";
import {
  givenBundle,
  isEmptyBundle,
  receivedBundle,
  type TradeBundle,
} from "../exchange";
import { pickLabel, pickOriginRoster } from "../pick-display";
import type { TradeCardView } from "../trades-data";
import { useValueLensChoice } from "./value-lens-context";

/**
 * One trade, as a housing with a lit window per participating roster.
 *
 * **Each side says what it received and what it gave, and the redundancy is the
 * point.** On a two-sided card the give lines repeat the other side's take
 * lines — which is what lets one manager's half be read on its own, the way a
 * card in a long list actually gets read. It is paid for by drawing the gives
 * as the dimmer half of the pair, so the card still reads take-first.
 *
 * A three-way trade has no knowable gives: nothing Sleeper stores says which
 * participant a pick came *through*, so `givenBundle` answers null and the
 * card draws the take column alone rather than guessing.
 *
 * **The card is an instrument housing and every side is a window cut into it**,
 * which is the console-card language `/manager` and `/lineupchecker` carry too
 * — the same league seen from three tools should read as the same object. Type
 * inside the card is all mono, set on the article so nothing inside has to
 * remember.
 *
 * **There is no fairness or "who won" indicator, deliberately.** An earlier
 * round of the design had a balance meter and a delta plate and they were
 * removed: the values are shown and the comparison is left to the reader. Do
 * not reintroduce one.
 *
 * **The card opens onto the league itself**, which is the whole of what this
 * disclosure is for: a trade is two hauls and the question every one of them
 * raises is *what did that do to these teams*. So the expanded half is the
 * manager card's own expanded half — the same capped housing, the same history
 * bay, the same two panes, the same drawer of bench and picks — over the league
 * this trade happened in. It is two component calls (`ExpandedPanel` and
 * `TimelineView`) rather than anything drawn here, and that is deliberate: a
 * league described one way on `/manager` and another here would be the drift the
 * console-card language exists to remove.
 *
 * **Everything structural in the summary is `league-card.tsx`'s, to the
 * value**: the `<li>`'s perspective and its two z-orderings, the metal finish,
 * the four decorative layers in the one span that clips, the gutter, the tilt
 * and its flattening, and the focus ring. What differs is what the card holds.
 *
 * **Three things depart from that card, and each is a measurement rather than a
 * preference.**
 *
 * 1. **The hauls fold away while the card is open, and an `Assets` key on the
 *    panel's seam brings them back.** An open card is the screen — the list
 *    stands down around it and the page stops scrolling — so the expanded half
 *    gets whatever the viewport has left after the summary, and both hauls in
 *    full are 413px of it, of which the two windows are ~279. At a 900px
 *    viewport that left the panel ~376px against a league card's ~565, and at
 *    800 the room fell under `MIN_PARKED` and the *shell* scrolled instead:
 *    the documented fallback rather than a failure, but this was the only card
 *    that reached it on an ordinary laptop.
 *
 *    **It used to condense rather than fold, and the difference is what the
 *    reader is shown.** The parked header was a second reading of the same
 *    hauls — one exchange window with two bays, no give track, no meters, no
 *    notes, each take track a fixed 78px scroller — and a haul stated one way
 *    closed and another way open is precisely the drift the console-card
 *    language exists to remove. It also only half answered the question it was
 *    asked: the disclosure's job is to hand the panel room, which a fold does
 *    completely and a condensing does partially. So the hauls go away whole
 *    and come back whole. Unfolded they are the shut card's own header, byte
 *    for byte — two windows in a grid, take track and give track, every meter,
 *    every position, every pick origin — so there is no third shape of the
 *    same haul for a reader to learn.
 *
 *    The boolean is the page's and the device's (`useSummaryReadings`), shared
 *    with the manager card's `Ranks` key and the lineup checker's `Checks`, and
 *    arrives already composed with `open` as `summaryFolded` — so a toggle
 *    re-renders the one card that is open rather than every row the board has
 *    loaded. A shut card is untouched, byte for byte. What stays on an open
 *    card is the settings strip, on the lineup checker's own terms: it names
 *    which game the league is playing, and that is the one reading here the
 *    table under the seam does not make again.
 * 2. **The summary is `shrink-0`, never `flex-1`.** On the manager card
 *    `flex-1` is what makes a card fill its grid row; here the `<details>` is a
 *    column flex container, so `flex: 1 1 0%` shrinks the summary *below its
 *    own content height* and its content paints over the expanded half — which
 *    is what hid the history rail during design.
 * 3. **The settings strip moved up**, from under the hauls to directly under
 *    the rule, on the plane between the plates and the windows. It is a
 *    property of the league and it now sits with the plate that names it.
 *
 * `memo`'d because the list re-renders on every appended page — and the memo
 * only *holds* because of what its props are. `view` used to be the whole
 * folded board, which is a new object every time a page lands, so `memo`
 * compared a changed prop for every card and re-rendered all of them: appending
 * page twenty cost twenty pages of re-renders, and the board got slower the
 * further a reader scrolled. A `view` is its own page's maps, built once and
 * shared by that page's trades. **`season` and `username` follow the same rule
 * and are props for the same reason** — `useStoredAccount()` inside the card
 * would subscribe every one of hundreds of rows to the same value, which is why
 * the value basis and the KeepTradeCut market are read from the store once, in
 * `TradesHome`, rather than here. **They are no longer props of this card
 * either**: as props, a flip of either dropped this memo for every loaded row
 * and re-rendered whole cards to change one figure per asset. They ride
 * `ValueLensProvider` from the list and are read exactly where a figure is
 * computed (`SideColumn`) and where the open half's subject needs the market
 * (`TradeLeague`), so a flip re-renders those and nothing else — see
 * `value-lens-context` for why a context read is not the per-card store
 * subscription the rule above avoids.
 *
 * See `trades-data` for why a page's own maps are the right ones to read.
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  view,
  teamsColumn,
  season,
  username,
  open,
  lit,
  onToggle,
  summaryFolded,
  onToggleReadings,
}: {
  trade: Trade;
  /** Null before the leagues request lands, or if it failed. */
  league: ManagerLeague | null;
  view: TradeCardView;
  /**
   * What the expanded half's standings pane reads — see `TradeLeague`.
   *
   * A prop rather than a hook, where the value basis and the KeepTradeCut
   * market are a context read: this is one column threaded from the page, and
   * both alternatives — a store subscription per card, or a second context —
   * cost more than passing it. The card's *asset* figures are priced on the
   * reader's own market, which is a different question with its own control.
   */
  teamsColumn: LineupColumn;
  /**
   * The season this board answers, which the expanded half is solved and
   * rewound against. The page's own, so the trade a reader is looking at and
   * the league they open under it are the same year.
   */
  season: string;
  /**
   * Whose synced drafts the ADP the expanded half prices capital against is
   * averaged over, and whose team it marks — null for a device with no stored
   * account, which costs those three columns and nothing else. A prop rather
   * than a hook, on the rule above.
   */
  username: string | null;
  /**
   * Whether the disclosure is open, whether its chrome is lit, and the press.
   *
   * **All three are stable for every card but the two that moved**, which is
   * what keeps the `memo` below worth having on a board that appends a hundred
   * rows at a time: `onToggle` is the page's own `useCallback` and takes the id,
   * and `lit` is a second boolean rather than a `closing` flag precisely so a
   * collapse changes a prop on the closing card alone. Which cards stand down
   * while one is parked is CSS reading `[open]`, for the same reason — a prop
   * for it would drop the memo for every row on the board.
   */
  open: boolean;
  lit: boolean;
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
  /**
   * Whether the two hauls are folded away — true only while the card is open
   * and the device's readings preference is off. Composed by the page rather
   * than read here, so the preference flipping moves one prop on one card
   * rather than dropping the memo for every row the board has loaded; see
   * `useSummaryReadings`.
   */
  summaryFolded: boolean;
  /** The `Assets` key's press. A module-level function, so the memo holds. */
  onToggleReadings: () => void;
}) {
  // The league's own type, read once here and handed to both side columns,
  // which resolve the reader's market against it — see `SideColumn`. Null
  // until the leagues request lands.
  const type = leagueType(league);

  return (
    // The `perspective` makes each `<li>` its own stacking context, so a card
    // that rises cannot paint over the one after it in DOM order — the raise
    // has to be ordered here, on the list item, rather than on the summary
    // inside it. `league-card.tsx` carries the finding.
    // `data-card` is how the close finds this row again once the list is back
    // around it — see `useActiveCard`.
    <li
      data-card={trade.transaction_id}
      className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10"
    >
      {/* `min-w-0` is what lets the card shrink to a phone: the `<li>` is a row
          flex container, so its item takes `min-width: auto` and refuses to go
          below its own min-content — and the expanded half's two panes sit side
          by side at every width by design, which puts that min-content above
          390. Without it the card is wider than the viewport and the whole page
          scrolls sideways. */}
      <details
        open={open}
        data-lit={lit ? "" : undefined}
        // **The housing is the `<details>`, not the `<summary>`**, since the
        // expanded-card pass — see the note above the summary. Everything that
        // is the card's *object* lives here: the shell, the metal, the tilt,
        // the lit and hover chrome, and the reduced-motion hook.
        //
        // **An open card is flat at `translateZ(0)`, and hovering it lifts
        // nothing.** It was held at `translateZ(20px)` while lit and lifted to
        // 30 under a hover, and both were the summary's alone; with the whole
        // housing transformed, a lift is a projection of the *card* — 0.84%
        // larger under the list's 2400px perspective — and the open card is
        // the parked shell's exact height, so 20px of lift was a housing 3px
        // taller than its shell and a scrollbar on a list with nothing to
        // scroll. The halo and the lit border are what say the card is open;
        // there is no neighbour left on the page for it to rise above. The
        // hover lift is gated to a closed card (`:not([open])`) for the same
        // reason, and to the summary rather than the whole housing so that a
        // pointer crossing a closed card's edge is what lifts it — the only
        // part of a closed card there is.
        className={
          `group/card lab-card-3d ${CONSOLE_CARD_SHELL} ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col ` +
          "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
          "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
          "pointer-fine:[&:not([open]):has(summary:hover)]:[transform:translateZ(30px)_rotateX(0deg)] " +
          "pointer-fine:data-[lit]:[transform:translateZ(0)_rotateX(0deg)] " +
          "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
          "has-[summary:hover]:border-active/45 data-[lit]:border-active/45 " +
          "pointer-fine:[&:not([open]):has(summary:hover)]:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
          "pointer-fine:data-[lit]:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)]"
        }
      >
        {/* Everything decorative, in the one layer that clips — and the one
            place in the card that is *before* the summary in the tree. It is
            the housing's layer now rather than the summary's, so the glow, the
            floor and the edge light cover the whole card, open half included,
            rather than ending at the seam. First rather than last so it paints
            under everything: a positioned `z-auto` span is painted in tree
            order among its siblings' positioned content, and the summary and
            the panel both come after it. (A `z-index` would have done the same
            and needed a stacking context on the housing to be contained by;
            `isolation: isolate` is a grouping value that flattens `preserve-3d`,
            and the transform that would otherwise provide one is
            `pointer-fine:` only.) The browser reads the *first summary child*
            as the disclosure whatever precedes it.

            The sheen and the floor only ever move under a hover, so they stay
            out of the tree entirely on a coarse pointer rather than sitting
            there as gradients nobody sees. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
          <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
          <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100 pointer-fine:block" />
          <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-data-[lit]/card:opacity-80" />
          <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100" />
        </span>
        <summary
          onClick={(event) => onToggle(trade.transaction_id, event)}
          // The header alone — the housing is the `<details>` since the
          // expanded-card pass, on `league-card.tsx`'s terms, so the league
          // this card opens onto is the same piece of stock under a groove
          // rather than a second housing below the first.
          className={
            // **`z-10` is what keeps the decorative layer under the header.**
            // A `<details>` paints the `<summary>` from a UA rendering slot of
            // its own that comes *before* the slot holding every other child,
            // so the decorative span above — written first precisely so it
            // would sit underneath — painted over this header instead, running
            // the card's 1px edge light straight through the engraved league
            // name on the billet that straddles that edge. Tree order cannot
            // fix it and neither can flattening the 3D context: the slot order
            // is the UA's. A positive z-index lifts the header past every
            // z-auto positioned child of the housing, which is the decorative
            // layer and nothing else a header can collide with — the panel is
            // a later sibling in the same content slot and was always above it,
            // and the two boxes do not overlap in any case.
            "relative z-10 flex shrink-0 cursor-pointer list-none flex-col font-mono " +
            // The manager card's gutter, composed onto the *shell* rather than
            // appended to `CONSOLE_CARD`: two base `px-*` utilities of the same
            // specificity are decided by Tailwind's emit order rather than the
            // class attribute, and the symptom is a card silently laid out at
            // the wrong width. See that constant's own note.
            // The top clears the billet (16px / 18px above the edge — 4px more
            // than the plate it replaced) and the bottom goes to 0 while the
            // card is open, on the manager card's exact terms: the expanded
            // half is the same stock under a groove now, and the groove is the
            // panel's first child. See `league-card.tsx` for the `group-open`
            // rather than `group-data-[lit]` argument.
            "px-3.5 pb-3.5 pt-[1.875rem] sm:px-[1.125rem] sm:pb-[1.125rem] sm:pt-[2.125rem] group-open/card:pb-0 " +
            // **`shrink-0`, never `flex-1`.** The `<details>` is a column flex
            // container, so `flex: 1 1 0%` would shrink this below its own
            // content height and its content would paint over the expanded
            // half — which is exactly what hid the history rail during design.
            // The two league cards say `flex-1` for their *closed* state and
            // `group-open/card:flex-none` for this one: a header that grows
            // into the panel's slack is also a header the panel is measured
            // against, which is a loop rather than a measurement. See
            // `usePanelCap`.
            "pointer-fine:[transform-style:preserve-3d] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >

          {/* Outside the clipping layer: the plates straddle the top edge, and
              a clip is exactly what would cut them off.

              The league is what the trade is *in* and the date is when, so they
              label the card from its top edge rather than sitting inside it as
              two more lines. One row, never two absolutely-positioned spans —
              `CardPlateRow` carries the reason. */}
          <CardBilletRow>
            {/* The plate used to take `size="md"` here — the trade is the
                card's subject and the league is where it happened. The billet
                has one size, and takes it here deliberately: the three league
                cards are kept in sync by the same handoff, and a league drawn
                one size on `/manager` and another here is the drift that pass
                exists to remove.

                **The name has most of the row now**, which is the date's doing
                rather than this part's: the date was a `ReadingPlate` — one
                pill, one line — and it is a `DateBillet` stacking the minute
                under the day, so the ledge opposite is roughly half the width
                it was and the name truncates into what is left far less often.
                The row's rule is unchanged: the ledge keeps its width and the
                name gives. See {@link DateBillet}. */}
            <LeagueBillet
              name={league?.name ?? trade.league_id}
              avatarUrl={league?.avatar_url}
            />
            <TradeDate at={trade.completed_at} />
          </CardBilletRow>

          {/* The hairline, and nothing beside it at any width.

              It carried the league's two format tags while the card was open,
              standing in for the settings strip the condensed header dropped.
              The strip is drawn at all times now — see below — so a second
              statement of the format on the row above it would be the same
              fact twice, and the row is the single child it has always been. */}
          <CardRule />

          {/* What game this league is playing, directly under the plate that
              names it — where it used to sit under the hauls. It is a property
              of the league, so it belongs with the league's own name rather
              than beneath the two hauls it qualifies; that is the order the
              manager card settled on for the same reason. It is that card's own
              strip, read from the same rules rather than re-derived — see
              `LeagueConfigWindow` — and it is what a value on this board could
              not say on its own: the same two players are a different trade in
              a dynasty superflex league than in a redraft one.

              `18px` is the plane between the plates and the windows, so they
              read front to back. That is new here — this card used to be flat
              and the strip took no transform — and it is affordable now for the
              reason the whole card is: the depth rides `pointer-fine:`, so a
              board with no virtualizer spends composited layers only where
              there is a hover to spend them on.

              **Drawn only once the league row has arrived.** Every rule it
              reads treats an absent blob as its own default — an absent `type`
              is redraft, an absent `best_ball` is managed — which is right for
              a league that answered and said nothing, and a claim for one that
              has not answered yet. The card would state "Redraft · Managed"
              over a dynasty league for as long as `/api/trades/leagues` took,
              then silently correct itself. Nothing is the honest reading, and
              it is the same beat the league's name spends showing its id.

              **Drawn while the card is open too**, which it was not while the
              parked header was a condensed one: the strip stood down and its
              format group moved onto the rule row to say the one thing the
              table below the seam does not. With the hauls folding instead,
              the room the strip costs is the fold's to find, and the reading
              stays where it belongs — under the plate that names the league,
              in the part that states the rest of its settings. */}
          {league && (
            <LeagueConfigWindow
              league={league}
              className="mt-3 sm:mt-3.5 pointer-fine:[transform:translateZ(18px)]"
            />
          )}

          {/* The hauls, folded away while the card is open.

              **Unfolded they are the shut card's own header, byte for byte** —
              two windows in a grid, take track and give track, every meter,
              every position and every pick origin. They used to be *rewritten*
              while the card was parked, into one exchange window of two bays
              with the gives, the meters and the notes dropped and each take
              track a fixed 78px scroller. That was a second shape of the same
              haul, which is the drift the console-card language exists to
              remove, and it was only half an answer to the question the
              disclosure asks: see departure 1 on the card above.

              **The fold wrapper is the summary's direct child and it is the
              wrapper that carries the `translateZ`.** `SummaryFold` clips, a
              clip is a flat rendering context, and a transform written on the
              grid inside it would compute against no projection at all with no
              error to say so — which is the requirement that component's own
              note records. A transform on the wrapper itself projects, and
              nothing inside a window carries a plane of its own.

              **The caps are above the tallest haul grid, never a clip, and
              they are two because the grid's own arrangement turns.** Two
              columns from `sm` and stacked below it — the same breakpoint the
              cap takes — so a phone's grid is both windows plus their gap
              where a wider one is the taller of the two, and measured that
              ratio is 1.93–2.08 across every shape. The stacked cap is
              therefore the two-column one doubled rather than a second number
              to keep in step. Measured content, `--type-scale: 1.16`, every
              asset priced so every take line carries its meter:

              | trade | ≥ `sm` | < `sm` |
              | --- | --- | --- |
              | one-for-one | 155 | 322 |
              | two-for-two | 227 | 465 |
              | three-way | 311 | 430 |
              | six-for-two | 389 | 751 |
              | six-for-two + two picks + FAAB | 421 | 813 |

              One cap covers every trade on the board, so each is sized to the
              fat case — which is what makes a small trade's fold finish early,
              since a `max-height` transition only moves the box while the cap
              is above it and the curve is front-loaded. **The ceiling is real
              and is the mechanism's**: a haul is unbounded where the two other
              cards' folded readings are four windows each, so a trade past
              ~10 assets a side overflows the cap and `SummaryFold`'s clip cuts
              it — measured, an 8-players-plus-3-picks-plus-FAAB side needs 687
              and 1314. Raising both together is the fix if that shape turns up
              on a real board, at the cost of the ordinary trade's fold reading
              as a pop. Re-measure if the row gap, the meter or the header's
              insets ever move.

              A three-way is unaffected either way: `givenBundle` answers null
              for one, so those cards draw the take column alone whether the
              hauls are folded or shown — which is also why the exchange window
              was never drawn for three sides. */}
          <SummaryFold
            folded={summaryFolded}
            className="relative pointer-fine:[transform:translateZ(22px)]"
            shownClassName="mt-3.5 max-h-[920px] opacity-100 sm:max-h-[460px]"
            foldedClassName="mt-0 max-h-0 opacity-0"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {trade.sides.map((side) => (
                <SideColumn
                  key={side.roster_id}
                  trade={trade}
                  side={side}
                  view={view}
                  leagueType={type}
                />
              ))}
            </div>
          </SummaryFold>

          {/* **Not drawn while the card is open**, and it is the second of the
              two removals that shorten the parked header. It is the affordance
              that says the card opens; once open it is spent, and it is a row
              of its own — a word, a hairline and a chevron — rather than
              something hung off a line already there.

              No affordance is lost with it: the `<summary>` is the control and
              carries the disclosure's semantics itself, so the row was never
              more than a label. What *is* lost is a visual cue, and the lit
              border and the halo are what say the card is open in its
              absence — see the note in the handoff, which flags this as worth
              a designer's look and names keeping the rotated chevron alone at
              the header's right edge as the cheapest fix if it reads as
              un-closable. */}
          {!open && <DisclosureHint />}
        </summary>

        {/* The league itself, on the manager card's own arrangement: a capped
            inner housing holding the history bay, the two panes and the
            roster's drawer — and now on the manager card's own sizing too. It
            used to be the one caller passing `parked={false}`; there is no
            such thing as an un-parked card any more. See `panelFit`. */}
        <TradeLeague
          leagueId={trade.league_id}
          season={season}
          username={username}
          teamsColumn={teamsColumn}
          open={open}
          closing={open && !lit}
          summaryFolded={summaryFolded}
          onToggleReadings={onToggleReadings}
        />
      </details>
    </li>
  );
});

/**
 * The row under the hauls that says the card opens, and onto what.
 *
 * **The closed card's alone**, since the parked header was condensed: it is
 * the press's own affordance, so once the press has been made it is a row of
 * chrome standing between the hauls and the seam. See departure 1 above, and
 * the gate at its call site.
 *
 * **A word rather than a bare chevron**, because what is behind this
 * disclosure is not more of the trade — it is the league, solved. A chevron
 * alone promises "more detail" and a reader who pressed it expecting the rest
 * of a haul would find a standings table instead; three words are what make the
 * press worth making.
 *
 * The word lights on open, so the row reads as a state rather than as a label
 * that happens to sit above an open panel. It is not a `<button>`: the
 * `<summary>` it sits inside *is* the control, and a nested one would be
 * unreliably reachable — the constraint `shares-drawer.tsx` records.
 *
 * `translateZ(10px)`, the shallowest plane on the card: it is the last thing
 * above the housing, under the hauls at 22 and the strip at 18.
 */
function DisclosureHint() {
  return (
    <div className="relative mt-3.5 flex items-center gap-2 pointer-fine:[transform:translateZ(10px)]">
      <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label transition-colors duration-300 group-data-[lit]/card:text-readout">
        The league
      </span>
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-active/22 to-transparent"
      />
      <span
        aria-hidden
        className="inline-flex text-readout-label transition-transform duration-300 group-data-[lit]/card:rotate-180"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}

/**
 * No market answered — a read in flight, or one whose board could not be. A
 * shared empty so the pane below is not handed a new array identity per render.
 */
const NO_KTC: ManagerLineupsPayload["ktc"] = [];

/**
 * The league this trade happened in, as the manager card opens it.
 *
 * **The read is behind the disclosure, and that is a bound rather than a
 * nicety.** A `<details>` hides its body rather than unmounting it, so every
 * card on a hundred-row board mounts this — and solving a league is the
 * heaviest read anything on this page makes. So `useLeagueLineup` is disabled
 * until the card is open, exactly as `useTimeline` is disabled until `History`
 * is pressed one level further in. A closed card costs nothing; an opened one
 * costs one request and keeps its answer for as long as it is on screen.
 *
 * **Two reads, one subject.** The entry and the log are asked the same
 * question — the same season, the same manager, the same column — because a
 * card's present priced on a different board from the past its own rail scrubs
 * to is not a comparison, it is two numbers on two rulers.
 *
 * **The boards come off the standings pane's own column, not off this page's
 * Value panel.** Those are two different questions and the answer is on screen
 * beside each: the panel's market is what the *asset* figures on the card above
 * are printed in, where the pane's column names the market its own head states
 * and its own totals are summed on. A pane whose head said `Dyn` over numbers
 * read on the redraft board would be the wrong-number failure this whole seam
 * is arranged against; a card printing its assets on one market above a table
 * on another is two readings, each labelled.
 *
 * **The three states under the housing are three different sentences**, and
 * collapsing them is what would make an ordinary answer look like a fault. A
 * read in flight says so, because a panel that opened onto "no rosters" for a
 * second and then filled in reads as a glitch. A failed read says so, because
 * this is the only thing behind the disclosure and a silent empty is
 * indistinguishable from a league this database has never crawled. And a league
 * that genuinely has no stored rosters gets `TimelineView`'s own empty child,
 * which is that third sentence — the rail is still drawn above it, because a
 * league with no rosters can still have a log worth reading.
 */
function TradeLeague({
  open,
  closing,
  summaryFolded,
  onToggleReadings,
  ...detail
}: {
  leagueId: string;
  season: string;
  username: string | null;
  /**
   * What the expanded card's standings pane reads — the device's own stored
   * column, threaded down rather than read here.
   *
   * A prop for the reason `basis` and `board` are: this board appends a hundred
   * rows at a time and never unmounts one, so a hook here would subscribe every
   * card to one device preference and drop the `memo` that makes the page
   * usable.
   */
  teamsColumn: LineupColumn;
  /** Whether the card's disclosure is open — see `useActiveCard`. */
  open: boolean;
  /** Whether it is closing: open for as long as the collapse takes. */
  closing: boolean;
  /**
   * Whether the card's two hauls are folded away, and the press that brings
   * them back. Forwarded only: the key is this panel's `seamStart` and the
   * hauls are the summary's, so the pair passes straight through from
   * `TradeCard` — see `SummaryReadingsKey` for why it may not sit in the
   * `<summary>` itself.
   */
  summaryFolded: boolean;
  onToggleReadings: () => void;
}) {
  // **Whether the reader has asked for this league's history.** Held here for
  // the manager card's reason, which is the same card: the key is the panel's
  // `seamEnd` and the strip it opens is `TimelineView`'s, below the cut, so the
  // latch has to sit above both. One-way, and the only thing this outer half
  // owns — everything the read costs is in `TradeLeagueLineup`, which the panel
  // still gates on `mounted`.
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <ExpandedPanel
      open={open}
      closing={closing}
      // **The key that acts on the summary leads the row and the key that acts
      // on the panel follows it**, which is the seam's own arrangement and the
      // manager and lineup checker cards' to the position. Both ends are gated
      // on `mounted` inside the panel, so a card that has never been opened
      // still puts no tab stop inside a shut disclosure.
      seamStart={
        <SummaryReadingsKey
          label="Assets"
          title="Show the two hauls on this card"
          // The panel exists only while the card is open, so "not folded" *is*
          // the preference here — the one place the composed prop reads back
          // as the boolean it was composed from.
          shown={!summaryFolded}
          onToggle={onToggleReadings}
        />
      }
      seamEnd={
        historyOpen ? undefined : (
          <TimelineHistoryKey onOpen={() => setHistoryOpen(true)} />
        )
      }
    >
      <TradeLeagueLineup {...detail} open={open} historyOpen={historyOpen} />
    </ExpandedPanel>
  );
}

/**
 * The read itself, and everything it draws.
 *
 * **Split from the latch above so a shut card mounts none of it** — see
 * `usePanelCap`'s `mounted`. The three sentences it can say are documented on
 * `TradeLeague`.
 */
function TradeLeagueLineup({
  leagueId,
  season,
  username,
  teamsColumn,
  open,
  historyOpen,
}: {
  leagueId: string;
  season: string;
  username: string | null;
  teamsColumn: LineupColumn;
  open: boolean;
  historyOpen: boolean;
}) {
  // **Whether the card has been opened, held here rather than in `TradeCard`**,
  // which is what keeps that component hook-free — its own stated design, and
  // `league-card.tsx`'s: the one interaction a card owns is the disclosure, and
  // the state anything *inside* it needs lives below it.
  //
  // **One-way.** Once a card has been opened the answer stands for as long as
  // it is mounted, so a re-render must not throw the read away and must not pay
  // for it again; the store behind `useLeagueLineup` keeps it, bounded, so even
  // a latch released by an unmount costs nothing.
  //
  // **`open` is a prop now, where this used to listen for the `<details>`' own
  // `toggle` and find it with `closest`.** That seat existed because `TradeCard`
  // had no reason to thread the disclosure's state down; it threads it now, for
  // the panel above, so a listener beside the prop would be two spellings of one
  // fact — and the `display: contents` span that anchored it is gone with it.
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);

  // `useMemo` so the identity is stable across the renders this card takes for
  // reasons that have nothing to do with its league — the subject is a
  // dependency of both reads below, and a fresh object each render is a
  // re-fetch each render.
  const subject = useMemo(
    () => ({ leagueId, season, username, column: teamsColumn }),
    [leagueId, season, username, teamsColumn],
  );
  const { payload, loading, error } = useLeagueLineup(subject, opened);

  return (
    <>
      {/* **A fragment, never a box.** `TimelineView`'s parts are the panel's
          own flex items — the strip holds its height, the browser takes the
          rest, and the two panes scroll their own lists — and a wrapper here
          would make them one item and the panel a box with a scrollbar in it.
          It would flatten the housing's perspective with them. */}
      <TimelineView
        subject={subject}
        entry={payload?.entry ?? null}
        column={teamsColumn}
        // **Off this card's own answer**, which is where the stamp is: the
        // per-league route reads one market and says which and when, so the
        // pane's picker draws its scrape line from the read it is a picker for
        // rather than from a page-wide fetch this board does not make.
        ktc={payload?.ktc ?? NO_KTC}
        // Whichever roster the reader holds here, if any — read off the answer
        // the table is drawn from, so a past stop marks the same team the
        // present one does. On this board that is usually nobody: the trades
        // are every league's, not one account's, and `solveLeagueEntry` marks
        // none of them rather than refusing to solve the league.
        managerRosterId={
          payload?.entry?.teams.find((t) => t.is_manager)?.roster_id ?? null
        }
        historyOpen={historyOpen}
      >
        {loading ? (
          <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
            Reading the league…
          </p>
        ) : error !== null ? (
          <p className="m-0 text-[length:var(--fs-12)] text-error">{error}</p>
        ) : (
          <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
            No rosters read for this league yet
          </p>
        )}
      </TimelineView>
    </>
  );
}

/**
 * When the trade went through, to the minute.
 *
 * **The minute is the point of it.** The plate used to read `Aug 28, 2026 · Wk
 * 0`, and a scoring week is a coarse, offseason-shaped answer to a question a
 * reader of a *newest-first* board is actually asking: where in today's run of
 * trades does this one sit. `completed_at` is already epoch ms on the payload,
 * so this is a formatting change and nothing more.
 *
 * **An undated trade says so in words rather than drawing an empty plate.**
 * Sleeper files a few with neither timestamp, and they sort to the bottom of
 * the board by the same rule; a blank where every other card carries a date
 * reads as a rendering fault.
 */
function TradeDate({ at }: { at: number | null }) {
  // No well at all rather than an empty one: a drawn-and-empty recess where
  // every other card carries a figure reads as a rendering fault, which is the
  // same argument the word itself is here for.
  if (at === null) return <DateBillet day="Undated" />;

  return (
    <DateBillet
      day={
        <>
          {/* **The year comes off the face below `sm`**, which a render at 390
              forced back when this was a plate: the board answers one season by
              construction, so the year is the most redundant token on it. The
              billet has bought most of that width back and the rule is kept
              anyway — the day is the coarse half of a two-part reading, and a
              third token on it is width the league's name is still paying for.
              Drawn as two spans and switched by the cascade rather than by
              state, which keeps this component free of a breakpoint it would
              have to hydrate to learn. */}
          <span className="sm:hidden">
            {formatInstantDate(at, { year: false })}
          </span>
          <span className="hidden sm:inline">{formatInstantDate(at)}</span>
        </>
      }
      // The two halves are formatted separately rather than taken from one
      // `toLocaleString`, which glues them with a second comma — `Aug 28, 2026,
      // 9:42 PM` reads as a three-part list where the part is saying two
      // things. They used to be joined on the console's own separator; the
      // billet is what separates them now, which is the whole of it: the day is
      // stamped on the face and the minute is dropped into a well cut under it.
      minute={formatInstantTime(at)}
    />
  );
}

/**
 * One roster's half: who they are, what it is worth, what came in and out.
 *
 * **One window, at one size, whether the card is open or shut.** It drew two
 * further readings of itself while the parked header was a condensed one — a
 * take-track-only window at tighter insets, and a chrome-less *bay* of the one
 * exchange window a two-sided open card used to carry — and both went with the
 * fold. What replaced them is nothing: an open card's hauls are folded away
 * whole and come back whole, so there is one arrangement of a haul left and no
 * second shape for a reader to learn. See `TradeCard`'s departure 1.
 */
function SideColumn({
  trade,
  side,
  view,
  leagueType,
}: {
  trade: Trade;
  side: TradeSide;
  view: TradeCardView;
  /** The league's Sleeper `settings.type`, or null before its row arrives. */
  leagueType: number | null;
}) {
  // The reader's basis and market land here — the consumer that computes a
  // figure — rather than on the card, so a flip of either re-renders these two
  // windows and not the memo'd card around them. See `value-lens-context`.
  //
  // The format is resolved here rather than on the server, because the payload
  // carries every basis and both markets and only this card knows which league
  // it is — see `asset-value`. A league whose row has not arrived reads as
  // `auto`'s non-dynasty case, which prices nothing wrongly: both markets are
  // on the wire, and the one it lands on is corrected the moment the leagues
  // request answers.
  const { basis, board } = useValueLensChoice();
  const lens: ValueLens = {
    basis,
    format: resolveKtcFormat(board, leagueType),
  };
  const manager = side.user_id ? view.managers[side.user_id] : undefined;
  const received = receivedBundle(side);
  const given = givenBundle(trade, side);

  return (
    <section
      className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.6875rem] px-[15px] pb-[15px] pt-3.5`}
    >
      <Scanlines />

      <header className="relative mb-[13px] flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 truncate font-mono text-[length:var(--fs-12)] uppercase tracking-[0.12em] text-readout">
          {/* Sleeper lets a display name go missing and leaves orphan rosters
              with no owner at all, so the roster number is the fallback — a
              real label, not a placeholder. */}
          {manager?.display_name ?? `Roster ${side.roster_id}`}
        </span>
        {/* The unit, because the three bases are three scales and a figure
            that changed when the reader flipped the panel would otherwise be
            indistinguishable from one that moved. It is the same rule the
            manager card's lens keys live by — three figures on three scales
            never share a column without one.

            **The `title` is what says the KTC figures are *today's*.** This
            board is history, and a value printed beside a 2021 trade reads as
            what the assets were worth then; there is no stored market history
            to make that true, so the card says which market it is on instead.
            A sentence per card would be three words of unit under a paragraph
            of caveat — see `TRADE_BASIS_NOTES`, and `ValuePanel`, which states
            it in full for a reader who opens it. */}
        <span
          title={TRADE_BASIS_NOTES[lens.basis]}
          className="ml-auto shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label"
        >
          {TRADE_BASIS_UNITS[lens.basis]}
        </span>
        {/* What the haul is worth, or `—` where nothing in it could be priced.
            Never `0` — see `asset-value` for why that would be a claim.

            **Never coloured**, whatever the assets under it are doing. The
            colour on this card is a statement about one asset's standing among
            its league's; a coloured total would be a statement about who won
            the trade, which this card rules out by name above. */}
        <span
          className="shrink-0 font-mono text-[length:var(--fs-18)] tabular-nums text-readout"
          // **Struck into the glass rather than printed on it**, which is the
          // one thing about this figure the console-card pass left flat: every
          // other headline reading in the app is engraved (`--figure-engrave`)
          // and this was a glow alone. The halo stays beside it, so the figure
          // still reads as lit — a cut with no light in it is a label.
          //
          // A `style` rather than a class because the two are one `text-shadow`
          // list: a second declaration would replace the first rather than
          // composing with it, and which one won would be emit order.
          style={{
            textShadow: "var(--figure-engrave), 0 0 22px var(--accent-glow)",
          }}
        >
          {formatAssetValue(
            bundleValue(trade.league_id, received, view.assetValues, lens),
          )}
        </span>
      </header>

      <AssetTrack
        direction="in"
        bundle={received}
        trade={trade}
        side={side}
        view={view}
        lens={lens}
      />
      {/* A three-way trade has no knowable gives: `givenBundle` answers null
          for one, so those cards draw the take column alone. Every two-sided
          card draws both tracks at all times — the give track was dropped
          while the card was parked, on the argument that a give line is the
          other side's take line and the window opposite states the same
          assets, and it came back with the fold: an open card's hauls are not
          drawn at all, so there is nothing left to shorten. */}
      {given && (
        <>
          <span
            aria-hidden
            className="relative my-3 block h-px bg-gradient-to-r from-active/30 to-active/[0.04]"
          />
          <AssetTrack
            direction="out"
            bundle={given}
            trade={trade}
            side={side}
            view={view}
            lens={lens}
          />
        </>
      )}
    </section>
  );
}

/**
 * One direction's lines: a sign, the asset, what it is worth, and — on the take
 * track alone — where that figure stands in its own league.
 *
 * The give track is drawn whole in `--readout-muted` and the take track is not,
 * which is how a card that says everything twice still reads take-first. **The
 * give track carries no notes** — no position, no team, no pick origin — for
 * the same reason: the take track opposite already carries them, and a second
 * copy is the noise that would make the two halves compete.
 *
 * **The colour and the meter land on the take track only**, and that is the
 * same rule one step on rather than a new one. A give line is the other side's
 * take line; colouring both would draw every asset on a two-sided card twice,
 * in two places, in the same hue — and the card would stop reading take-first,
 * which is the one thing its redundancy is paid for by.
 *
 * **The list is the same list whether the card is open or shut.** It used to
 * become a fixed-height scroller with its notes and meters dropped while the
 * card was parked, which is what kept the condensed header from growing with
 * the trade; the hauls fold away whole now, so the header does not grow with
 * the trade either — it is not there. The row is what it always was: a
 * three-column grid, its second row the meter, nothing gated on the card's
 * own state. See `TradeCard`'s departure 1.
 */
function AssetTrack({
  direction,
  bundle,
  trade,
  side,
  view,
  lens,
}: {
  direction: "in" | "out";
  bundle: TradeBundle;
  trade: Trade;
  side: TradeSide;
  view: TradeCardView;
  lens: ValueLens;
}) {
  const inbound = direction === "in";
  const tone = inbound ? "text-readout-line" : "text-readout-muted";
  // Two rows per line on the take track: the line itself, and a meter under the
  // figure. `items-baseline` on a two-row grid would align the meter to the
  // text baseline of a row it is not on, so the alignment moves onto the cells
  // that need it.
  const row = `grid grid-cols-[11px_minmax(0,1fr)_auto] gap-x-2 gap-y-[5px] text-[length:var(--fs-13)] ${tone}`;
  // The sign and the name are `contents` so both land in the grid's own
  // columns: the sign in the 11px track and the name in the `1fr` beside it.
  const line = "contents";
  const signTone = inbound ? "text-active" : "text-readout-muted";
  const sign = inbound ? "+" : "−";

  if (isEmptyBundle(bundle)) {
    // A real case in a three-way: a roster can send a player one way and take
    // nothing back from that participant. Saying "nothing" is the answer; an
    // absent track would read as a card that failed to draw.
    return (
      <p className="relative m-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
        {inbound ? "Received nothing" : "Gave nothing"}
      </p>
    );
  }

  return (
    <ul className="relative m-0 flex list-none flex-col gap-[9px] p-0">
      {bundle.players.map((id) => {
        const player = view.players[id];
        return (
          <li key={`p${id}`} className={row}>
            <span className={line}>
              <span aria-hidden className={`shrink-0 font-mono ${signTone}`}>
                {sign}
              </span>
              <span className="min-w-0 truncate">
                {/* The id is the fallback rather than a blank: it is a visible,
                    searchable token when the stored players map is behind
                    Sleeper's. */}
                {player?.name ?? id}
                {inbound && player?.position && (
                  <span className="ml-[7px] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
                    {player.position}
                    {player.team ? ` · ${player.team}` : ""}
                  </span>
                )}
              </span>
            </span>
            <AssetFigure
              price={assetPrice(trade.league_id, id, view.assetValues, lens)}
              lit={inbound}
            />
          </li>
        );
      })}

      {bundle.picks.map((pick, i) => {
        const slot =
          view.pickSlots[
            pickSlotKey(trade.league_id, pick.season, pick.roster_id)
          ] ?? null;
        // The origin is drawn exactly when it is a *surprise* — a pick that did
        // not come from the roster handing it over. Printing "from X" beside a
        // pick X just gave away is noise on most cards that carry one.
        const origin = pickOriginRoster(
          pick,
          inbound
            ? // For the take track the giver is the counterparty, which
              // `givenBundle`'s own rule already knows how to find; a
              // three-way makes it unknowable, and then the origin always
              // prints, which is the honest answer.
              (trade.sides.length === 2
                ? (trade.sides.find((s) => s.roster_id !== side.roster_id)
                    ?.roster_id ?? null)
                : null)
            : side.roster_id,
        );
        const from = origin === null ? null : view.managers[pick.user_id ?? ""];

        return (
          <li
            key={`k${pick.season}-${pick.round}-${pick.roster_id}-${i}`}
            className={row}
          >
            <span className={line}>
              <span aria-hidden className={`shrink-0 font-mono ${signTone}`}>
                {sign}
              </span>
              <span className="min-w-0 truncate">
                {pickLabel(pick, slot)}
                {inbound && origin !== null && (
                  <span className="ml-[7px] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
                    {/* Named as a *person*: "from" points at who traded it
                        away, where the side header prefers whatever the manager
                        is called. A roster with no stored owner keeps its
                        number. */}
                    from {from?.display_name ?? `Roster ${pick.roster_id}`}
                  </span>
                )}
              </span>
            </span>
            <AssetFigure
              price={assetPrice(trade.league_id, pick, view.assetValues, lens)}
              lit={inbound}
            />
          </li>
        );
      })}

      {bundle.faab > 0 && (
        <li className={row}>
          <span className={line}>
            <span aria-hidden className={`shrink-0 font-mono ${signTone}`}>
              {sign}
            </span>
            {/* In the league's own units, which Sleeper does not name — so the
                figure carries the label rather than a currency symbol. */}
            <span className="min-w-0 truncate">{bundle.faab} FAAB</span>
          </span>
          {/* A dash rather than a number, permanently and on every basis: FAAB
              is a league's own currency, and neither a market, a draft board
              nor a projection prices one. */}
          <AssetFigure price={null} lit={inbound} />
        </li>
      )}
    </ul>
  );
}

/**
 * One asset's figure, and — where it has a place in its league — the ramp
 * colour and the meter that say where.
 *
 * **The colour is `rankColor` and the width is `rankFill`, both off the one
 * rank the payload shipped.** That is the whole reason the server sends a
 * `{rank, of}` rather than a percentile: these are the same two functions the
 * manager card's rank tiles are drawn from, so a bar and a hue on this board
 * cannot disagree with each other, and neither can disagree with the same
 * asset's tile one page over.
 *
 * **`rankPercentile` and not `rankFill` for the hue**, which is the trap that
 * module exists to mark: `rankFill` answers 0 to two different questions — last
 * in the league, and nothing to rank — and the meter is right to draw both
 * empty where the ramp is not. An absent place painted full red would claim a
 * result nobody finished.
 *
 * A give line is drawn muted and gets neither, which is `AssetTrack`'s rule.
 * An unpriced asset is an em dash with no track under it at all: a meter under
 * a dash would be a zero-width bar, and a zero-width bar is exactly the reading
 * "worst in the league" that the dash is there to avoid making.
 *
 * The colour and the meter used to part company while the card was parked —
 * the hue costs a line nothing where the meter is a whole second grid row per
 * asset — and they do not any more: an open card's hauls fold away rather than
 * shortening, so there is no reading of this figure but the one. See
 * `TradeCard`'s departure 1.
 */
function AssetFigure({
  price,
  lit,
}: {
  price: { value: number; rank: MetricRank | null } | null;
  /** The take track. A give line carries the figure and nothing else. */
  lit: boolean;
}) {
  const rank = lit ? (price?.rank ?? null) : null;
  const percentile = rankPercentile(rank);
  const colour = rankColor(percentile);

  return (
    <>
      <span
        className="font-mono text-[length:var(--fs-12-5)] tabular-nums"
        style={
          lit && percentile !== null
            ? { color: colour, textShadow: `0 0 10px ${rankColor(percentile, 0.55)}` }
            : undefined
        }
      >
        <span
          className={
            lit && percentile !== null
              ? ""
              : lit
                ? "text-readout [text-shadow:0_0_9px_var(--accent-glow)]"
                : "text-readout-muted"
          }
        >
          {formatAssetValue(price?.value ?? null)}
        </span>
      </span>
      {rank !== null && (
        // The meter spans the name and figure columns rather than sitting under
        // the figure alone: at a phone's width a figure column is four
        // characters wide, and a bar that narrow reads as a tick rather than as
        // a scale. Capped so it stays a meter on a wide card instead of
        // becoming a rule across the window.
        <span
          aria-hidden
          className="col-start-2 col-span-2 h-1 w-full max-w-[9rem] justify-self-end overflow-hidden rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${rankFill(rank)}%`, backgroundColor: colour }}
          />
        </span>
      )}
    </>
  );
}

/**
 * A league's Sleeper `settings.type`, or null where the row has not arrived.
 *
 * Guarded rather than cast: `settings` is the raw blob and every reader of it
 * in this app checks the shape before trusting a value. Null falls to `auto`'s
 * non-dynasty arm, which is the right reading of "we do not know yet" — the
 * redraft board is the conservative one, and the card corrects itself the
 * moment `/api/trades/leagues` answers.
 */
function leagueType(league: ManagerLeague | null): number | null {
  const type = league?.settings?.type;
  return typeof type === "number" ? type : null;
}

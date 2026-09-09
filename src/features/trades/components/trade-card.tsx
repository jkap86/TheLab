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
  CONSOLE_FIGURE_WELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  DateBillet,
  ExpandedPanel,
  formatInstantDate,
  formatInstantTime,
  LeagueConfigWindow,
  LeagueFormatTags,
  LeagueBillet,
  rankColor,
  rankFill,
  rankPercentile,
  Scanlines,
  shortName,
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
 * 1. **This card parks like the other two, and the open header is a shorter
 *    reading of the same hauls — which is what pays for it.** It used to park
 *    with the header it wears closed: both hauls in full, measured 413px of
 *    which the two windows were ~279, so at a 900px viewport the panel got
 *    ~376px against a league card's ~565, and at 800 the room fell under
 *    `MIN_PARKED` and the *shell* scrolled instead. That is the documented
 *    fallback rather than a failure, but this was the only card that reached
 *    it on an ordinary laptop. The alternative was flagged here rather than
 *    taken — condense the hauls while parked — and it has since been taken.
 *
 *    **What went is the redundant half and the tall half, and nothing that
 *    names an asset.** The give track went because a give line is the other
 *    side's take line, and the redundancy this card's own note argues for is
 *    paid for by a board where a card is read in passing; parked, there is no
 *    list to read it among and the other window is beside it. The meters and
 *    the notes went because each is a whole second grid row or the widest
 *    thing on a line, and the panel below the seam names every one of those
 *    players again with its position beside it. The disclosure row went
 *    because it is the affordance that says the card opens, and it is spent
 *    once open. Every asset keeps its **name and its figure**, which are the
 *    two things a haul is read for. Measured: 413px → 240.
 *
 *    **The 78px list is what that 240 is protecting**, and it is a fixed
 *    `height` for that reason rather than a `max-height` — see `AssetTrack`.
 *    A header that grew with the trade would put the panel's cap back on the
 *    trade's contents: one height on a one-for-one and another on a six-for-
 *    two, with `MIN_PARKED` reachable again on the fat ones and nothing on
 *    screen saying which card was which. Constant is the property; three rows
 *    is what it happens to hold.
 *
 *    The condensing is **render-gated on `open`**, which is the prop this card
 *    already has, threaded down as `condensed`. Not a new prop, which would
 *    drop the `memo` for every row on the board — and not a `group-open/card:`
 *    variant either, which would have to carry the list's height, its
 *    overflow, its two paddings and its gap as five overrides against the
 *    closed card's own. `open` is true for the whole collapse, exactly as
 *    `[open]` is, so the header expands back at the moment the card shuts
 *    rather than under the animation.
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
}) {
  // The league's own type, read once here and handed to both side columns,
  // which resolve the reader's market against it — see `SideColumn`. Null
  // until the leagues request lands.
  const type = leagueType(league);
  // Whether the two hauls are drawn as one exchange window rather than as two
  // windows in a grid — see the note at the call site for why a third side is
  // not one of these.
  const exchange = open && trade.sides.length === 2;

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
            "relative flex shrink-0 cursor-pointer list-none flex-col font-mono " +
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

          {/* The hairline, and — while the card is open — the format the
              settings strip below it is no longer there to state.

              **The strip collapses onto this row rather than being kept.** It
              is a 30px part plus its 12px margin, and eleven of its twelve
              readings are said again by the panel under the seam *by
              construction*: twelve standings rows are the team count and nine
              seat rows are the starters. What no table below states is which
              game is being played, so the format group moves onto a row that
              was carrying a 92px hairline and nothing else, and the card is
              ~20px of its 42 up on the deal. It is
              `LeagueConfigWindow`'s own group, read from the same rules — see
              `LeagueFormatTags` — never two tags assembled here.

              This is the same "spent once open" argument the give track and
              `DisclosureHint` are already gated on, and it is gated the same
              way: on `open`, which is a prop this card already has, so nothing
              new drops the `memo` for every row on the board.

              The row is only a row while the tags are on it; closed, the rule
              is the single child it has always been. */}
          {league && open ? (
            // **The row carries `preserve-3d` and no transform of its own, and
            // each child names its own plane.** A plain wrapper is a flat
            // rendering context, so a `translateZ` written here would collapse
            // `CardRule`'s own 36px into it and the hairline would sit at the
            // tags' depth — with no error to say so, which is the failure this
            // card's decorative layer and the manager card's tile row are both
            // arranged around. The rule keeps the plane it has closed; the tags
            // take the strip's 18px, which is what they stand in for.
            <div className="relative flex items-center gap-[9px] pointer-fine:[transform-style:preserve-3d]">
              <CardRule />
              <span className="relative ml-auto inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap pointer-fine:[transform:translateZ(18px)]">
                <LeagueFormatTags league={league} />
              </span>
            </div>
          ) : (
            <CardRule />
          )}

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

              **And only while the card is closed**, per the rule row above. */}
          {league && !open && (
            <LeagueConfigWindow
              league={league}
              className="mt-3 sm:mt-3.5 pointer-fine:[transform:translateZ(18px)]"
            />
          )}

          {/* The hauls.

              **Open and two-sided, they are one window cut into two bays**, and
              the reason is a reading rather than the 5px of content one border
              and one pair of insets buys back: two windows side by side are two
              instruments competing, where a trade is *one exchange*. It is the
              same argument `Pane` makes for the two panes below the seam.

              **A three-way keeps two windows — or three — and that is a
              measurement.** The groove is `left-1/2`, which lands on the
              boundary only because two bays are exactly equal; three bays at
              390 is ~89px of content each, which the two-line row below will
              not hold, and a clipped surname is the failure this whole pass
              exists to remove. So the exchange window is drawn for exactly two
              sides and a three-way keeps the arrangement it has always had —
              stacked below `sm`, two-up above — which is also the arrangement
              its own missing gives already made it a different card in. Flagged
              in the handoff as wanting a decision; this is it, and horizontally
              scrolling bays is the alternative if a third bay is ever wanted.

              Closed, both arms are the grid: a card in a list is read side by
              side above `sm` and stacked below it, which is the width every
              window on this board has always had. */}
          {exchange ? (
            <section
              className={`${CONSOLE_WINDOW} mt-3.5 rounded-[0.6875rem] px-2.5 pb-[13px] pt-3 pointer-fine:[transform:translateZ(22px)]`}
            >
              <Scanlines />
              {/* `items-stretch` so both bays are the groove's full height
                  whatever either holds, and `relative` for the groove itself. */}
              <div className="relative flex items-stretch">
                {trade.sides.map((side) => (
                  <SideColumn
                    key={side.roster_id}
                    trade={trade}
                    side={side}
                    view={view}
                    leagueType={type}
                    condensed
                    bay
                  />
                ))}
                {/* **One absolutely-positioned child of the row, never a border
                    on either bay.** Absolute so it consumes no width — which is
                    what keeps the two bays exactly equal — and `left-1/2` lands
                    it on the boundary *because* they are. A border on one bay
                    would make that bay 1px narrower than the other, and the two
                    hauls would set at two different widths on a card whose
                    whole point is that they are one exchange. */}
                <span
                  aria-hidden
                  className="absolute bottom-0 left-1/2 top-0 w-px bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
                />
              </div>
            </section>
          ) : (
            <div className="relative mt-3.5 grid gap-4 sm:grid-cols-2 pointer-fine:[transform:translateZ(22px)]">
              {trade.sides.map((side) => (
                <SideColumn
                  key={side.roster_id}
                  trade={trade}
                  side={side}
                  view={view}
                  leagueType={type}
                  condensed={open}
                />
              ))}
            </div>
          )}

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
 * **Condensed, this window is the take track alone at a fixed height**, which
 * is the whole of what shortens the parked header — see `TradeCard`'s note on
 * departure 1. The give track and the rule above it are not drawn, the padding
 * and the header's own margin come in by two pixels each, and the list becomes
 * a fixed-height scroller. Everything the window *says* about the haul it
 * keeps: the manager, the unit, the total, and every asset's name and figure.
 *
 * **A bay is that reading again with the chrome taken off**, because the two
 * hauls of a two-sided open card are one window rather than two — see the
 * exchange window at the call site. It is the same component and not a second
 * one for the reason the window and the chip rail are two arrangements of one
 * `readLeagueConfig`: a haul stated one way in a window and another in a bay is
 * a card that would drift the first time either was edited. What differs is a
 * surface (no border, no ground, no scanlines of its own — the window carries
 * one for both bays) and, below `lg`, a set of two-line rows.
 *
 * **The two-line arm turns at `md`, and that number is measured rather than
 * borrowed from the panes.** The header is the question — the rows fit long
 * before it does — and what one line of it needs is the manager's name at the
 * window's own `0.12em`, the unit, the total and two gaps: **259.8px**. Against
 * the bay's own content box:
 *
 * | viewport | bay content | one line needs |
 * | --- | --- | --- |
 * | 390 | 136.4 | 259.8 — two lines |
 * | 640 | **249.0** | 259.8 — **short by 10.8**, two lines |
 * | 768 | **313.6** | 259.8 — clears by 53.8, one line |
 * | 1024 | 442.7 | 259.8 |
 *
 * So `sm` is the arm that looks right and is ten pixels wrong, and `lg` — the
 * breakpoint the seat rows and the standings rows below the seam turn on —
 * leaves a 768px card stacking a figure under a name in a 314px bay, which is a
 * bay half empty. `md` is the first width the reading actually fits.
 *
 * The one-line arm is the window's own header, so a name longer than the
 * fixture's truncates there exactly as it always has in a window; what the
 * threshold buys is that the *ordinary* name is whole. Below it nothing
 * truncates at all — see `shortName`.
 */
function SideColumn({
  trade,
  side,
  view,
  leagueType,
  condensed,
  bay = false,
}: {
  trade: Trade;
  side: TradeSide;
  view: TradeCardView;
  /** The league's Sleeper `settings.type`, or null before its row arrives. */
  leagueType: number | null;
  /** The card is open — see `AssetTrack` for what the word buys. */
  condensed: boolean;
  /**
   * This haul is a bay of the one exchange window rather than a window of its
   * own. Implies {@link condensed} — only an open card draws bays — but is a
   * second boolean because it names a second thing: `condensed` is *what the
   * haul says*, and this is *what it is drawn in*. A three-way open card is
   * condensed and has no bays.
   */
  bay?: boolean;
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

  const Housing = bay ? "div" : "section";

  return (
    <Housing
      className={
        // **Three whole strings, never a base plus overrides.** A bay and a
        // window differ in surface, radius, padding and flex, and two base
        // utilities of the same specificity are decided by Tailwind's emit
        // order rather than by the ternary — the trap `CONSOLE_CARD_SHELL` and
        // `CONSOLE_KEY_PILL` are both split to keep a part out of.
        //
        // A bay's own insets are 10px against a window's 15: that is what a bay
        // *inside a window* costs where a window inside a housing costs 15, and
        // it is where the 5px of content the single window buys back comes
        // from. `flex-1` with `min-w-0` is what makes the two exactly equal,
        // which is what lets the groove sit at `left-1/2`.
        bay
          ? "flex min-w-0 flex-1 flex-col px-2.5"
          : `${CONSOLE_WINDOW} min-w-0 rounded-[0.6875rem] px-[15px] ` +
            // Two pixels off each of the vertical insets, which is four of the
            // ~173 this window sheds when the card opens.
            (condensed ? "pb-[13px] pt-3" : "pb-[15px] pt-3.5")
      }
    >
      {/* The bays share the exchange window's one overlay — see the call site.
          A second copy inside each would double the scanlines' opacity on the
          two thirds of the window they cover. */}
      {!bay && <Scanlines />}

      <header
        className={
          // **A bay's header takes two lines below `lg`** — the manager on the
          // first, the unit and the total on the second — because 134px sets
          // one of the three and not all of them. At `lg` it is the window's
          // own one-line header again, through `md:contents` on the wrapper
          // holding the second line: rendering both shapes and hiding one would
          // put every header in the DOM twice and read each of them twice to
          // anything listening.
          "relative flex min-w-0 " +
          (bay
            ? "flex-col gap-[3px] mb-2.5 md:flex-row md:items-baseline md:gap-2.5"
            : "items-baseline gap-2.5 " + (condensed ? "mb-2.5" : "mb-[13px]"))
        }
      >
        <span
          className={
            "min-w-0 truncate font-mono text-[length:var(--fs-12)] uppercase text-readout " +
            // **The tracking is the first thing a narrow bay gives up**, which
            // is the letter-spacing-first rule `DRAWER_BAR` already records:
            // `Sunday Scaries` at `--fs-12` needs 138px of a 134px bay at
            // `0.12em` and 116 at `0.04em`, so four hundredths of an em is a
            // name that fits against a name that is cut. The window's own
            // spacing comes back with the room at `lg`.
            (bay ? "tracking-[0.04em] md:tracking-[0.12em]" : "tracking-[0.12em]")
          }
        >
          {/* Sleeper lets a display name go missing and leaves orphan rosters
              with no owner at all, so the roster number is the fallback — a
              real label, not a placeholder. */}
          {manager?.display_name ?? `Roster ${side.roster_id}`}
        </span>
        <span
          className={
            bay ? "flex min-w-0 items-baseline gap-1.5 md:contents" : "contents"
          }
        >
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
          className={
            "shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label " +
            // On a bay's second line the unit *leads* and the total is what is
            // pushed right; on the one-line header it is the unit that takes
            // the slack after the name. So the auto margin swaps sides with the
            // layout — and it swaps as a responsive variant of the same
            // property rather than as two base utilities, which is what makes
            // the media query, not the emit order, decide.
            (bay ? "md:ml-auto" : "ml-auto")
          }
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
          className={
            "shrink-0 font-mono text-[length:var(--fs-18)] tabular-nums text-readout " +
            // `leading-none` on the stacked arm: the figure is the tallest
            // thing on the bay's second line, and its own line box is what
            // would otherwise set that line's height.
            (bay ? "ml-auto leading-none md:ml-0" : "")
          }
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
        </span>
      </header>

      <AssetTrack
        direction="in"
        bundle={received}
        trade={trade}
        side={side}
        view={view}
        lens={lens}
        condensed={condensed}
        bay={bay}
      />
      {/* **The give track and the rule above it are the parked header's
          largest single saving, and dropping them costs a two-sided card
          nothing it does not say twice.** A give line *is* the other side's
          take line — the redundancy this card's note argues for, and which is
          paid for on a board where a card is read in passing among a hundred
          others. Parked, there is no list to read it among: the other window
          is beside it, filling half the screen, and its take track states the
          same assets. So what a screen-reader user hears on a parked card is
          each asset once rather than twice, which is the reading a sighted one
          gets too.

          A three-way trade is unaffected either way: `givenBundle` answers
          null for one, so those cards have always drawn the take column
          alone. */}
      {given && !condensed && (
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
            condensed={condensed}
          />
        </>
      )}
    </Housing>
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
 * **Condensed, the track is a 78px scroller and the lines lose their notes.**
 * Three things go and each is the widest or the tallest thing on a line: the
 * meter, which takes a second grid row; the position and team; and a pick's
 * origin. What every line keeps is its name and its figure, which are the two
 * things the card is read for — and the panel below the seam names every one
 * of those players again, in a table, with its position beside it.
 *
 * **78px is a fixed `height`, never a `max-height`, and the fixedness is the
 * whole point of it.** A `max-height` would let a one-for-one trade shrink the
 * header, which puts the panel's cap back on the trade's contents: the header
 * would be one height on a small trade and another on a fat one, `MIN_PARKED`
 * would be reachable again on the fat ones, and the thing this condensing
 * exists to remove would be back with nothing on screen saying so. Measured,
 * a one-for-one and a six-for-two both park at 247.9px.
 *
 * **What 78 actually holds is two rows and most of a third**, and the handoff's
 * own arithmetic for it is wrong in a way worth writing down rather than
 * quietly fixing. It reasons from a ~19px row; a row is `--fs-13` at
 * `line-height: normal`, which in IBM Plex Mono is **22.8px** at the 1.16 type
 * scale and 22.2 at 1.14 — so three rows and their two gaps are 82.5px, not
 * 78, and at 78 the third row is clipped at 84%. The prototype sets the same
 * font-size and the same `normal`, so it draws exactly this; the number is the
 * drawn design and the sentence beside it is the part that does not hold. It
 * is kept because a clipped row is the strongest thing on the card that says
 * the list scrolls, and because the property the number is load-bearing for is
 * that it does not move. Flagged for the designer: 82px is what "three rows
 * whole" costs, and it is one literal.
 *
 * The 7px right padding is the scrollbar's gutter, so a five-figure value's
 * last digit clears the thumb — the same measurement the standings glass makes
 * at 11px and the roster glass at 9.
 */
function AssetTrack({
  direction,
  bundle,
  trade,
  side,
  view,
  lens,
  condensed,
  bay = false,
}: {
  direction: "in" | "out";
  bundle: TradeBundle;
  trade: Trade;
  side: TradeSide;
  view: TradeCardView;
  lens: ValueLens;
  /**
   * The card is open, so draw the parked header's shorter reading. Derived
   * from `TradeCard`'s own `open` rather than being a second piece of state,
   * and named for what it *does* here: at this depth "open" would be a
   * question about something three components up, where "condensed" is the
   * rule these lines are drawn by.
   */
  condensed: boolean;
  /** These lines are in a bay of the exchange window — see `SideColumn`. */
  bay?: boolean;
}) {
  const inbound = direction === "in";
  const tone = inbound ? "text-readout-line" : "text-readout-muted";
  // Two rows per line on the take track: the line itself, and a meter under the
  // figure. `items-baseline` on a two-row grid would align the meter to the
  // text baseline of a row it is not on, so the alignment moves onto the cells
  // that need it. Condensed there is no meter, so there is no second row for a
  // `gap-y` to open.
  //
  // **A bay's line takes two lines below `lg`** — the sign and the name on the
  // first, the figure right-aligned in its own well on the second — because a
  // 134px bay sets one of the three and not all of them. It is a flex column
  // there and a flex row at `lg`, with no grid on either arm: the grid's whole
  // job was the meter's `col-start-2 col-span-2`, and a condensed line has no
  // meter. See `AssetFigure`.
  const row = bay
    ? `flex min-w-0 flex-col gap-0.5 text-[length:var(--fs-13)] md:flex-row md:items-baseline md:gap-2 ${tone}`
    : `grid grid-cols-[11px_minmax(0,1fr)_auto] gap-x-2 text-[length:var(--fs-13)] ${
        condensed ? "" : "gap-y-[5px] "
      }${tone}`;
  // The sign and the name are one node with two layouts, on the `contents`
  // trick the seat rows below the seam already turn (at their own `lg`):
  // rendering both shapes and hiding one would put every asset in the DOM twice
  // and read each of them twice to anything listening.
  const line = bay ? "flex min-w-0 items-baseline gap-1.5 md:contents" : "contents";
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
    <ul
      className={
        // Two whole strings rather than a base plus overrides: `p-0` beside a
        // `pr-*` is the shorthand-against-longhand coin flip this repo has
        // recorded at three other grains, and `gap-[9px]` beside `gap-[7px]`
        // is the same flip on one axis over. `.lab-scroll-glass` is the
        // console's own glass scrollbar — see `globals.css`; it is not
        // restyled here.
        // **108px in a bay below `lg`, 78 everywhere else it is condensed**,
        // and both are fixed `height`s for the reason this component's note
        // gives: the property is that the parked header does not move with the
        // trade's contents, and a height that turns on a *width* keeps it —
        // `usePanelCap` re-measures on a resize either way. 108 is two of the
        // taller two-line rows and most of a third, which is the same reading
        // 78 gives of the one-line ones.
        condensed
          ? "lab-scroll-glass relative m-0 flex list-none flex-col gap-[7px] overflow-x-hidden overflow-y-auto pb-0 pl-0 pr-[7px] pt-0 " +
            (bay ? "h-[108px] md:h-[78px]" : "h-[78px]")
          : "relative m-0 flex list-none flex-col gap-[9px] p-0"
      }
    >
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
                {bay && player?.name ? (
                  // **An initial and a surname in a narrow bay**, and the whole
                  // name where there is room for it: a 134px bay does not hold
                  // "Amon-Ra St. Brown" and an ellipsis eats the surname, which
                  // is the half a reader identifies him by. It is the seat
                  // rows' own rule and `shortName` is the seat rows' own
                  // function — see `features/shared/format`. A pick label is
                  // not a name and never takes it.
                  <>
                    <span className="md:hidden">{shortName(player.name)}</span>
                    <span className="hidden md:inline">{player.name}</span>
                  </>
                ) : (
                  (player?.name ?? id)
                )}
                {inbound && !condensed && player?.position && (
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
              condensed={condensed}
              bay={bay}
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
                {inbound && !condensed && origin !== null && (
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
              condensed={condensed}
              bay={bay}
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
          <AssetFigure
            price={null}
            lit={inbound}
            condensed={condensed}
            bay={bay}
          />
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
 * **Condensed, the colour stays and the meter goes**, which is the same split
 * one grain finer: the hue costs the line nothing, where the meter is a whole
 * second grid row per asset and is what makes a line 24px rather than 19. The
 * standing it says is still on the line, in the ink.
 */
function AssetFigure({
  price,
  lit,
  condensed,
  bay = false,
}: {
  price: { value: number; rank: MetricRank | null } | null;
  /** The take track. A give line carries the figure and nothing else. */
  lit: boolean;
  /** The card is open — the meter is not drawn. See `AssetTrack`. */
  condensed: boolean;
  /** The line is a bay's — the figure sits in a milled well. */
  bay?: boolean;
}) {
  const rank = lit ? (price?.rank ?? null) : null;
  const percentile = rankPercentile(rank);
  const colour = rankColor(percentile);

  return (
    <>
      <span
        className={
          "font-mono text-[length:var(--fs-12-5)] tabular-nums " +
          // **A bay's figure sits in a milled well, at every width.** Below
          // `lg` it is on a line of its own under the name and a bare number
          // hanging there reads as an orphan; at `lg` it is the last cell of a
          // row, which is exactly where the standings rows and the seat rows
          // below the seam already put theirs. One treatment rather than a
          // breakpoint's worth of resets, and the one the rest of the console
          // already uses for a figure at the end of a row.
          //
          // `ml-auto` and not `self-end`, because it has to push right in both
          // directions: an auto margin absorbs the free space on the cross axis
          // of a column flex exactly as it does on the main axis of a row, so
          // one declaration serves the stacked arm and the inline one.
          (bay ? `${CONSOLE_FIGURE_WELL} ml-auto shrink-0 px-[5px] py-px` : "")
        }
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
      {!condensed && rank !== null && (
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

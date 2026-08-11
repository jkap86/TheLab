"use client";

import { memo } from "react";

import { leagueAdpBoard } from "@/features/shared/league-filters";
// The pure modules directly, never the `@/shared/ktc` or `@/shared/manager`
// barrels: this is a client component, and both re-export the `pg`-backed
// queries beside them.
import { isSuperflexLineup } from "@/shared/ktc/roster";
import { leagueAdpPool } from "@/shared/manager/adp-value";

import {
  TradeHeaderLine,
  TradeInstantLedge,
  TradeNameplate,
} from "./trade-header";
import { TradeRostersSection } from "./trade-rosters";
import { TradeSideColumn } from "./trade-side";
import type { TradeCardProps } from "./trade-card.types.ts";
import { sideSeam, sideSpansRow } from "./trade-card.utils.ts";

/**
 * One trade: which league it happened in, when, and what each side came away
 * with — beside what it handed over.
 *
 * **The card is machined rather than glass, and that is a deliberate break from
 * the other two lists.** League cards and share cards wear `LIST_ROW_SURFACE`,
 * and the point of sharing it is that three lists read as one material; this one
 * wears `.lab-slab` instead — the app bar's corner-lit block at card scale, with
 * a wall running down *and* right, a chamfered leading and trailing corner, a
 * brushed face and a static specular sweep. What buys the divergence is that a
 * trade card is not a row that opens into something: it is the whole of what it
 * has to say, four columns deep, and the depth is what sorts those columns into
 * an order. The cyan rail, the hover lift and the bloom all survive, so the card
 * still answers the pointer the way its neighbours do.
 *
 * **The card is the only object in the list, and everything else here follows
 * from that.** A side used to be a plate seated in this face — raised, walled,
 * brushed, carrying an avatar, a name and a readout, which is this card's own
 * construction one step down. One step is not enough to read as containment, so
 * on a phone, where the sides stack, the list showed a column of manager plates
 * that a reader had to pair up rather than four trades. The spacing was never
 * the problem and is worth recording: 8px between sides against roughly 32px
 * between the nearest plates of two cards is already 4:1, and it still didn't
 * read. When proximity is right and grouping still fails, the answer is weight.
 *
 * So a side is a *region* of this face (`SIDE_ZONE`), what parts two of them is
 * a full-bleed seam (`SIDE_SEAM_*`), the nameplate rides the top edge, and the
 * values are cut into the surface rather than lit on it (`.lab-engraved`). The
 * one thing none of it spends is the accent, which this page has exactly one
 * use for.
 *
 * This file is the composition root and holds only what the whole card shares:
 * which board the trade is priced on, and the two bundles every level below
 * threads (see `./trade-card.types`). Everything with markup of its own lives
 * beside it in this folder — the header, one side's plate, and the asset tracks
 * inside it.
 *
 * **It opens into the league now, which the note above used to argue against.**
 * "A trade card is not a row that opens into something" was the reason it wears
 * `.lab-slab` where its neighbours wear glass, and that reading of the *card*
 * stands: everything the card has to say is on its face, and none of it is
 * behind a disclosure. What it opens into is not more of the trade but the
 * league around it — the standings, the rosters, who else is in there — which is
 * the question a trade raises and the card cannot answer at any height. So the
 * material argument is unchanged and the press is a link to somewhere else, not
 * a chevron. Which is also why it opens a sheet rather than expanding in place:
 * see `../league-sheet`.
 *
 * **Memoised, and it is worth being exact about why — the note here used to say
 * "the list re-renders on every scroll frame", which is not what happens.**
 * `@tanstack/react-virtual` only calls back into React when
 * `[isScrolling, startIndex, endIndex]` changes, so `TradesList` re-renders when
 * the window crosses a card boundary and when a scroll gesture starts and stops
 * — not at 60Hz. What the memo is actually for survives that correction intact,
 * because the re-render it prevents is *wide* rather than frequent: every one of
 * those renders re-renders all ~26 windowed cards, and on a boundary crossing at
 * most one of them is a card that changed. The `isScrolling` flips are the pure
 * case — the whole list, twice a gesture, with every prop identical.
 *
 * It pays off only because the props really are stable, which is a property of
 * the callers and not of this file: `players`, `managers`, `ktc`, `pickKtc` and
 * `pickSlots` are one `useMemo` over the loaded pages (`use-trades`), `adp` is
 * another over the ADP panel's board, `leaguesById` is a third
 * (`use-trade-leagues`), `metric` is an entry in a module-level catalogue,
 * `steepness` is a number off the panel's store, and a `trade` is an object off
 * a cached page. Nothing here is built at the call site, so the default shallow
 * comparison is enough and a custom `areEqual` would be a second definition of
 * the same fact.
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  players,
  managers,
  metric,
  ktc,
  pickKtc,
  adp,
  adpLadders,
  steepness,
  pickSlots,
  onOpenLeague,
  rostersOpen,
  onToggleRosters,
}: TradeCardProps) {
  const lookups = { players, managers, pickSlots };
  const pricing = {
    metric,
    ktc,
    pickKtc,
    // Which KTC board this trade reads, from the league's own lineup — the
    // stream spans every crawled league, and the two boards move in opposite
    // directions at quarterback. An unsynced lineup falls to 1QB, which is what
    // `isSuperflexLineup` answers for an unknown one.
    superflex: isSuperflexLineup(league?.roster_positions ?? null),
    teams: league?.total_rosters ?? null,
    adp,
    steepness,
    // The same question one board over: which *market* this league plays in,
    // since the panel's fetch answers redraft and dynasty side by side and a
    // rookie is a first-round asset in one and undrafted in the other.
    adpBoard: leagueAdpBoard(league),
    // The ladder for that market, chosen rather than built: it is a reading of
    // the whole board, so the page memoises both and a card takes one.
    adpLadder: adpLadders[leagueAdpBoard(league)],
    // The pool the value curve is anchored to. `leagueAdpPool` already falls
    // back to a typical lineup depth for a league with no slots on file; the
    // team count needs a fallback of its own, since `adpValue` floors a pool of
    // zero at one pick and every player but the 1.01 would round to nothing —
    // a whole card of zeroes rather than a shortfall a reader can see. Twelve
    // teams is what the drawer's own preview assumes, for the same reason.
    adpPool: leagueAdpPool(
      league?.total_rosters || 12,
      league?.roster_positions ?? null,
    ),
  };

  return (
    // The nameplate hangs off the top edge, so it is a sibling of the slab and
    // the overhang is this wrapper's padding — inside the box `TradesList`
    // measures, which a negative margin would not be.
    //
    // **The whole card is the press target and this wrapper is where that
    // lives**, with no `role` and no `tabIndex` of its own — the nameplate is
    // the button, and its keyboard activation bubbles a click to here. See
    // `TradeNameplate` for why the card cannot be the button itself.
    <div
      className="relative cursor-pointer pt-3"
      onClick={() => onOpenLeague(trade)}
    >
      {/* **The top edge is one row rather than two placed parts**, which is what
          lets the league's name give way to the instant instead of to a guess.
          A plate that positions itself can only cap its own width, and what the
          name may take is whatever the timestamp doesn't — a width that is its
          own contents, and a different one for an undated trade. As two items of
          one row the negotiation is the layout's, and it holds at 390px where it
          matters. That construction is the leagues list's; see `CardLedge`.

          `pointer-events-none` is what keeps the row from eating the card: it
          spans the whole edge and sits over the face's top inset, so without it
          every press landing between the two plates would hit this instead of
          the card underneath. Each plate takes them back.

          `right-5` is 14px inside the *face's* trailing edge rather than the
          card's — the plates are siblings of the card, and 6px of that gutter is
          the slab's wall. */}
      <div className="pointer-events-none absolute left-3.5 right-5 top-0 z-10 flex items-start justify-between gap-2.5">
        <TradeNameplate name={league?.name ?? trade.league_id} />
        <TradeInstantLedge completedAt={trade.completed_at} />
      </div>

      {/* The wall, and the face standing on it. Both carry the chamfer: a wall
          that turns two corners shows a square one wherever the clip doesn't
          follow it. The face is padded at the top only — its regions run edge
          to edge so their seams can reach both walls. */}
      <div className="lab-slab lab-notch-lg">
        {/* `pt-4` clears the plates: they are 24px tall against the wrapper's
            12px of overhang, so 12px hangs into the card and the first line has
            to start below that. */}
        <article className="lab-slab-face lab-notch-lg pt-4">
          <TradeHeaderLine league={league} />

          {/* No gap: the sides are regions of one face, so what separates them
              is a cut and not the ground showing between two objects. */}
          <div className="grid sm:grid-cols-2">
            {trade.sides.map((side, i) => (
              <TradeSideColumn
                key={side.roster_id}
                side={side}
                // Which way this side is cut off the one before it, and whether
                // it takes the whole row. Both are `./trade-card.utils` now
                // rather than arithmetic here, because the pre-trade rosters
                // below draw the same grid and a cut that fell differently in
                // the two would read as a rendering fault.
                seam={sideSeam(i)}
                wide={sideSpansRow(i, trade.sides.length)}
                trade={trade}
                lookups={lookups}
                pricing={pricing}
              />
            ))}
          </div>

          {/* What each side held before the deal — the one thing the face above
              cannot say at any height. Behind a press, and fetched on it. */}
          <TradeRostersSection
            trade={trade}
            lookups={lookups}
            open={rostersOpen}
            onToggle={onToggleRosters}
          />
        </article>
      </div>
    </div>
  );
});

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { LeagueDetailPanel } from "@/features/shared/ui/league-detail";

import { useTradeTimeline } from "../hooks/use-trade-timeline";
import { timelineMoveCount, timelineRosters, timelineStop } from "../timeline";
import { TimelineRail } from "./timeline-rail";
import { TimelineRosters } from "./timeline-rosters";
import { formatTradeDate } from "./trade-card/trade-card.utils.ts";

/** Which league a trade card asked for, and where its roster half should open. */
export type OpenLeague = {
  leagueId: string;
  /**
   * Its name, or the id standing in where the league list hasn't answered.
   *
   * Resolved at the press rather than looked up here, so the bar names whatever
   * the card the reader pressed was naming — the two cannot disagree about a
   * league whose entry arrived between the press and the render.
   */
  name: string;
  /** The roster to open on — see `focusRosterFor`. */
  rosterId: number | null;
  /**
   * The trade that was pressed — what the sheet's timeline is anchored on.
   *
   * The rail runs from this trade to today, so without one there is no rail: a
   * sheet opened from anywhere that is not a trade card is the detail panel and
   * nothing else, which is what it was before the timeline existed.
   */
  tradeId: string;
};

/**
 * A league's standings and rosters, over the trades board.
 *
 * **The board opens a card rather than expanding one, and that is the one place
 * this parts company with the leagues list.** A league card expands in place
 * because the list under it is ordinary flow: the card pins itself under the app
 * bar, caps at the viewport and scrolls its panel inside itself. None of that is
 * available here — `TradesList` windows the season, so a card is an absolutely
 * positioned item inside a transformed box, where `sticky` resolves against the
 * item rather than the page and a several-hundred-row panel would be a measured
 * height change on every open. A sheet leaves the virtualizer alone entirely: the
 * board keeps its scroll position, its measurements and its place in the season,
 * and closing puts the reader back exactly where they pressed.
 *
 * It is the shares sheet's material and the shares sheet's rules, for the same
 * reasons stated there. **Glass on the frame**, because a translucent panel is
 * what says the board is still underneath rather than navigated away from — and
 * the panel itself sits on an opaque plate, since a standings table read over a
 * hundred cards drifting behind it is the one thing the effect must not buy. And
 * **a native `<dialog>`**, so the top layer, the focus trap, Escape and a press
 * outside are the platform's rather than three listeners of our own.
 *
 * **Including the rule the shares sheet had to learn: `onClose` tests its
 * target.** The panel inside opens a dialog of its own — the columns editor, one
 * per table — and React walks its own tree for `close`, which does not bubble in
 * the DOM, so an unguarded handler here would take this sheet down with the
 * editor a reader had just dismissed. The backdrop test below needs no such
 * guard: a press inside a nested dialog never reaches this box at all.
 *
 * The panel is mounted only while the sheet is open. That is what keeps
 * `focusRosterId` a seed rather than a prop to be watched: a second press always
 * arrives at a fresh mount, so there is no stale selection to reconcile and no
 * key to remember to set. It costs nothing — the detail is a cached query by the
 * second open, so a remount re-reads the cache rather than the network.
 *
 * **It carries a timeline now, and that is where the card's pre-trade rosters
 * went.** A disclosure on the card answered what the two sides held before the
 * deal; the sheet answers what *every* roster held at *any* moment from the trade
 * to today, which is the same question with both of its limits removed. The rail
 * is {@link TimelineRail} and the past is {@link TimelineRosters}; what makes
 * them affordable is that one request buys every stop (see `../timeline`).
 *
 * **At "now" the sheet is byte-for-byte what it was**, which is the promise the
 * whole arrangement is arranged around: the rail opens at the present, the panel
 * below it is the same panel with the same props, and a reader who never touches
 * the slider sees no change at all. Only stepping back swaps the body — and it
 * *swaps* rather than substituting a roster list into the panel, because every
 * number that panel draws is a fact about the league today. See
 * {@link TimelineRosters} for why laying a past roster under them would be a
 * claim rather than a reading.
 */
export function LeagueSheet({
  league,
  meta,
  open,
  onClose,
}: {
  /** What was pressed, or null before anything has been. */
  league: OpenLeague | null;
  /** The league as the board knows it, for the status line — null until it does. */
  meta: ManagerLeague | null;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Generated rather than literal, for the reason every dialog here generates
  // one: a hardcoded id is a duplicate waiting for a second mount.
  const titleId = useId();

  // The one thing a `<dialog>` can't be told declaratively. `close` fires for
  // Escape and the backdrop alike, so the parent hears every way out through one
  // handler.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      // `showModal` autofocuses the first focusable descendant, which here is
      // the close key — a control wearing a focus ring reads as pressed, and
      // "the way out" is a poor first thing to point at. The scroll region takes
      // it instead: this sheet is opened to be read, and focusing the box that
      // scrolls is what makes Page Down and the arrow keys work on arrival. The
      // trap and Escape still belong to the dialog.
      bodyRef.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Guarded by target: the columns editors inside the panel are dialogs of
      // their own, and React's `close` walks its tree rather than the DOM — see
      // the note above.
      onClose={(event) => {
        if (event.target === ref.current) onClose();
      }}
      // The backdrop is the dialog's own pseudo-element, so a click landing on
      // the dialog box itself is a click outside the panel.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-auto h-[min(90vh,58rem)] w-[min(1180px,calc(100vw-1.5rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.55)]"
    >
      <div
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-active/25 bg-gradient-to-b from-[rgba(24,45,60,0.72)] to-[rgba(9,20,31,0.86)] shadow-[0_50px_90px_-30px_rgba(0,0,0,0.95),0_0_70px_-24px_rgba(0,255,229,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl"
        style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
      >
        {/* The specular rail every large face here wears — without it a panel
            this size reads as a sheet of glass rather than a milled part made
            of it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
        />

        <div className="flex shrink-0 items-center gap-3 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-transparent px-3 py-2.5 sm:px-4">
          {/* The card's nameplate continued: the league is what the reader
              pressed, and the panel below states nothing else about it. `h2`
              because the page's own title is a visually-hidden `h1`. */}
          <h2
            id={titleId}
            className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight"
          >
            {league?.name ?? "League"}
          </h2>

          {/* What the card's own nameplate had no room for, and the panel below
              never states: how big this league is and whether it is being
              played. Absent rather than guessed while the league list is still
              answering, on the same terms as the name above it. */}
          {meta && (
            <span className="hidden shrink-0 text-[0.7rem] tabular-nums text-foreground/40 sm:inline">
              {meta.total_rosters} teams · {meta.status.replace(/_/g, " ")}
            </span>
          )}

          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="lab-chip lab-chip-sm grid size-7 shrink-0 place-items-center rounded-full text-foreground/55 transition-colors hover:text-active"
          >
            <CloseIcon />
          </button>
        </div>

        {/* **This box does not scroll, and that is what the panel needs from
            whoever holds it.** The panel is a fixed head over two independently
            scrolling halves, and every `min-h-0` in that chain has to resolve
            against a definite height — so what a holder owes it is a bound, not
            a scroller. `overflow-y-auto` here would satisfy nothing and quietly
            turn the whole panel back into one long scroll with its telemetry
            strip and both sets of column headings riding away. The leagues list
            supplies the same bound by capping its open card at the viewport;
            this dialog is a fixed height, so `min-h-0 flex-1` is the whole of
            it.

            `tabIndex={-1}` is what lets the effect above put focus here rather
            than on the close key, and `outline-none` because that focus is
            programmatic and this is not a control. The halves' own scroll boxes
            are what a keyboard reader Tabs into from here. */}
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {/* `.lab-plate` because that is the face this panel is drawn on in the
              leagues list — an expanded card *becomes* the plate rather than
              holding one, so a second surface here would make one panel two
              materials on two pages. Opaque, which is the half of the glass rule
              that matters: the frame says the board is still underneath, and the
              rows must never be read over it.

              `flex-1` here and nowhere inside the panel: the plate is the
              *ground*, so it fills the sheet whatever the league has to say —
              where a short panel inside it is still exactly as tall as its
              contents, which is what the panel's own `0 1 auto` chain is for. */}
          {open && league && (
            <div className="lab-plate flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Keyed on the trade, so opening a different card is a fresh mount
                  and the rail is back at "now" — the one piece of state in here
                  that must not survive being pointed at another league. */}
              <SheetBody key={league.tradeId} league={league} />
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

/**
 * The rail and whatever it is pointing at.
 *
 * A component of its own because it holds state the dialog above it must not:
 * where the rail is standing. Mounted from the sheet's own `open` gate and keyed
 * on the trade, so both of the things that should reset it — closing the sheet,
 * and pressing a different card — reset it by construction rather than through an
 * effect watching for them.
 */
function SheetBody({ league }: { league: OpenLeague }) {
  // How many of the league's newest moves are reversed. **Zero rather than a
  // stop index**, so it is meaningful before the payload lands: the sheet opens
  // at the present whether or not the timeline has answered, which is what makes
  // the rail additive rather than something the panel has to wait for.
  const [back, setBack] = useState(0);

  const { data } = useTradeTimeline(league.tradeId);

  const moves = timelineMoveCount(data);
  const stop = timelineStop(data, back);
  // Only where the reader has actually stepped back. At "now" this would be the
  // current rosters — which the panel below already draws, from its own read —
  // so computing it would be a rewind of nothing for an answer nobody shows.
  const rosters = useMemo(
    () => (stop.back > 0 ? timelineRosters(data, stop.back) : []),
    [data, stop.back],
  );

  return (
    <>
      {/* No rail where there is nothing to scrub: a trade Sleeper filed with no
          timestamp has no moment to rewind to, and a league whose rosters are not
          stored has nothing to rewind from. Both come back as no timeline, and
          both leave the sheet exactly as it was before this existed — which is a
          better answer than a dead slider explaining itself. A timeline with the
          trade as its only move is still a rail, since "before it" is a stop. */}
      {moves > 0 && (
        <TimelineRail
          stop={stop}
          moves={moves}
          players={data?.players ?? EMPTY_PLAYERS}
          onChange={setBack}
        />
      )}

      {stop.back === 0 ? (
        <LeagueDetailPanel
          leagueId={league.leagueId}
          focusRosterId={league.rosterId ?? undefined}
        />
      ) : (
        <TimelineRosters
          rosters={rosters}
          players={data?.players ?? EMPTY_PLAYERS}
          managers={data?.managers ?? EMPTY_MANAGERS}
          caveat={rosterCaveat(stop.at)}
        />
      )}
    </>
  );
}

/**
 * The line above a past league, which has two jobs and states both plainly.
 *
 * It says *which moment* this is, because the rail's own readout is a row up and
 * a reader who has scrolled the grid can no longer see it. And it says the rosters
 * are **reconstructed**, because nothing about a list of names admits that it was
 * derived — Sleeper stores no history, so this is today's rosters with every move
 * since undone, and the two limits of that walk (a draft is not a transaction, and
 * the pick horizon is today's) are exactly the kind of thing a reader should be
 * told once rather than discover.
 */
function rosterCaveat(at: number | null): string {
  const when = at === null ? "this point" : formatTradeDate(at);
  return `Every roster as it stood on ${when} — reconstructed by undoing every move since, so a class drafted after this date is already on the roster that took it.`;
}

/** Stable empties, so a render before the payload lands changes no identity. */
const EMPTY_PLAYERS = {};
const EMPTY_MANAGERS = {};

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

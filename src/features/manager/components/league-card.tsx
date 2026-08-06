"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  RowSheen,
} from "@/features/shared";
// The module path rather than that barrel: the panel is a subtree deep enough
// that re-exporting it there would ship it to every page importing anything
// shared — see `ui/league-detail/index.ts`.
import { LeagueDetailPanel } from "@/features/shared/ui/league-detail";

import { formatRecord, ordinal } from "../format";
import { LEAGUE_METRICS, type MetricContext } from "../league-metrics";
import type {
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueRankSet,
  ManagerLeague,
} from "../types";
import { MetricColumns } from "./metric-column";
import { Chevron } from "./ui";

/**
 * One league in the leagues list: a dense, glassy row that reads at a glance and
 * opens the full standings-and-rosters panel on click.
 *
 * The record line names where this manager stands in the league — the one ranking
 * the card states outright, because it is what the record beside it means.
 *
 * The four stat columns across it are each a slot the reader points at a metric —
 * where this manager stands by points, by KTC starter value and by projected
 * points to start with, but swappable to the raw number behind a rank or to KTC
 * bench value. Which metric each slot shows is held above this card, in
 * {@link ManagerLeagues}, so every card shows the same four and the columns line
 * up column to column down the whole list — and the control that moves them is
 * the heading rail up there too, which is why this card renders numbers and no
 * pickers of its own.
 *
 * **An expanded card does not *hold* the detail panel, it *becomes* it.** The
 * row wore the list's glass while the panel inside it was a machined plate, so
 * one league was two materials nested four surfaces deep — glass, plate, trough,
 * row — before a player name was drawn, with the plate's own inset sitting
 * inside the card's and both coming out of the one track that has nowhere else
 * to go (the name). So expanding swaps this row's surface for `.lab-plate` and
 * the panel renders straight onto that face: one instrument, one inset, and the
 * app bar's grammar at card scale — the raised part is the one being worked in,
 * which is also why the rail lights and the hover lift goes away (a several-
 * hundred-pixel panel that rises under the pointer is a card pretending to still
 * be a row).
 *
 * **An open card takes the screen, which is why it doesn't hold its own open
 * state.** Expanding pulls the card up under the app bar, pins it there, unpins
 * the manager plate above it (see {@link ManagerHeader}) and caps the panel at
 * the viewport so the detail scrolls inside the card rather than running off the
 * bottom of a page several screens long. Every one of those is a claim only one
 * card can make at a time, so which league is open is held in
 * {@link ManagerLeagues} and arrives here as a prop.
 *
 * **It opens and closes as a movement, which is why the panel outlives the press
 * that closed it.** A card appearing and vanishing at full height moved the rows
 * under it by a screen with nothing to say where they went — worst on the close,
 * where the list snaps back around a card the reader is looking at. So the panel
 * grows and collapses through `grid-template-rows`, and the card holds it in the
 * tree for the length of the collapse: an unmounted element cannot play an exit,
 * so a state that is *only* `expanded` can animate one direction and never the
 * other.
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
  adp,
  columns,
  expanded,
  onToggle,
}: {
  league: ManagerLeague;
  /**
   * Where this manager sits by record, points for and projected points — null
   * while the ranks are loading, and each field independently null for a ranking
   * this league can't form yet (nothing projected, or nothing played). A missing
   * rank shows as a dim placeholder rather than a gap, so the columns stay put.
   */
  ranks: LeagueRankSet | null;
  /** The horizon behind the projected rank, so its hover can say what it covers. */
  weeks: number[];
  /**
   * This manager's KTC value here and its starter-value rank — null while
   * loading, and for a league they hold no roster in. Absent rather than zeroed,
   * on the same terms as `ranks`.
   */
  ktc: LeagueKtcEntry | null;
  /** When those KTC values were scraped, for the KTC metrics' hover. */
  valuedAt: string | null;
  /**
   * This manager's ADP-derived value here and its starter-value rank — null while
   * loading and for a league they hold no roster in, absent rather than zeroed on
   * the same terms as `ktc`.
   */
  adp: LeagueAdpEntry | null;
  /** The metric key each of the four stat columns shows, shared by every card. */
  columns: string[];
  /** Whether this is the league currently open — one at a time, list-wide. */
  expanded: boolean;
  /** Open this league, or close it if it is the one already open. */
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // The panel this row's `aria-expanded` is about. Named, so "expanded" points
  // at something a reader can be taken to rather than being a state with no
  // object.
  const panelId = useId();

  // Opening and closing are two states of one gesture, so the panel is animated
  // in *and* out — which takes two flags rather than one, because an unmounted
  // element cannot play an exit. `closing` keeps a panel in the tree past the
  // press that closed it; `open` is whether the wrapper is at its full height.
  // The panel is mounted while either says so, and that gate is what keeps a
  // collapsed card from mounting a panel that would fetch the league detail.
  //
  // Both are adjusted **during render** against the previous `expanded` rather
  // than in an effect: a card is closed by the press that opens another one, so
  // an effect would collapse it a render late — and setting state in an effect
  // body is the cascading render the lint rule objects to. Only the flip *to*
  // open is deferred, because it is the one thing that genuinely needs a frame
  // to have passed (see below).
  const [wasExpanded, setWasExpanded] = useState(expanded);
  const [closing, setClosing] = useState(false);
  const [open, setOpen] = useState(expanded);
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded);
    setClosing(!expanded);
    if (!expanded) setOpen(false);
  }
  const mounted = expanded || closing;

  useEffect(() => {
    if (expanded) {
      // Two frames, not one: the first is where React's commit lands the panel
      // at 0fr, and a class flipped in the same frame would be coalesced into
      // that first layout and transition from nothing.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setOpen(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    // A timer rather than `transitionend`, because the event doesn't fire at
    // all when the transition is suppressed — a reader on reduced motion, or a
    // browser that won't interpolate `grid-template-rows` — and a panel that
    // never unmounts is a card holding a detail fetch for a league nobody has
    // open. Overshooting by a frame costs nothing; the panel is already
    // collapsed and invisible by then.
    const id = setTimeout(() => setClosing(false), PANEL_MS);
    return () => clearTimeout(id);
  }, [expanded]);

  // Closing scrolls nothing — *unless the card was pinned above its own place in
  // the list*, which is the one case the sticky top introduced. A pinned card
  // holds the top of the screen while the rows behind it pass underneath, so by
  // the time it is closed its resting position can be well above the fold, and
  // releasing it drops the row out of the viewport entirely: the reader presses
  // a card and the thing they pressed vanishes. So the collapsed row is put back
  // where the reader is looking, and only from above the fold — a card still on
  // screen has not moved and is left exactly where it is, which is the original
  // rule intact for every close that never scrolled. Instant, because by then
  // there is a row rather than a panel and a smooth travel across a list several
  // screens long is a journey nobody asked for.
  //
  // It runs after `closing` clears rather than beside it, since a sticky element
  // reports the position it is pinned at and not the one it would rest at. The
  // ref is what keeps it to *this card's own close*: a card above the fold is
  // the ordinary state of a scrolled list, so without it every card mounting
  // into a scrolled page — a filter change, a background refresh — would haul
  // the page up to itself.
  const wasPinned = useRef(false);
  useEffect(() => {
    if (expanded || closing) return;
    if (!wasPinned.current) return;
    wasPinned.current = false;
    const el = ref.current;
    if (!el || el.getBoundingClientRect().top >= 0) return;
    el.scrollIntoView({ block: "start", behavior: "auto" });
  }, [expanded, closing]);

  // Opening pulls the card to the top of the screen, because that is what makes
  // the cap below a whole panel rather than the top of one: a card opened
  // halfway down the viewport would have half a screen to draw a panel that is
  // sized for a screen. The offset is `scroll-mt`, so the browser does the
  // arithmetic against the app bar rather than this reading a height at runtime
  // — and it is the same offset the card then sticks at, so the position it is
  // aimed at and the position it holds cannot disagree.
  //
  // It scrolls twice, and the second one is a correction rather than a repeat:
  // opening a league closes the one before it, so while this card is
  // travelling to the top the card above it may be collapsing several hundred
  // pixels out of the page — which moves this one up past the offset it was just
  // aimed at. A second call once the collapse has finished lands it where it was
  // asked to be, and is a no-op when nothing moved.
  useEffect(() => {
    if (!expanded) return;
    // Armed here rather than during render: a ref written in a render body
    // survives a render React threw away, so the flag is set where the card
    // genuinely took the top of the screen.
    wasPinned.current = true;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scroll = () =>
      ref.current?.scrollIntoView({
        block: "start",
        behavior: reduced ? "auto" : "smooth",
      });
    scroll();
    const id = setTimeout(scroll, PANEL_MS);
    return () => clearTimeout(id);
  }, [expanded]);

  const record = league.record;
  const standing = ranks?.standing ?? null;
  const ctx: MetricContext = { league, ranks, ktc, adp, weeks, valuedAt };

  return (
    <li
      ref={ref}
      // The surface and the ceiling follow `mounted`, not `expanded`: a card
      // that snapped back to the list's glass while its panel was still
      // collapsing would be two halves of one gesture running at different
      // speeds — and the hover lift returning under the pointer mid-collapse
      // reads as the row jumping. It is the plate until the panel is gone.
      className={`${SCROLL_OFFSET} ${
        mounted
          ? `${OPEN_SURFACE} ${OPEN_BOX}`
          : `${LIST_ROW_SURFACE} ${LIST_ROW_HOVER}`
      }`}
    >
      <RowSheen lit={expanded} />

      {/* The whole row is the toggle, not just the name half. The stat columns
          have nothing to press of their own — the pickers live in the heading
          rail above the list — so the right half of every card was inert while
          looking exactly as pressable as the left, and a click there did
          nothing.

          It is a `role="button"` div rather than a `<button>` because the row
          holds the metric columns, which are divs: flow content inside a button
          is invalid, and this is the way to make the whole row one press target
          without either rewriting a shared component's markup or dropping the
          league name's heading. The keyboard half is therefore hand-written —
          Enter and Space, the two keys a native button answers.

          `relative` is what keeps the sheen behind this rather than over it — an
          absolutely positioned sibling paints above static content whatever the
          source order. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space scrolls the page otherwise, which is what a native button
          // suppresses for us.
          event.preventDefault();
          onToggle();
        }}
        aria-expanded={expanded}
        // Only while the panel is in the tree: it is mounted on expand and
        // unmounted a beat after the collapse, and a reference to an id that
        // isn't in the document is a broken relationship rather than an absent
        // one.
        aria-controls={mounted ? panelId : undefined}
        // `shrink-0` because the open card is a flex column with a ceiling: the
        // head is the one part of it that must not be compressed to make room,
        // since the league's name is what says which panel this is.
        className="relative flex w-full shrink-0 cursor-pointer flex-col items-stretch gap-3 px-4 py-3 pl-5 text-left sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Chevron open={expanded} size="md" />
          <StatusDot status={league.status} />
          {/* The display face, as on a tool card — Orbitron is wider than the
              body face, so the size drops a step to keep a long league name from
              truncating any sooner than it did. */}
          {/* `h2`, not `h3`: the only heading above this on a manager page is
              the plate's `h1`, so a level 3 skipped a level in the outline. */}
          <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight">
            {league.name}
          </h2>
          {record && (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground/70">
              {formatRecord(record)}
            </span>
          )}
          {/* The standing rides with the record rather than occupying one of the
              four stat slots: it is what the record *means* in its league, so
              reading it anywhere else is reading half the fact. That is why it
              is no longer in the metric catalogue — a slot pointed at it would
              be a second copy of what this line already says. Absent, not
              zeroed, before a game is played, the same rule the rank cells
              keep. */}
          {standing && (
            <span
              title={`#${standing.rank} of ${standing.of} by record`}
              className="shrink-0 text-xs font-medium tabular-nums text-foreground/45"
            >
              {ordinal(standing.rank)}
              <span className="text-foreground/30"> of {standing.of}</span>
            </span>
          )}
        </div>

        {/* Numbers only, at every width: the heading rail pinned above the list
            names these columns and is the only thing that moves them, because
            the same four words repeated down a hundred rows is what made a
            list-wide selection read as a per-card one. */}
        <MetricColumns metrics={LEAGUE_METRICS} ctx={ctx} columns={columns} />
      </div>

      {/* No seam and no inset of its own: the panel is on this card's face, so
          what used to be a border between two surfaces would now be a line drawn
          across one. The padding under it belongs to the panel, which is where
          the container query that sizes it can see a width.

          This is the box that scrolls. It takes no `flex-1`: a flex item's
          default is `0 1 auto`, so a short panel — a league still loading, or a
          shallow one — is exactly as tall as its contents, and only one that
          would run past the card's ceiling shrinks into it and scrolls. `flex-1`
          would stretch every open card to the full screen whatever it had to
          say. `min-h-0` is what lets that shrink happen at all, since a flex
          item's floor is its content size otherwise.

          The radius is repeated here because a scroll container clips: without
          it the last roster row paints square across the card's rounded bottom
          corners. `overscroll-contain` keeps a flick at the end of the panel
          from carrying on into the page behind it — the card is the thing being
          read, and scroll chaining out of it is the list moving under a reader
          who was pulling on a roster. */}
      {/* The height is animated through `grid-template-rows`, 0fr to 1fr, which
          is the one way to transition to a height nobody knows: the panel's is
          whatever the league's standings and rosters come to, and it changes
          again when the detail read resolves — so a measured pixel height would
          be measured at the wrong moment. The grid row resolves against the
          content on every frame instead, which also means the cap above wins
          without arithmetic: once the card is at its ceiling, 1fr *is* the
          space left, and the transition simply runs to that.

          Opacity rides along so a panel that has barely opened isn't a sliver
          of legible text, and the whole thing is `motion-reduce:transition-none`
          — a reader who asked for less motion gets the panel where it always
          was, immediately, which is the same call the flask's animations make. */}
      {mounted && (
        <div
          id={panelId}
          className={`grid min-h-0 transition-[grid-template-rows,opacity] duration-[280ms] ease-out motion-reduce:transition-none ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="relative min-h-0 overflow-y-auto overscroll-contain rounded-b-xl">
            <LeagueDetailPanel leagueId={league.league_id} />
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * How long the panel takes to open or close, in milliseconds — the same number
 * as the `duration-[280ms]` on the wrapper, and it has to stay that way: this
 * is what decides when a closing panel leaves the tree, so a shorter value
 * truncates the collapse and a longer one holds a fetched panel past the end of
 * it. Long enough to read as a movement, short enough that a reader closing a
 * card and opening the next one isn't waiting on it.
 */
const PANEL_MS = 280;

/**
 * The surface an expanded card wears: the detail panel's own plate, at row
 * width. The border is the one part not in `.lab-plate` — the class carries
 * material and never a box — and it takes the accent rather than the list's
 * hairline, since a lit edge is what says which league is open when the card
 * above it is scrolled past.
 */
const OPEN_SURFACE = "lab-plate group rounded-xl border border-active/25";

/**
 * The box an expanded card lives in: a column with a ceiling, so the head stays
 * put and the panel scrolls inside it.
 *
 * The ceiling is the screen less the app bar and a hair of clearance, which is
 * the whole point — the panel is several hundred rows in a league with a deep
 * bench, and left to run it pushed its own card's head off the top of the
 * screen and the rest of the list several screens down. Capped, one open league
 * is one screen: the name and the stat columns above, the standings and rosters
 * under them, and the next league still where it was when the card is closed.
 *
 * `svh` and not `vh` or `dvh`: this must not extend past the bottom of the
 * screen on a phone, so the unit to size against is the viewport *with* the
 * browser's own chrome showing. `dvh` would grow and shrink the card as that
 * chrome hides, which on a scrolling panel reads as the page fighting the
 * finger.
 *
 * **It is `sticky` at the app bar's own height, which is what makes the cap a promise
 * rather than a starting position.** Scrolled to the top and left there, the
 * open card walked straight back off the top of the screen the moment a reader
 * pulled on the list — and since the head is the one part of it that says which
 * league this panel belongs to, what was left was several hundred rows of
 * standings and rosters with nothing naming them. Pinned, the head and the stat
 * columns stay under the app bar for as long as the card is open (the head takes
 * no `sticky` of its own: it is already outside the box that scrolls, so pinning
 * the card pins it), and the rows behind it pass underneath — which they can do
 * because `.lab-plate`'s face is opaque.
 *
 * Three details ride on it. `top` and `scroll-mt` are the same offset, so the
 * position the open-scroll aims at is exactly the one the card sticks at and the
 * two can't disagree by a pixel. The `z` is what keeps the cards *after* it from
 * painting over it — they are `relative` themselves, so DOM order would
 * otherwise win — and it sits below the header plate's `z-40` and the cards'
 * `z-30` menus, since this is a surface rather than something raised over one.
 * And it replaces `relative` on the surface rather than joining it: `sticky` is
 * a positioned element too, so {@link RowSheen} still has its containing block,
 * and two position utilities on one element is a fight decided by Tailwind's
 * alphabetical emission order rather than by anything readable here.
 */
const OPEN_BOX =
  "sticky top-[var(--site-header-h)] z-20 " +
  "flex max-h-[calc(100svh-var(--site-header-h)-1.5rem)] flex-col";

/**
 * The offset every scroll to this card aims at, and the one the open card sticks
 * at — the app bar's height, so the browser does that arithmetic rather than an
 * effect reading a height at runtime.
 *
 * It is worn at **both** states rather than riding with the open box, because
 * the two scrolls happen at opposite ends of the gesture: opening aims at a card
 * about to become a panel, and the close correction aims at one that is already
 * a row again. Carried only while open, the second would land the row under the
 * app bar.
 */
const SCROLL_OFFSET = "scroll-mt-[var(--site-header-h)]";

/**
 * A small state dot standing in for the old text badge: the accent for a league
 * in season, amber for one still drafting, dim for anything done. The status
 * word rides on hover and for screen readers.
 */
function StatusDot({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]"
      : status === "drafting" || status === "pre_draft"
        ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
        : "bg-foreground/30";
  return (
    <span title={status.replace(/_/g, " ")} className="flex shrink-0 items-center">
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span className="sr-only">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Chevron } from "./chevron";
// The module path rather than the `features/shared` barrel: the panel is a
// subtree deep enough that re-exporting it there would ship it to every page
// importing anything shared — see `ui/league-detail/index.ts`.
import { LeagueDetailPanel } from "./league-detail";
import { RowSheen } from "./list-row";
import { NAMEPLATE_BUTTON, Nameplate } from "./nameplate";

/**
 * One league in a list of them: a machined card that reads at a glance and opens
 * the full standings-and-rosters panel on click.
 *
 * **It is in `features/shared` because a second list wears it.** The manager
 * tool's leagues tab wrote it; the lineup checker draws the same card, with this
 * week's opponent where that one puts the record. What is shared is everything a
 * reader judges the card by — the slab, the two plates on its top edge, the head's
 * inset, the panel and the whole opening gesture — and what is not is the two
 * things that differ: what rides on the trailing plate ({@link ledge}) and what
 * the stat columns hold ({@link columns}). Each caller passes those as nodes, and
 * this knows nothing about either catalogue.
 *
 * **It is built like a trade card, which is a deliberate move away from the
 * list's glass.** It wore `LIST_ROW_SURFACE` — the tool cards' glass held to
 * a row's height, the surface the share cards still wear — and the trades board's
 * own card left that surface first, for an argument that turns out to be this
 * card's too: a league card is not a row of a table, it is the whole of what one
 * league has to say, four columns deep, and depth is what sorts those columns into
 * an order. So it is `.lab-slab` — the app bar's corner-lit block at card scale,
 * with a wall running down *and* right, a chamfered leading and trailing corner
 * and a brushed face — its name rides out of the top edge on a {@link Nameplate},
 * and its second fact sits in a plate rather than being set in bold text on glass.
 * The lists read as one instrument now, which is what a reader crossing between
 * these tools actually experiences.
 *
 * **Its top edge carries two plates, and that is the one place it goes further
 * than the trade card.** That card puts its name on a plate and its second fact
 * on the face below, having weighed the pair and found a plate carrying both
 * would take the timestamp down with a truncating name. Here the second fact is
 * what the whole card is *about* — how this league is going, or who it is playing
 * — so it gets a plate of its own on the trailing corner, and the negotiation that
 * card was avoiding is handled by laying the two out as one row.
 *
 * The stat columns across it are each a slot the reader points at a metric. Which
 * metric each slot shows is held above this card, in the list, so every card shows
 * the same four and the columns line up column to column down the whole list — and
 * the control that moves them is the heading rail up there too, which is why this
 * card renders numbers and no pickers of its own.
 *
 * **An expanded card does not *hold* the detail panel, it *becomes* it — and
 * that is why the slab stops at the press.** The row used to wear glass while
 * the panel inside it was a machined plate, so one league was two materials
 * nested four surfaces deep before a player name was drawn; the correction was to
 * swap the surface on expand, and it survives the slab intact. A slab is an
 * *object in a list* — a wall you could pick it up by, a brushed face, a static
 * specular sweep — and none of those is what a several-hundred-row instrument
 * wants: the sweep would be a diagonal wash across a page of standings, and the
 * wall's drop-shadow would be repainted around a box the reader is scrolling
 * inside. So an open card is `.lab-plate`, the panel renders straight onto that
 * face, and what the reader sees is one instrument rather than a card holding
 * one. Both surfaces are machined, so the swap is now a change of *part* rather
 * than of material — which is what it always meant.
 *
 * **An open card takes the screen, which is why it doesn't hold its own open
 * state.** Expanding pulls the card up under the manager plate, pins it there and
 * caps the panel at what is left of the viewport, so the detail scrolls inside
 * the card rather than running off the bottom of a page several screens long.
 * (The plate stays where it is: it used to let go of the top for this, which took
 * both filter rows and the heading rail off screen at the moment a reader went a
 * level deeper — see `ManagerHeader`.) What scrolls under that cap is each of
 * the panel's two halves on its own, not the card's whole contents — the strip
 * naming the selected team's rank and totals and each list's column headings
 * stay put, which is the point of capping it in the first place. Every one of
 * those is a claim only one card can make at a time, so which league is open is
 * held by the list and arrives here as a prop.
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
  leagueId,
  name,
  status,
  ledge,
  columns,
  focusRosterId,
  week = null,
  expanded,
  onToggle,
}: {
  leagueId: string;
  name: string;
  /** Sleeper's league status, for the lamp on the nameplate. */
  status: string;
  /**
   * The plate on the card's trailing corner — the manager's record and standing
   * on the leagues list, this week's opponent on the lineup checker.
   *
   * Optional, and absent draws no plate rather than an empty one: a card with
   * neither fact would be reporting that it has nothing to report. Each caller
   * makes that call for itself, since what counts as "nothing to say" is a fact
   * about what it is saying.
   */
  ledge?: ReactNode;
  /** The stat columns across the head — see the callers' own catalogues. */
  columns: ReactNode;
  /**
   * Which roster the panel's roster half opens on. The lineup checker knows the
   * reader's own roster here and passes it, since arriving at a league because of
   * *your* lineup and landing on the projected leader's bench answers a question
   * nobody asked. Omitted by the leagues list, which arrives at a league.
   */
  focusRosterId?: number;
  /**
   * Open the panel on a **week** rather than on the rest of the season — the
   * lineup checker passes its selected week, the leagues list passes nothing.
   *
   * It is the same difference the ledge above already draws: a list about a
   * season puts a record on the card and a list about one Sunday puts an
   * opponent, and the panel behind them has the same two readings. See
   * {@link LeagueDetailPanel}.
   */
  week?: number | null;
  /** Whether this is the league currently open — one at a time, list-wide. */
  expanded: boolean;
  /** Open this league, or close it if it is the one already open. */
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // The panel this card's `aria-expanded` is about. Named, so "expanded" points
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
    if (!el) return;
    // "Still on screen" means "not behind the chrome", and the chrome is the app
    // bar plus a manager plate whose height is the reader's own wrapping — so the
    // bound is read off the element's own `scroll-mt` rather than retyped. That
    // is the offset the scroll below would aim at, which is what makes the test
    // and the correction one number: a row resting *above* it is a row the
    // pinned plate is covering, and one at or below it has not moved.
    const chrome = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (el.getBoundingClientRect().top >= chrome) return;
    el.scrollIntoView({ block: "start", behavior: "auto" });
  }, [expanded, closing]);

  // Opening pulls the card to the top of the screen, because that is what makes
  // the cap below a whole panel rather than the top of one: a card opened
  // halfway down the viewport would have half a screen to draw a panel that is
  // sized for a screen. The offset is `scroll-mt`, so the browser does the
  // arithmetic against the app bar and the manager plate rather than this
  // reading two heights at runtime — and it is the same offset the card then
  // sticks at, so the position it is aimed at and the position it holds cannot
  // disagree.
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

  // The surface follows `mounted`, not `expanded`: a card that snapped back to a
  // slab while its panel was still collapsing would be two halves of one gesture
  // running at different speeds — and the hover lift returning under the pointer
  // mid-collapse reads as the card jumping. It is the plate until the panel is
  // gone.
  const surface = mounted ? OPEN : REST;

  return (
    // The plates hang off the card's top edge, so they are siblings of the
    // surface and the overhang is this element's padding — a part reaching
    // outside the box would be clipped by nothing here and measured by nobody,
    // which is not true one list over (see {@link Nameplate}).
    <li
      ref={ref}
      className={`${SCROLL_OFFSET} pt-3 ${mounted ? OPEN_BOX : "relative"}`}
    >
      {/* **The top edge is one row rather than two placed parts**, which is what
          lets the name give way to the ledge instead of to a guess. A plate that
          positions itself can only cap its own width, and what the name may take
          is whatever the part beside it doesn't — a number whose width is its
          own contents (`11th` against `2nd`, a tie against none), or an
          opponent's username. As two items of one row the negotiation is the
          layout's, and it holds at 390px where it matters.

          `pointer-events-none` is what keeps the row from eating the card: it
          spans the whole edge and sits over the head's top inset, so without it
          every press landing between the two plates would hit this instead of the
          toggle underneath. Each plate takes them back.

          The trailing inset is per-state for the same reason the head's is: a
          slab spends 6px of that gutter on its wall and the open plate spends 1px
          on a border, so one number lands the ledge in two places (see
          {@link REST}). */}
      <div
        className={`pointer-events-none absolute left-3.5 top-0 z-10 flex items-start justify-between gap-2.5 ${surface.edge}`}
      >
        <LeagueNameplate
          name={name}
          status={status}
          expanded={expanded}
          // Only while the panel is in the tree: it is mounted on expand and
          // unmounted a beat after the collapse, and a reference to an id that
          // isn't in the document is a broken relationship rather than an absent
          // one.
          panelId={mounted ? panelId : undefined}
          onToggle={onToggle}
        />
        {ledge}
      </div>

      {/* The wall, and the face standing on it — the trade card's construction,
          and the chamfer goes on both layers because a wall that turns two
          corners shows a square one wherever the clip doesn't follow it. Open,
          the wall is nothing but a link in the height chain: the plate below
          carries its own thickness as a plain shadow, having nothing to clip it.

          Every link from here down is `0 1 auto` with `min-h-0`, which is what
          makes a short panel exactly as tall as its contents while only one that
          would overrun the cap shrinks into it. `flex-1` anywhere on this chain
          would stretch every open card to the full screen whatever it had to
          say. */}
      <div className={`flex min-h-0 flex-col ${surface.wall}`}>
        <div className={`relative flex min-h-0 flex-col ${surface.face}`}>
          {/* Only on the plate. A slab has a specular sweep of its own and a
              cyan bloom under it, so a second travelling band would be the one
              part of the card claiming to be glass — and the rail RowSheen
              draws is what the nameplate's own already says. Open, it is worth
              having for the half it does that the plate can't: the lit rail
              marks which league is the one being worked in. */}
          {mounted && <RowSheen lit={expanded} />}

          {/* The whole head is the press target, not just the name half. The
              stat columns have nothing to press of their own — the pickers live
              in the heading rail above the list — so the right half of every
              card was inert while looking exactly as pressable as the left.

              It carries no `role` and no `tabIndex`: the *button* is the league's
              name on the plate, for the reason the trade card's is. `role="button"`
              here would take presentational children, flattening four stat
              columns and their screen-reader labels into one string; the
              nameplate's real `<button>` announces the league and its expanded
              state, and this is the mouse affordance over the same toggle.

              `shrink-0` because the open card is a flex column with a ceiling:
              the head is the one part of it that must not be compressed to make
              room, since the columns are what the reader was reading.

              `relative` is what keeps the open card's sheen behind this rather
              than over it — an absolutely positioned sibling paints above static
              content whatever the source order. */}
          <div
            onClick={onToggle}
            className={`relative flex w-full shrink-0 cursor-pointer flex-col items-stretch gap-3 pb-3 pt-4 text-left sm:flex-row sm:items-center sm:gap-4 ${surface.head}`}
          >
            {/* The chevron and the space it holds. **Both facts that used to
                stand here are on the edge now** (see {@link ledge}), which
                leaves this cluster as the disclosure mark and the flex spacer
                that pushes the columns to the trailing edge — thin, and
                deliberately so: the head's left half was the one place on the
                card that had to stay quiet, since the four columns beside it are
                what the list is scanned on. */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Chevron open={expanded} size="md" />
            </div>

            {/* Numbers only, at every width: the heading rail pinned above the
                list names these columns and is the only thing that moves them,
                because the same four words repeated down a hundred rows is what
                made a list-wide selection read as a per-card one. */}
            {columns}
          </div>

          {/* No seam and no inset of its own: the panel is on this card's face,
              so what used to be a border between two surfaces would now be a
              line drawn across one. The padding under it belongs to the panel,
              which is where the container query that sizes it can see a width.

              **It clips; it no longer scrolls.** One scroll box over the whole
              panel carried the readout strip and both column headings away with
              the rows, so the numbers a reader had scrolled to were unlabelled
              and the team the roster belongs to unnamed. The scrolling moved
              down into the two halves, which each keep their own heading fixed
              over their own list (see {@link LeagueDetailPanel}) — so what is
              left here is the clip the collapse animation needs, since a `0fr`
              grid row only hides what its item is willing to cut off.

              The radius is repeated here for the same reason it always was: a
              clipping box squares its corners otherwise, and the last roster row
              would paint across the card's rounded bottom.

              The height is animated through `grid-template-rows`, 0fr to 1fr,
              which is the one way to transition to a height nobody knows: the
              panel's is whatever the league's standings and rosters come to, and
              it changes again when the detail read resolves — so a measured
              pixel height would be measured at the wrong moment. The grid row
              resolves against the content on every frame instead, which also
              means the cap above wins without arithmetic: once the card is at
              its ceiling, 1fr *is* the space left, and the transition simply runs
              to that.

              Opacity rides along so a panel that has barely opened isn't a
              sliver of legible text, and the whole thing is
              `motion-reduce:transition-none` — a reader who asked for less motion
              gets the panel where it always was, immediately, which is the same
              call the flask's animations make. */}
          {mounted && (
            <div
              id={panelId}
              className={`grid min-h-0 transition-[grid-template-rows,opacity] duration-[280ms] ease-out motion-reduce:transition-none ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="relative flex min-h-0 flex-col overflow-hidden rounded-b-xl">
                <LeagueDetailPanel
                  leagueId={leagueId}
                  focusRosterId={focusRosterId}
                  week={week}
                />
              </div>
            </div>
          )}
        </div>
      </div>
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
 * The two things a card can be, each with the head inset its own box needs.
 *
 * **The insets differ because the boxes do, and the number they have to agree on
 * is where the stat columns land.** The heading rail above the list is laid on
 * the cards' geometry to the pixel (`border border-transparent px-4 pl-5`, so
 * content starts at 21px and ends 17px off the trailing edge), and a heading a
 * hair off the number under it reads as a misaligned table. A slab spends 6px of
 * that trailing gutter on its wall and none of it on a border, so its face gives
 * 6px back — 21px and 11px, arriving at the same two edges. The plate is a
 * bordered box like the glass it replaced, so it keeps the spelling the rail was
 * written against.
 *
 * That arithmetic is also what keeps the columns from stepping sideways when a
 * card opens: below `sm` they divide the head's own width, so the two insets
 * have to sum to the same 32px as well as landing the trailing edge in the same
 * place.
 *
 * **`edge` is that same arithmetic for the top edge**, and it is the reason the
 * trailing plate's inset is not simply the nameplate's 14px mirrored. The plates
 * are siblings of the *card*, so the offset is measured from the card's box
 * while the ledge has to land against the *face's* trailing edge — 6px in from
 * the card at rest, since that gutter is the slab's wall, and 1px in when the
 * card is open and the face is a bordered box at full width. The leading edge
 * needs no such pair: a slab's padding is bottom and trailing only, so the left
 * edge is flush in both states.
 */
export const REST = {
  /** The wall — 6px down and right, chamfered on both layers with the face. */
  wall: "lab-slab lab-notch-lg",
  face: "lab-slab-face lab-notch-lg",
  head: "pl-[21px] pr-[11px]",
  /** 14px inside the face, which is 20px inside the card the wall belongs to. */
  edge: "right-5",
} as const;

export const OPEN = {
  // Nothing: the plate carries its own thickness as a plain `box-shadow`,
  // having no clip to cut one off.
  wall: "",
  /**
   * The surface an expanded card wears: the detail panel's own plate, at card
   * width. The border is the one part not in `.lab-plate` — the class carries
   * material and never a box — and it takes the accent rather than a hairline,
   * since a lit edge is what says which league is open when the card above it is
   * scrolled past.
   *
   * `group` is what {@link RowSheen}'s rail and sweep read their hover state
   * from.
   */
  face: "lab-plate group rounded-xl border border-active/25",
  head: "pl-5 pr-4",
  /** The same 14px, against a bordered box that runs the card's full width. */
  edge: "right-[15px]",
} as const;

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
 * **It is `sticky` at the bottom of the page's chrome, which is what makes the
 * cap a promise rather than a starting position.** Scrolled to the top and left
 * there, the open card walked straight back off the top of the screen the moment
 * a reader pulled on the list — and since the head is the one part of it that
 * says which league this panel belongs to, what was left was several hundred rows
 * of standings and rosters with nothing naming them. Pinned, the head and the
 * stat columns stay under that chrome for as long as the card is open (the head
 * takes no `sticky` of its own: it is already outside the box that scrolls, so
 * pinning the card pins it), and the rows behind it pass underneath — which they
 * can do because `.lab-plate`'s face is opaque.
 *
 * **That chrome is two parts, not one, and the second is measured.** The card
 * used to pin at the app bar's height alone, because opening a league unpinned
 * the chrome above it — which took both filter rows and the heading rail off
 * screen with it. The heading rail holds the top now (the manager plate and the
 * filter row scroll away with the page), so the offset is the bar plus that rail,
 * and the rail publishes its own height as `--list-ledge-h` (see
 * {@link usePinnedHeight}). Both terms are in the `max-h` as well as the `top`:
 * they are the same subtraction, and a cap that forgot the rail would hang the
 * panel's footer off the bottom of the screen by exactly the rail's height.
 *
 * Four details ride on it. `top` and `scroll-mt` are the same offset, so the
 * position the open-scroll aims at is exactly the one the card sticks at and the
 * two can't disagree by a pixel. The `z` is what keeps the cards *after* it from
 * painting over it — they are `relative` themselves, so DOM order would
 * otherwise win — and it stays below the heading rail's `z-30`, since the rail
 * has to cover what slides under it and the subject rail's search panel floats
 * down over this card. It replaces `relative` on the card rather than joining it:
 * `sticky` is a positioned element too, so the nameplate still has its containing
 * block, and two position utilities on one element is a fight decided by
 * Tailwind's alphabetical emission order rather than by anything readable here.
 * And it **paints the page ground**, which the resting card has no need to: the
 * nameplate hangs into the padding above the plate, and pinned under the chrome
 * that band would otherwise be a 12px window with the list sliding through it.
 */
export const OPEN_BOX =
  "sticky top-[calc(var(--site-header-h)+var(--list-ledge-h))] z-20 bg-[var(--background)] " +
  "flex max-h-[calc(100svh-var(--site-header-h)-var(--list-ledge-h)-1.5rem)] flex-col";

/**
 * The offset every scroll to this card aims at, and the one the open card sticks
 * at — the app bar's height plus the pinned heading rail's, so the browser does
 * that arithmetic in `calc()` rather than an effect adding two numbers up.
 *
 * `--list-ledge-h` is registered at `0px` in `globals.css`, so a list drawn with
 * no rail pinned over it resolves this to the bar alone rather than to an invalid
 * length that would drop the offset entirely.
 *
 * It is worn at **both** states rather than riding with the open box, because
 * the two scrolls happen at opposite ends of the gesture: opening aims at a card
 * about to become a panel, and the close correction aims at one that is already
 * a row again. Carried only while open, the second would land the row under the
 * chrome — and it is what that correction reads to decide whether the row is
 * behind it at all.
 */
export const SCROLL_OFFSET =
  "scroll-mt-[calc(var(--site-header-h)+var(--list-ledge-h))]";

/**
 * The league's name on the card's top edge, and the card's one focusable
 * control.
 *
 * The plate is the trades board's ({@link Nameplate}); what differs is what the
 * button *is*. A trade card's opens a league in a sheet, so it is a plain press;
 * this one toggles a panel that is part of the same card, so it carries the
 * disclosure semantics — `aria-expanded` and, while the panel is in the tree,
 * `aria-controls` pointing at it. The card's head press is the mouse affordance
 * over the same toggle and announces nothing.
 *
 * The status lamp rides after the name rather than in the head, because it says
 * something about the *league* and this plate is what names the league. Outside
 * the truncating heading, so a long name shortens rather than pushing the lamp
 * off the plate.
 */
function LeagueNameplate({
  name,
  status,
  expanded,
  panelId,
  onToggle,
}: {
  name: string;
  status: string;
  expanded: boolean;
  panelId: string | undefined;
  onToggle: () => void;
}) {
  return (
    // `row`, because this edge carries a second part: the plate is an item of
    // the row the card positions, so the name truncates against the ledge
    // rather than against a width guessed ahead of it.
    <Nameplate seat="row" trailing={<StatusLamp status={status} />}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        title="Standings and rosters for this league"
        className={NAMEPLATE_BUTTON}
      >
        {name}
      </button>
    </Nameplate>
  );
}

/**
 * A lamp on the nameplate standing in for the old text badge: the accent for a
 * league in season, amber for one still drafting, and a dark recess for anything
 * done. The status word rides on hover and for screen readers.
 *
 * The unlit state is `.lab-readout` rather than a dimmed fill, which is the
 * material saying it: the plate is the lightest surface on the card, so a grey
 * dot on it reads as a lamp that is *on* and grey, where a cut with the light
 * falling into it reads as one that is off. It is the same class the record
 * beside it wears, at 8px.
 */
function StatusLamp({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]"
      : status === "drafting" || status === "pre_draft"
        ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
        : "lab-readout";
  return (
    <span title={status.replace(/_/g, " ")} className="flex shrink-0 items-center">
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span className="sr-only">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

/**
 * The plate a card's second fact rides on.
 *
 * **It lives in `./nameplate` now** — the trade card became its third caller, and
 * this module statically imports {@link LeagueDetailPanel}, so reaching the ledge
 * through here would have pulled that whole subtree into the trades board's first
 * paint. Re-exported rather than moved outright, per the mover's usual habit: the
 * two lists that already import it from here keep one import, and there is still
 * exactly one definition.
 */
export { CardLedge } from "./nameplate";

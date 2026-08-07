import type { ReactNode } from "react";

/**
 * A card's name, on a plate straddling its top edge.
 *
 * **It is in `features/shared` because a second list wears it**, which is the
 * mover's rule rather than a filing preference: the trades board wrote it, the
 * leagues list draws the same part, and the two have to agree to the pixel or one
 * list reads as a slightly different product from the other. What is shared is
 * the plate's box, its rail and the heading's type — everything a reader judges
 * the part by. What is *not* shared is what the heading contains: a trade card's
 * plate opens a league, a league card's toggles a panel, and those are different
 * controls with different semantics (see each caller).
 *
 * Three things about it are load-bearing, and each is a way of getting it wrong:
 *
 * - **It must be a sibling of the card's face, never a child.** `clip-path` clips
 *   its whole subtree, so a plate rendered inside a notched face would be severed
 *   at the exact edge it exists to straddle. The caller is `relative`, and the
 *   overhang is that caller's *padding* rather than a negative margin — a part
 *   hanging outside the card's box drifts every measurement taken of it (which is
 *   what a windowed list does to every card in it).
 * - **It is a plate, not a chip.** Rectangular, no press travel, no bloom.
 *   "Raised means press me" belongs to the keys and pills; a plate with a lit top
 *   edge reads as a label stamped on a part, which is what makes it safe to hang
 *   a heading on whether or not that heading is also a button.
 * - **The heading is `h2`.** Both callers sit under one `h1` — the manager plate
 *   on one page, a visually-hidden title on the other — so a card is the next
 *   level down and a 3 here would skip one.
 */
export function Nameplate({
  children,
  trailing,
  seat = "edge",
}: {
  /**
   * What the plate names — the heading's own contents, so a caller that needs a
   * control passes a `<button>` and one that doesn't passes text. A `<button>`
   * takes phrasing content and a heading is flow, which is why the button goes
   * inside the `h2` rather than around it.
   */
  children: ReactNode;
  /**
   * Anything riding after the name — a status lamp. Outside the heading, so it
   * is not part of what the name announces, and outside the truncating span, so
   * a long name shortens rather than pushing it off the plate.
   */
  trailing?: ReactNode;
  /**
   * Where the plate seats itself. `edge` is a plate alone on a card's top edge,
   * positioning itself against a `relative` card. `row` is a plate sharing that
   * edge with another part, laid out by a flex row the caller owns — see
   * {@link SEAT}.
   */
  seat?: keyof typeof SEAT;
}) {
  return (
    <div
      className={`lab-nameplate ${SEAT[seat]} flex items-center gap-2 rounded-[5px] py-1 pl-2 pr-3`}
    >
      <span
        aria-hidden="true"
        className="lab-billet-rail h-4 w-0.5 shrink-0 rounded-sm"
      />
      {/* 12px rather than the 13px a card's face wears — one step down for the
          plate, not two. At 11px, tracked out and dimmed, the name was the
          hardest thing on the card to read: the plate is small, so the letters
          were doing the work the surface should, and a display face at that size
          loses more to tracking than it gains. `leading-4` is spelled rather than
          inherited because `truncate` clips what overflows, and a line box that
          depends on an ancestor is a clipped ascender waiting for someone to set
          one. */}
      <h2 className="min-w-0 truncate font-display text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground [text-shadow:0_1px_0_rgba(255,255,255,0.14),0_-1px_1px_rgba(0,0,0,0.9)]">
        {children}
      </h2>
      {trailing}
    </div>
  );
}

/**
 * The two seats, and the reason there are two.
 *
 * A plate alone on an edge can position itself, and capping it at
 * `calc(100% - 3rem)` is what leaves the card's trailing corner clear. **That
 * cap cannot express an edge with a second part on it**: what a name may take is
 * whatever the part beside it doesn't, and a `max-width` has no way to ask. So a
 * caller with two parts on one edge lays them out as a flex row it positions
 * itself, and the plate is a `min-w-0` item in it — which is what lets the name
 * truncate against a ledge whose width is its own contents (the leagues list's
 * record ledge).
 *
 * `pointer-events-auto` comes with that seat because the row it sits in has to
 * be `pointer-events-none`: a row spanning the whole edge would otherwise take
 * the presses that belong to the card underneath it, everywhere the two plates
 * aren't.
 */
const SEAT = {
  edge: "absolute left-3.5 top-0 z-10 max-w-[calc(100%-3rem)]",
  row: "pointer-events-auto min-w-0",
} as const;

/**
 * The plate a card's *second* fact rides on — the box, so the lists' ledges
 * cannot drift apart while what they hold differs.
 *
 * **It lives here rather than beside the league card that wrote it, and the
 * reason is a bundle rather than a filing preference.** The trade card is the
 * third caller (its ledge holds the instant), and `ui/league-card.tsx` statically
 * imports `LeagueDetailPanel` — two dense tables, a rank dial and a query hook.
 * Importing one name from that module pulls the whole subtree into the graph of
 * whatever imported it, which on the trades board is the first paint of a page
 * whose panel is deliberately behind a press (see `trades/league-sheet`). This
 * module imports nothing, so the ledge costs its callers a box and a class list.
 * `league-card.tsx` re-exports it under the mover's usual habit, so its own
 * consumers keep one import.
 *
 * `.lab-nameplate` rather than {@link Nameplate}: what is shared is the plate's
 * *material*, and that component is the plate with a heading in it — an `h2`
 * around a record, an opponent or a timestamp would be announcing a card's
 * second name. The box is here rather than in the class per the rule the whole
 * `.lab-*` layer keeps, which is what lets this one size to its contents while
 * the name's is sized to sit under a 12px display face.
 *
 * **It does not shrink, and it is capped instead — which is the one thing about
 * this box that is not obvious.** The edge is one flex row so that the name gives
 * way to whatever is beside it rather than to a width guessed ahead of time, and
 * the tempting spelling of "beside it" is `min-w-0 shrink`: let both parts give.
 * That is wrong here, because flex shrinks the *box* and its contents are free to
 * overflow it — a 71px plate around a 118px readout, hanging past the card and
 * off the right of a 390px screen. So the plate takes exactly what it needs, up
 * to a bound, and the name (which truncates) takes the rest. The bound is what
 * keeps a long opponent from doing to the name what the name was doing to it;
 * anything the caller puts in here past that width has to truncate for itself.
 *
 * `pointer-events-auto` because the row it sits in is `pointer-events-none` —
 * see each card's own note on why.
 */
export function CardLedge({ children }: { children: ReactNode }) {
  return (
    <div className="lab-nameplate pointer-events-auto flex max-w-[46%] shrink-0 items-center gap-2 rounded-[5px] py-0.5 pl-1 pr-2.5">
      {children}
    </div>
  );
}

/**
 * The class a control on the plate wears, so the two callers' buttons cannot
 * drift apart in shape while their behaviour differs.
 */
export const NAMEPLATE_BUTTON =
  "max-w-full cursor-pointer truncate rounded-[3px] outline-offset-2 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-active";

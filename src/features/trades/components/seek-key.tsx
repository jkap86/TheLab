"use client";

import { useEffect, useId, useRef, useState } from "react";

import { compactInput } from "@/features/shared/control-type";
import { MONTH_ABBREVIATIONS } from "@/features/shared/date-range";

import type { TradeSeek } from "../filters";

/**
 * Where in the board to start reading: one date, on the pinned control rail.
 *
 * **It is a position, not a window, and every decision here follows from that.**
 * The board is a keyset walk newest-first, so a date is a place to resume it and
 * everything older stays below — which is why there is one field where there
 * were two, no preset table, and nothing to leave half-filled. The page scrolls
 * the list back to its top when this moves, which is what makes it read as
 * travelling to the date rather than as slicing the board at it.
 *
 * **It is on the pinned rail because a position is not a setting.** It began as
 * a labelled date field filed with the scope and the league rules — the right
 * seat for something chosen once and then read, and the wrong one for the one
 * control here worth reaching for *while reading*, which is exactly when a block
 * at the top of the page is three screens up. That earned it a pinned seat of
 * its own, floating at the board's trailing edge; the seat is now the rail,
 * which is the same argument arriving at a better answer once a second control
 * needed pinning too.
 *
 * **What the rail gives it is an edge.** Floating, the key was a part with
 * nothing under it, so its plate rose out of a 40px block and landed over
 * whichever card the scroll had put beneath — a nameplate labelling whatever it
 * happened to be over. On the rail it labels the rail, which is what a date on
 * this page is a fact about: the band saying what board this is, and where in it
 * you are standing. Two things follow. The block is 34px rather than 40 — the
 * larger size was bought to keep a floating part off the first card's own instant
 * ledge, which is not a hazard it can meet seated in a row — and its plate hangs
 * `-bottom-[1.0625rem]`, measured against the *rail's* edge rather than the block's,
 * so it straddles the thing it names. Those two numbers are a pair: change the
 * block's height or the rail's padding and the plate no longer rides an edge.
 *
 * **The plate is drawn only on a travelled board.** At the top there is no
 * bound, so the key is unlit and there is no plate — absent rather than one
 * reading "today", which would be a bound on screen that the query string
 * deliberately does not carry. It wears `.lab-nameplate` directly rather than
 * reaching for `Nameplate`, on that component's own terms: what is shared is the
 * plate's *material*, and `Nameplate` is the plate with an `h2` in it — a
 * heading around a date would be announcing this key as a section.
 *
 * Three details are load-bearing:
 *
 * - **It shows today while holding null.** The default is "the newest trades",
 *   which is not a date — but an empty date field says nothing and invites a
 *   press to find out, where today's date says exactly where the board is.
 *   `tradeSeekBounds` folds the two together so neither spelling costs a second
 *   cache entry.
 * - **Picking today, or clearing the field, is the way back.** A reader who
 *   travelled back has the newest trades one press away without reaching for
 *   `Clear`, which would take their circle and their search with it.
 * - **`max` is today**, because there is nothing to seek to in the future and a
 *   calendar that opens on a month with no trades in it is a dead end.
 *
 * A native input inside the panel, so the platform's calendar, its keyboard
 * entry and its locale spelling all come free — the same call the two date
 * fields it replaces made.
 */
export function SeekKey({
  value,
  today,
  onChange,
}: {
  value: TradeSeek;
  /** Today where the reader is — passed in rather than read from the clock, so this renders the same on every re-render of the day. */
  today: string;
  onChange: (seek: TradeSeek) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const labelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The tools menu's own handlers, for the same reason: a floating panel that
  // cannot be dismissed by Escape or by pressing the page behind it is a panel
  // that has to be closed by the control that opened it, which is the one thing
  // a reader who opened it by accident will not think to do.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapper.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function travel(seek: TradeSeek) {
    onChange(seek);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    // `w-fit`, not merely `flex-none`: the plate below is centred on this box
    // (`left-1/2`), and a block-level flex container fills its parent — so in
    // any caller that isn't itself a flex row the plate would centre on the
    // whole column and float off to the right of the key. Shrink-to-fit here
    // makes the part self-contained rather than dependent on where it is seated.
    <div ref={wrapper} className="relative flex w-fit flex-none">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          value === null
            ? "Jump to a date — showing the newest trades"
            : `Jump to a date — showing trades from ${plateDate(value)} back`
        }
        title="Jump to a date"
        // The ADP block's material at 34px: the one part in the app that is a
        // *solid* rather than a face, so it reads as an object standing on the
        // rail rather than as a rectangle drawn in it — the same block the bar's
        // own ADP trigger wears, one seat over. Lit once the board is
        // positioned, which is the same signal that trigger uses for a narrowed
        // board — a state worth carrying because the alternative is a reader
        // scrolling a board that begins in June with nothing saying so.
        className={`lab-billet lab-notch-all inline-flex flex-none pb-[6px] pr-[6px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70 ${
          value === null ? "" : "lab-billet-lit"
        }`}
      >
        <span className="lab-billet-face lab-notch-all grid h-[2.125rem] w-[2.125rem] place-items-center">
          <CalendarGlyph seeking={value !== null} />
        </span>
      </button>

      {/* Outside the billet, never inside it: `clip-path` clips a whole subtree,
          so a plate rendered within the notched face would be severed at the
          exact edge it exists to straddle. The rail carries no clip of its own
          for the same reason, one box out. */}
      {value !== null && (
        <span
          aria-hidden
          // 17px, not the 10 this wore while floating: the offset is measured to
          // the *rail's* bottom edge, which is the block's own 34px plus the
          // rail's padding beneath it — see the note above on why those numbers
          // are a pair.
          className="lab-nameplate pointer-events-none absolute -bottom-[1.0625rem] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[3px] px-[0.4375rem] pb-[2.5px] pt-[2px] font-display text-[0.5625rem] font-semibold uppercase tracking-[0.045em] text-foreground/90"
        >
          {plateLabel(value, today)}
        </span>
      )}

      {open && (
        <div
          id={panelId}
          // Right-aligned under the key, because the key sits at the rail's
          // trailing edge and a panel opening the other way would run off the
          // page at 390px. The top margin clears the plate rather than the
          // block: the panel is wider than the key and would otherwise paint
          // over the lower half of the date it was opened to change.
          className="lab-plate absolute right-0 top-full z-10 mt-5 w-[15rem] rounded-2xl p-3"
        >
          <p
            id={labelId}
            className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-foreground/40"
          >
            Jump to
          </p>
          <input
            type="date"
            autoFocus
            aria-labelledby={labelId}
            value={value ?? today}
            max={today}
            onChange={(event) => {
              const picked = event.target.value;
              // An emptied field and today are both "the newest trades" — see
              // the note above. Anything past today would bound nothing anyway,
              // so it is folded here rather than left for the resolver to
              // discover.
              travel(!picked || picked >= today ? null : picked);
            }}
            // `compactInput` rather than the bare floor: this field states its
            // own box, so the half-step off `py-1.5` is what lands 16px type on
            // the 30px the panel was drawn with. Its width is `w-full` inside a
            // 240px panel, so the type costs nothing horizontally and the
            // native picker button stays — the lens in the ADP drawer is the
            // one that has to give that up for room.
            className={`w-full rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 ${compactInput} outline-none transition-colors focus:border-active/45`}
          />
          <p className="mt-2 flex items-center gap-2 text-[0.65625rem] text-foreground/40">
            {value === null ? (
              "Everything older is below."
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => travel(null)}
                  className="lab-chip lab-chip-sm shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold text-foreground/75"
                >
                  Today
                </button>
                back to the newest
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The plate's date, e.g. `JUN 30` — or with the year where it is not this one.
 *
 * Two words of type at 9px is what the plate has room for, so the year is
 * spent only where it says something: a board positioned inside the season being
 * read needs a month and a day, and one positioned in a past season needs to say
 * which. `today` rather than a clock, so the plate renders the same on every
 * re-render of the day.
 */
function plateLabel(seek: string, today: string): string {
  const [year, month, day] = seek.split("-");
  const label = `${MONTH_ABBREVIATIONS[Number(month) - 1]} ${Number(day)}`;
  return year === today.slice(0, 4) ? label : `${label} ${year.slice(2)}`;
}

/** The same date spelled out, for the key's own label. */
function plateDate(seek: string): string {
  const [year, month, day] = seek.split("-");
  return `${MONTH_ABBREVIATIONS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/**
 * A calendar with a day marked in it.
 *
 * The marked day takes the accent only while the board is positioned, so the
 * lit key and its glyph say one thing rather than two — the block's own glow is
 * the signal at a glance and this is what it resolves into up close.
 *
 * **It is drawn as a machined part rather than as a line icon**, which is what
 * the block around it has always been and what the flat outline version was the
 * one thing on it that wasn't. Three details carry that, and each is the app's
 * own grammar at 18px:
 *
 * - **The frame's stroke is graded, not a flat colour.** A lit top edge falling
 *   to a dim bottom one is how every raised face here reads, and at this size an
 *   even 1.2px outline is exactly what says "icon". It is the sanctioned
 *   exception to the token rule — a gradient may hold literal colour — so the
 *   two stops are spelled out and everything around them still takes a token.
 * - **The head band is filled and clipped to the frame**, which is the two-tone
 *   a real calendar tab has. Clipped rather than drawn as a second rounded rect,
 *   or its lower corners round off inside a box that isn't rounded there.
 * - **The days are a grid, and the marked one is the only lit thing in it.** The
 *   old glyph had one square in an otherwise empty box, so the square read as
 *   the whole subject; against five unlit days it reads as *a* day, which is
 *   what a date control is pointing at. The glow is spent only while positioned.
 *
 * `useId` for the gradient and the clip, the rule every drawn part here keeps:
 * two of these on one page must not collide over a hardcoded `id`.
 */
function CalendarGlyph({ seeking }: { seeking: boolean }) {
  const frameId = useId();
  const clipId = useId();
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      className="h-[1.125rem] w-[1.125rem] text-foreground"
    >
      <defs>
        <linearGradient id={frameId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eafaff" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#7099ad" stopOpacity="0.42" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="2" y="3.7" width="16" height="14.3" rx="3" />
        </clipPath>
      </defs>

      {/* The head band, clipped to the frame it sits inside. */}
      <rect
        x="2"
        y="3.7"
        width="16"
        height="4.6"
        clipPath={`url(#${clipId})`}
        className="fill-foreground/[0.16]"
      />

      <rect
        x="2"
        y="3.7"
        width="16"
        height="14.3"
        rx="3"
        stroke={`url(#${frameId})`}
        strokeWidth="1.05"
      />
      <path d="M2 8.3h16" className="stroke-foreground/20" strokeWidth="0.9" />
      <path
        d="M6.4 2.1v3M13.6 2.1v3"
        stroke={`url(#${frameId})`}
        strokeWidth="1.35"
        strokeLinecap="round"
      />

      {/* Every day but the marked one — cut to the same cell so the mark reads
          as *one of these, lit* rather than as the glyph's whole subject. Dots
          were the first spelling and were wrong for that: a round day beside a
          square one is two shapes, and the square stops being a date. */}
      {DAY_CELLS.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="1.8"
          height="1.8"
          rx="0.55"
          className="fill-foreground/25"
        />
      ))}

      <rect
        x="8.35"
        y="9.55"
        width="3.3"
        height="3.3"
        rx="1"
        className={
          seeking
            ? "fill-active drop-shadow-[0_0_3px_rgba(0,255,229,0.9)]"
            : "fill-foreground/45"
        }
      />
    </svg>
  );
}

/**
 * The unlit days, as top-left corners: two rows of three with the middle of the
 * top row left out, because that cell is the marked one. Written out rather than
 * generated — five pairs are shorter than the loop that would produce them, and
 * the hole is the point rather than an exclusion to be reasoned about.
 */
const DAY_CELLS: readonly (readonly [number, number])[] = [
  [4.4, 10.3],
  [13.8, 10.3],
  [4.4, 14.1],
  [9.1, 14.1],
  [13.8, 14.1],
];

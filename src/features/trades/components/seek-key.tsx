"use client";

import { useEffect, useId, useRef, useState } from "react";

import { MONTH_ABBREVIATIONS } from "@/features/shared/date-range";

import type { TradeSeek } from "../filters";

/**
 * Where in the board to start reading: one date, behind a key pinned under the
 * app bar.
 *
 * **It is a position, not a window, and every decision here follows from that.**
 * The board is a keyset walk newest-first, so a date is a place to resume it and
 * everything older stays below — which is why there is one field where there
 * were two, no preset table, and nothing to leave half-filled. The page scrolls
 * the list back to its top when this moves, which is what makes it read as
 * travelling to the date rather than as slicing the board at it.
 *
 * **It is pinned because a position is not a setting.** It used to be a labelled
 * date field in the controls block, filed with the scope and the league rules —
 * the right seat for something chosen once and then read, and the wrong one for
 * the one control here worth reaching for *while reading*. That is exactly when
 * the block holding it is three screens up: the board is a hundred thousand rows
 * deep, so travelling meant scrolling back to a control last touched an hour
 * ago. The sticky wrapper is the page's (see `TradesHome`), because a sticky
 * element only travels as far as its own parent's box and this one has to travel
 * the whole list.
 *
 * **Its date rides the bottom edge on a nameplate** — the trade card's own
 * device, a part rising out of an edge to label what is inside it. That is what
 * keeps a travelled board from lying about where it is: an icon alone says a
 * control exists, where the plate says the board begins at June 30. At the top
 * of the board there is no bound, so the key is unlit and no plate is drawn —
 * absent rather than a plate reading "today", which would be a bound on screen
 * that the query string does not carry. It wears `.lab-nameplate` directly
 * rather than reaching for `Nameplate`, on that component's own terms: what is
 * shared is the plate's *material*, and `Nameplate` is the plate with an `h2` in
 * it — a heading around a date would be announcing this key as a section.
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
        // *solid* rather than a face, so it reads as an object floating over the
        // board rather than as a rectangle drawn on it. Lit once the board is
        // positioned, which is the same signal that trigger uses for a narrowed
        // board — a state worth carrying because the alternative is a reader
        // scrolling a board that begins in June with nothing saying so.
        className={`lab-billet lab-notch-all inline-flex flex-none pb-[6px] pr-[6px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70 ${
          value === null ? "" : "lab-billet-lit"
        }`}
      >
        <span className="lab-billet-face lab-notch-all grid h-[34px] w-[34px] place-items-center">
          <CalendarGlyph seeking={value !== null} />
        </span>
      </button>

      {/* Outside the billet, never inside it: `clip-path` clips a whole subtree,
          so a plate rendered within the notched face would be severed at the
          exact edge it exists to straddle. */}
      {value !== null && (
        <span
          aria-hidden
          className="lab-nameplate pointer-events-none absolute -bottom-[9px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[3px] px-1.5 pb-[2px] pt-[1.5px] font-display text-[8.5px] font-semibold uppercase tracking-[0.04em] text-foreground/90"
        >
          {plateLabel(value, today)}
        </span>
      )}

      {open && (
        <div
          id={panelId}
          // Right-aligned under the key, because the key is pinned to the
          // board's trailing edge and a panel opening the other way would run
          // off the page at 390px.
          className="lab-plate absolute right-0 top-full z-10 mt-3 w-[15rem] rounded-2xl p-3"
        >
          <p
            id={labelId}
            className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40"
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
            className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-active/45"
          />
          <p className="mt-2 flex items-center gap-2 text-[10.5px] text-foreground/40">
            {value === null ? (
              "Everything older is below."
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => travel(null)}
                  className="lab-chip lab-chip-sm shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-foreground/75"
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
 * Two lines of type at 8.5px is what the plate has room for, so the year is
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
 */
function CalendarGlyph({ seeking }: { seeking: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      className="h-4 w-4 text-foreground/85"
    >
      <rect x="1.5" y="3" width="13" height="11.5" rx="2" />
      <path d="M1.5 6.5h13" />
      <path d="M5 1.5v3M11 1.5v3" strokeLinecap="round" />
      <rect
        x="6.6"
        y="9"
        width="2.8"
        height="2.8"
        rx="0.6"
        stroke="none"
        className={seeking ? "fill-active" : "fill-foreground/45"}
      />
    </svg>
  );
}

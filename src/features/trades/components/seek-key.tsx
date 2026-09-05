"use client";

import { useEffect, useRef, useState } from "react";

import { CONSOLE_KEY } from "@/features/shared";

import type { TradeSeek } from "../filters";

/**
 * The date control: **a position on the board, not a window over it.**
 *
 * The board is newest-first, so the only bound that means anything is the far
 * end — "show me from this day backwards". A pair of date inputs would offer a
 * second bound whose effect a reader could not see without scrolling to it, and
 * whose empty state ("from the beginning") is what the board already does.
 *
 * So one date, and clearing it is a first-class press rather than emptying a
 * field: `Today` is where the board opens, and it is what the reader is
 * returning to.
 *
 * A native `<input type="date">` in a small popover rather than a calendar
 * component — the platform's picker is a dependency this app does not have to
 * take, and it is the control a phone already knows how to show.
 */
export function SeekKey({
  seek,
  onChange,
  today,
}: {
  seek: TradeSeek;
  onChange: (seek: TradeSeek) => void;
  /** The reader's own today — see `useTodayIso` for why it is state. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Esc and an outside press both close it. Bound only while it is open, so a
  // closed control costs no listeners.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={CONSOLE_KEY}
      >
        {/* The key says what it is showing, not what pressing it does: with no
            seek the board runs to today, and saying so is what makes the
            cleared state legible without a second label. */}
        {seek ? `To ${seek}` : "To today"}
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 flex items-center gap-2 rounded-2xl border border-foreground/10 bg-[image:var(--panel-bg)] p-2 shadow-[var(--panel-shadow)]">
          <input
            type="date"
            value={seek ?? today}
            // Never past today: the board holds no trades from the future, so
            // a later date is a press with nothing behind it.
            max={today}
            onChange={(event) => onChange(event.target.value || null)}
            aria-label="Show trades up to"
            className="rounded-lg border border-foreground/12 bg-foreground/[0.04] px-2.5 py-1.5 font-mono text-[length:var(--fs-12)] text-foreground/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          />
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            // Disabled rather than hidden: a control that appears only
            // sometimes is one a reader has to look for.
            disabled={seek === null}
            className={`${CONSOLE_KEY} disabled:opacity-40 disabled:shadow-none`}
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}

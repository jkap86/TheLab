"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type ToolsMenuLink = {
  /** The route the key lights on — `tool.href`, not the resolved `href`. */
  base: string;
  /** Where it goes: `toolHref(tool, username)`. */
  href: string;
  text: string;
};

/**
 * The rack's tool navigation, as one key that opens a menu.
 *
 * It replaces the six-key horizontal track. Two reasons, and the second is the
 * one that made it worth doing: the rack's width grew with the tool registry —
 * `tools.ts` is documented as heading for eight to ten entries — and below
 * `md` the track was already an `overflow-x-auto` row, so the tools past
 * Trades were reachable only by a horizontal swipe nobody would guess at. One
 * key costs the same width at six tools as at ten.
 *
 * The key names the page you are *on* rather than saying "Tools", so the rack
 * still reports where you are; that is what the lit key in the old track did,
 * and losing it would be losing the only thing the nav said besides its list.
 *
 * **The tools page renders none of this** — see `app-rack.tsx`. The grid there
 * is the tool list, and a menu of the same six names above it is a second copy
 * of the page's own content.
 *
 * A native `<dialog>` is deliberately not used here, where the league filters
 * and the columns picker both do: those are modal, and a nav menu that trapped
 * focus and dimmed the page to offer six links would be heavier than the links
 * are worth. So the dismissal it would have given for free is spelled out
 * below instead.
 */
export function ToolsMenu({
  links,
  currentBase,
}: {
  links: ToolsMenuLink[];
  /** The matched `base`, or null on a route no tool owns. */
  currentBase: string | null;
}) {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Pointerdown rather than click, and in the capture phase: a press that
    // starts outside should dismiss before whatever it landed on acts on it.
    const onDown = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape returns focus to the key it came from — the one piece of the
    // `<dialog>` behaviour that is not optional.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = links.find((link) => link.base === currentBase);

  return (
    <nav
      ref={nav}
      aria-label="Tools"
      // The deep channel a single raised key travels in — `CONSOLE_TRACK`,
      // plus the `relative` the menu positions against.
      className="relative flex items-center rounded-full bg-[image:var(--key-bg)] p-1 shadow-[var(--track-shadow)] md:order-3"
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full bg-[image:var(--key-bg)] py-[0.4375rem] pl-3 pr-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)] transition-[transform,box-shadow,color] duration-150 active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 md:px-3.5 md:py-2 md:tracking-[0.16em]"
      >
        {current?.text ?? "Tools"}
        <ChevronMark open={open} />
      </button>

      {open && (
        // A shallow tray of block keys: `CONSOLE_WELL`'s surface with a cast
        // shadow added, which is why the classes are spelled out rather than
        // composed — a second `shadow-[…]` utility beside the constant's own
        // would be a coin flip over which one Tailwind emitted last.
        <div
          role="menu"
          aria-label="Tools"
          className="absolute left-0 top-full z-50 mt-2.5 min-w-[14.875rem] rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] p-1.5 shadow-[var(--well-shadow),0_24px_44px_-20px_#000]"
        >
          {links.map((link) => {
            const isCurrent = link.base === currentBase;
            return (
              <Link
                key={link.base}
                role="menuitem"
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                // Closing on click is not redundant with the route change: the
                // current page's own entry navigates nowhere, so nothing else
                // would dismiss it.
                onClick={() => setOpen(false)}
                className={`mt-0.5 flex w-full items-center justify-between gap-3 rounded-[0.625rem] border px-3 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] transition-[color,background-color] duration-150 first:mt-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                  isCurrent
                    ? "border-foreground/10 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                    : "border-transparent text-foreground/60 hover:bg-foreground/[0.04] hover:text-readout"
                }`}
              >
                {link.text}
                {/* The lamp beside the page you are on. It says the same thing
                    the lit key does, for the case where the menu is open over
                    the key and the two are read together. */}
                {isCurrent && (
                  <span
                    aria-hidden
                    className="size-[0.4375rem] shrink-0 rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)]"
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

/** Points at the menu when it is open. Rotated, not swapped, so it travels. */
function ChevronMark({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9.5l6 5.5 6-5.5" />
    </svg>
  );
}

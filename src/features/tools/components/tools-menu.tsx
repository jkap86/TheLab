"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/features/shared";

export type ToolsMenuLink = {
  /** The route the key lights on — `tool.href`, not the resolved `href`. */
  base: string;
  /** Where it goes: `toolHref(tool, username)`. */
  href: string;
  text: string;
  /**
   * The rack's own name for this tool below `sm`, where the wordmark is beside
   * it and the row has no slack. From the tool registry rather than truncated
   * here — see `Tool.short`. Absent means {@link ToolsMenuLink.text} already
   * fits.
   *
   * **Read by the rack's tool-name readout, not by this menu.** The tray's
   * entries keep the full name at every width: they sit in a tray with room
   * for it, and a list that abbreviated would be naming the tools by two
   * vocabularies on one screen.
   */
  short?: string;
};

/**
 * The rack's tool navigation, as one icon key that opens a tray.
 *
 * It replaces the six-key horizontal track. Two reasons, and the second is the
 * one that made it worth doing: the rack's width grew with the tool registry —
 * `tools.ts` is documented as heading for eight to ten entries — and below
 * `md` the track was already an `overflow-x-auto` row, so the tools past
 * Trades were reachable only by a horizontal swipe nobody would guess at. One
 * key costs the same width at six tools as at ten.
 *
 * **The key carried the current tool's name and no longer does.** That was the
 * one thing the nav said besides its list, and losing it would have been
 * losing the rack's "you are here" — so it did not go, it moved: `app-rack.tsx`
 * draws the name as an engraved readout to the key's left. Standing on its own
 * it reports without pretending to act, and what it buys is the wordmark back
 * at every phone width, which a key wide enough to hold a tool name could not
 * afford beside it. The tray still lights the row you are on, which is the same
 * news for the moment the tray covers the readout.
 *
 * **The tools page renders none of this** — see `app-rack.tsx`. The grid there
 * is the tool list, and a menu of the same names above it is a second copy of
 * the page's own content. That is also why the tray no longer carries a
 * `/tools` entry of its own: the brand link already goes there.
 *
 * **The theme control lives in the tray**, as its last row under a milled
 * hairline. It is the one row that is not navigation, which is what the
 * hairline says; it is also the one row that does **not** dismiss the tray. The
 * others navigate, so closing is right for them, where a toggle is something
 * the reader may want to watch land — and the tray is now where it lives.
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

  const row =
    "flex w-full items-center justify-between gap-3 rounded-[0.625rem] border px-3 py-2.5 " +
    "font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] " +
    "transition-[color,background-color] duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";
  const unlitRow =
    "border-transparent text-foreground/60 hover:bg-foreground/[0.04] hover:text-readout";

  return (
    <nav
      ref={nav}
      aria-label="Tools"
      // The deep channel a single raised key travels in — `CONSOLE_TRACK`,
      // plus the `relative` the tray positions against. It sits at the right
      // end of the rack: last in the row below `md`, and `md:ml-auto` above it,
      // where it takes the slack the theme pad used to.
      //
      // 3px of channel below `md` against 4 above, which is the same 2px the
      // brand's bezel gave up one end of the row and for the same reason: the
      // phone rack is carrying two Browse caps it did not carry before. The
      // key inside keeps its 32px, so what narrows is the surround rather than
      // the target.
      className="relative flex shrink-0 items-center rounded-full bg-[image:var(--key-bg)] p-[0.1875rem] shadow-[var(--track-shadow)] md:order-6 md:ml-auto md:p-1"
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Tools and settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        // Icon-only at both widths, and machined rather than filled: the
        // Browse keys beside it are the rack's one accent cap, and two filled
        // objects in one pill would put the emphasis nowhere.
        //
        // **Its own face below `md`**, on the phone pill's argument at the
        // smallest grain this rack has: `--key-bg` is a vertical gradient, and
        // a vertical gradient on a 32px circle reads as a flat disc — it needs
        // a corner for the light to come from before it reads as domed, which
        // is what `--rack-key-bg`'s radial gives it. The glyph takes an emboss
        // of its own for `--cap-glyph-emboss`'s reason: a `drop-shadow`, so the
        // highlight follows the four rounded squares rather than the box round
        // them. Both revert at `md`, where the key is 2.5px larger in a housing
        // 10px taller and the flat face has room to read.
        className={`inline-flex shrink-0 items-center rounded-full bg-[image:var(--rack-key-bg)] p-2 shadow-[var(--rack-key-shadow)] transition-[transform,box-shadow,color] duration-150 active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 [&_svg]:[filter:var(--rack-key-emboss)] md:bg-[image:var(--key-bg)] md:p-2.5 md:shadow-[var(--key-shadow)] md:[&_svg]:[filter:none] ${
          open
            ? "text-readout [text-shadow:var(--readout-text-glow)]"
            : "text-foreground/80 hover:text-readout"
        }`}
      >
        <GridMark />
      </button>

      {open && (
        // A shallow tray of block keys: `CONSOLE_WELL`'s surface with a cast
        // shadow added, which is why the classes are spelled out rather than
        // composed — a second `shadow-[…]` utility beside the constant's own
        // would be a coin flip over which one Tailwind emitted last.
        //
        // **`right-0`, at both widths.** The trigger is the rightmost object in
        // the pill now, and a tray hung from its left edge runs ~90px off the
        // screen at 390.
        <div
          role="menu"
          aria-label="Tools"
          className="absolute right-0 top-full z-50 mt-2.5 min-w-[14.875rem] rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] p-1.5 shadow-[var(--well-shadow),0_24px_44px_-20px_#000]"
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
                className={`${row} mt-0.5 first:mt-0 ${
                  isCurrent
                    ? "border-foreground/10 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                    : unlitRow
                }`}
              >
                {link.text}
                {/* The lamp beside the page you are on. It says the same thing
                    the rack's tool-name readout does, for the case where the
                    open tray covers that readout and the two are read
                    together. */}
                {isCurrent && (
                  <span
                    aria-hidden
                    className="size-[0.4375rem] shrink-0 rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)]"
                  />
                )}
              </Link>
            );
          })}

          {/* What separates the navigation from the one row that is not it. */}
          <span
            aria-hidden
            className="mx-1 my-1.5 block h-px bg-[var(--milled-hairline)] shadow-[var(--milled-hairline-highlight)]"
          />

          {/*
            The theme row. `ThemeToggle` renders both faces and lets
            `globals.css` show the one that matches, which is exactly what a row
            reading "the theme a press switches *to*" needs — so it takes this
            row's chrome through `className` and is otherwise untouched.

            **The word `Theme` is rendered here rather than by the toggle**, and
            that is what leaves the component alone: the row wants a label on
            the left of a `justify-between` row, which the two-faces-in-one-span
            structure cannot express. It is `aria-hidden`, because each face
            already carries the full sentence that names the button; a visible
            "Theme" would only prepend a token to it.

            It deliberately does **not** dismiss the tray — see the module note.
          */}
          <ThemeToggle
            className={`group ${row} ${unlitRow} bg-transparent`}
            leadingLabel={
              <span aria-hidden className="group-hover:text-readout">
                Theme
              </span>
            }
            // The reading is a step brighter than the label naming it, which
            // is the console's own grammar for a value beside its caption —
            // and it lights with the row rather than staying pinned, which is
            // what the `group` above is for.
            faceClassName="text-foreground/80 group-hover:text-readout"
            labelClassName=""
          />
        </div>
      )}
    </nav>
  );
}

/**
 * The menu glyph: a 2×2 grid of keys, which is the console's own picture of a
 * rack of tools. Chosen over a dot grid, bars, a kebab, a cog and a
 * ring-and-dot; sliders was never a candidate, since the Browse key owns it.
 */
function GridMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </svg>
  );
}

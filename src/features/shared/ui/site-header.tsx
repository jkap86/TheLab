"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ToolsMenu } from "./tools-menu";

/**
 * The app bar: the one piece of global chrome.
 *
 * Three zones, left to right — the mark home, a contextual slot, and the tools
 * menu. It is **pinned**, so both the way home and the way to any other tool are
 * reachable from the bottom of a several-hundred-row list and not only from the
 * top of it. Its height is `--site-header-h` rather than padding, because the
 * manager card pins itself directly underneath and has to know where this ends.
 *
 * **It carries a route list now, which the note here used to forbid.** The rule
 * was that a second navigation system on one page competes with the first; what
 * it produced instead was `/tools` as a mandatory waypoint between any two
 * tools, since the bar's single link home was the only way out of one. The menu
 * is not a second system — it is the *only* one, the tools grid reached without
 * the round trip, read from the same catalogue that grid renders. `children`
 * stays what it was: chrome belonging to the section you are already in
 * (`ManagerTabs` today), movement *within* a tool rather than between tools.
 * That slot is still filled by `app/layout.tsx` rather than by this file
 * importing a feature; the menu can live here because the catalogue moved to
 * `features/shared` when the bar became its second reader.
 *
 * The glass — a translucent background over `backdrop-blur` — is what makes it
 * read as a layer above the page rather than a strip of the same colour. It
 * replaces an opaque fill and needs no other change: the manager card pinned
 * underneath paints `--background` itself, so nothing shows through the seam
 * between them.
 *
 * Hidden on `/tools` itself: the wordmark and the whole tool list are that
 * page, so the bar would be a smaller copy of what is already on screen.
 * `usePathname` is why this is a client component.
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/tools") return null;

  return (
    <header className="sticky top-0 z-50 border-b border-foreground/10 bg-[var(--surface-glass)] backdrop-blur-xl">
      {/* The accent hairline: the app's one colour, laid along the edge the bar
          ends at, brightest under the content and fading to the gutters. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-active/45 to-transparent"
      />
      {/* Match `PageShell`'s container so the wordmark lines up with the page
          content below it rather than floating at the viewport edge. */}
      <div className="group/bar mx-auto flex h-[var(--site-header-h)] w-full max-w-4xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Wordmark />
        {children}
        {/* Pushes the menu to the far edge whether or not the slot is filled. */}
        <div className="ml-auto flex-none">
          <ToolsMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * The way home: the flask mark, with the wordmark beside it.
 *
 * **The text drops out on a phone only when the contextual slot is filled.** A
 * bar seating three manager tabs *and* the tools trigger has no room for it at
 * 390px, and a logo is the one element that still says where you are without
 * its text — but on every other page there is room, and a bare glyph over an
 * empty bar is a worse trade. The slot renders itself (`ManagerTabs` decides
 * from the route whether it exists at all), so the bar can't be told in props
 * what is in it; `group-has-[[data-bar-slot]]` asks the DOM instead, and the
 * marker attribute is what keeps the menu's own `<nav>` from matching. `max-sm:`
 * is load-bearing rather than tidy: `:has()` outweighs a plain breakpoint
 * utility, so an `sm:inline` after it would not win. The bar's group is *named*
 * (`group/bar`) for a subtler reason — `group-hover` matches any `.group`
 * ancestor, not the nearest, so an unnamed group on the bar would light this
 * link's hover treatment up from anywhere in the bar, including the tools
 * trigger at the far end.
 *
 * It is drawn here rather than reusing `FlaskLoader`, which is an animated
 * four-keyframe loading mark; this is a still glyph, and the two would fight
 * over what a flask on screen means.
 *
 * The wordmark takes the gradient the tools page's headline wears — the
 * `foreground` token fading into a pale teal, a literal because a gradient stop
 * has no token to read — so the two spellings of "The Lab" read as one brand.
 */
function Wordmark() {
  return (
    <Link
      href="/tools"
      aria-label="The Lab — all tools"
      className="group flex flex-none items-center gap-2.5"
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-foreground/12 bg-foreground/[0.05] transition-colors duration-300 group-hover:border-active/50 group-hover:bg-active/10">
        {/* The lit halo behind the glass tile, on hover only. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 shadow-[0_0_18px_-2px_var(--color-active)] transition-opacity duration-300 group-hover:opacity-100"
        />
        <FlaskGlyph />
      </span>
      <span className="bg-gradient-to-b from-foreground to-[#8feee6] bg-clip-text font-display text-[13px] font-bold uppercase tracking-[0.18em] text-transparent max-sm:group-has-[[data-bar-slot]]/bar:hidden">
        The Lab
      </span>
    </Link>
  );
}

/** A still conical flask: neck, shoulders, and a filled base. */
function FlaskGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      className="h-[18px] w-[18px] text-active"
    >
      <path
        d="M10 3h4M10.75 3v6.2L5.6 17.4A2.4 2.4 0 0 0 7.6 21h8.8a2.4 2.4 0 0 0 2-3.6L13.25 9.2V3"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The liquid: the accent at low opacity, so the outline stays the shape
          the eye reads and the fill is only a tint inside it. */}
      <path
        d="M7.9 15.2h8.2l2.3 3.6a2 2 0 0 1-1.7 3H7.3a2 2 0 0 1-1.7-3l2.3-3.6Z"
        fill="currentColor"
        opacity={0.28}
      />
    </svg>
  );
}

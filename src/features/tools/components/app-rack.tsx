"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import {
  ThemeToggle,
  useRackReadout,
  useStoredAccount,
} from "@/features/shared";

import { tools } from "../constants/tools";
import { toolHref } from "../helpers/tool-href";
import { FlaskMark } from "./flask-mark";

/**
 * The app rack: a floating housing carrying the wordmark, the tool links, the
 * season readout and the theme key.
 *
 * The app had no navigation at all before this — every page was reached from
 * the tool grid or from a typed URL — so the rack is the one genuinely new
 * object in the console rather than a restyling of an old one. It floats with
 * a visible gap on all sides and is not welded to the viewport edge: it is a
 * rack unit sitting *on* the ground, which is what the full-bleed background
 * under it is for.
 *
 * **It lives in `features/tools` rather than `features/shared`**, which is the
 * one placement worth explaining. Everything it is made of is this folder's
 * own — the tool registry, `toolHref`, the flask mark, the engraved wordmark
 * treatment — and `features/tools` may import `features/shared` where the
 * reverse would invert the layering. Mounting it in `layout.tsx` is `app/`
 * reaching for a feature, which is the direction routes already import in.
 *
 * Two things it deliberately does not do:
 *
 * 1. **It renders no `<h1>`.** The wordmark here is two `<span>`s, where
 *    `LabWordmark` engraves the same string into a plate around a heading. A
 *    rack on every page would otherwise put a second `<h1>` above each page's
 *    own — the manager name, the tools headline — and the pages are right.
 * 2. **It holds no manager state.** The season readout comes from
 *    `useRackReadout`, which a page publishes into; a page that publishes
 *    nothing simply has no pill.
 */
export function AppRack() {
  const pathname = usePathname();
  const account = useStoredAccount();
  const readout = useRackReadout();

  // `base` is what lights the key and `href` is where it goes, and they differ
  // for exactly the tools that take an account: Manager points at
  // `/manager/<username>` once one is stored, but `/manager/anyone` is still
  // the Manager page. Matching on the resolved href would leave the rack unlit
  // on someone else's page.
  const links = useMemo(
    () => [
      { base: "/tools", href: "/tools", text: "Tools" },
      ...tools.map((tool) => ({
        base: tool.href,
        href: toolHref(tool, account?.username ?? null),
        text: tool.text,
      })),
    ],
    [account],
  );

  return (
    <div className="mx-auto mt-6 w-full max-w-6xl px-3.5 md:px-4">
      {/*
        Below `md` the rack is two stacked objects — a brand pill and the nav
        track under it — and above it they are one row. Rather than render two
        trees, the brand row becomes `display: contents` at `md`: its box stops
        existing, its children join this flex container directly, and `order`
        puts them back in the reading order the wide layout wants. That is also
        why the pill chrome is on *this* element above `md` and on the row
        below it beneath — there is only ever one box painting it.
      */}
      <div className="flex flex-wrap items-center gap-y-2.5 md:gap-x-4 md:rounded-full md:border md:border-foreground/8 md:bg-[image:var(--key-bg)] md:p-2 md:shadow-[var(--key-shadow),var(--plate-shadow)]">
        <div className="flex w-full items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-1.5 pl-1.5 pr-2 shadow-[var(--key-shadow),var(--plate-shadow)] md:contents">
          <Link
            href="/tools"
            className="inline-flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 md:order-1"
          >
            {/* The flask is sized by attribute, which CSS overrides — so the
                bezel steps the glyph down at a phone's width without a second
                copy of the mark. */}
            <span
              aria-hidden
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)] [&_svg]:size-5 md:size-11 md:[&_svg]:size-6"
            >
              <FlaskMark />
            </span>
            {/* The same two-layer engraving as the plate: an extrusion under a
                gradient clipped to the glyphs. `nowrap` on both, for
                `LabWordmark`'s reason — a face that wraps under an extrusion
                that cannot leaves a ghost "LAB" beside it. */}
            <span className="relative inline-block whitespace-nowrap font-display text-[0.9375rem] font-bold uppercase leading-none tracking-[0.09em] md:text-[1.125rem]">
              <span
                aria-hidden
                className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]"
              >
                The Lab
              </span>
              <span className="relative inline-block bg-[image:var(--chrome-face)] bg-clip-text text-transparent [filter:var(--wordmark-depth)]">
                The Lab
              </span>
            </span>
          </Link>

          {/* The theme key, in a recessed pad of its own. Icon-only at a
              phone's width, where the legend is the first thing to go. */}
          <div className="ml-auto shrink-0 rounded-full bg-[image:var(--key-bg)] p-1 shadow-[var(--track-shadow)] md:order-5 md:ml-0">
            <ThemeToggle
              className={
                "inline-flex items-center gap-2 rounded-full bg-[image:var(--key-bg)] p-[0.4375rem] " +
                "font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 " +
                "shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 " +
                "hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                "md:px-3.5 md:py-2"
              }
              labelClassName="hidden md:inline"
            />
          </div>
        </div>

        <span
          aria-hidden
          className="hidden w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)] md:order-2 md:my-1 md:block"
        />

        {/* A recessed track with the current page raised out of it as a lit
            key. It scrolls rather than wrapping at a phone's width: a nav that
            reflows to two lines moves the rack's height with the route. */}
        <nav
          aria-label="Tools"
          className="flex w-full items-center gap-1 overflow-x-auto rounded-full bg-[image:var(--key-bg)] p-1 shadow-[var(--track-shadow)] md:order-3 md:w-auto"
        >
          {links.map((link) => {
            const current =
              pathname === link.base || pathname.startsWith(`${link.base}/`);
            return (
              <Link
                key={link.base}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-[0.4375rem] font-mono text-[0.6875rem] uppercase tracking-[0.14em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 md:px-3.5 md:py-2 md:tracking-[0.16em] ${
                  current
                    ? "bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                    : "text-foreground/60 hover:bg-foreground/[0.04] hover:text-readout"
                }`}
              >
                {link.text}
              </Link>
            );
          })}
        </nav>

        {/* Whose page this is. Hidden below `md`, where row one has room for
            the brand and the theme key and nothing else. */}
        {readout && (
          <span className="relative ml-auto hidden shrink-0 items-center gap-2.5 overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-[0.4375rem] shadow-[var(--readout-shadow)] md:order-4 md:inline-flex">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
            />
            <span
              aria-hidden
              className="lab-anim relative size-[0.4375rem] shrink-0 rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)]"
              style={{ animation: "tools-pulse 2.4s ease-out infinite" }}
            />
            <span className="relative font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)]">
              {readout.username}
              {readout.season && ` · ${readout.season}`}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

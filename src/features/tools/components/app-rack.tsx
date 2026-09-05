"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import {
  ThemeToggle,
  useRackControls,
  useStoredAccount,
} from "@/features/shared";

import { tools } from "../constants/tools";
import { toolHref } from "../helpers/tool-href";
import { FlaskMark } from "./flask-mark";
import { RackControlsKeys } from "./rack-controls-keys";
import { ToolsMenu } from "./tools-menu";

/**
 * The app rack: a pinned housing carrying the wordmark, the tool menu, the
 * page's own controls and the theme key.
 *
 * The app had no navigation at all before this — every page was reached from
 * the tool grid or from a typed URL — so the rack is the one genuinely new
 * object in the console rather than a restyling of an old one. It sits flush
 * against the top edge in a gutter of its own: a rack unit racked *into* the
 * ground rather than a bar spanning it, which is what the full-bleed background
 * around it is for.
 *
 * **It is `fixed`, and the whole of that is the outer wrapper.** `mt-6` became
 * `top-6` when it was pinned, and `top-6` became `top-0` when it went flush:
 * the gap above a fixed rack is ground the page can never use, where the gutter
 * either side is what still makes it a unit. What pinning buys is the reason
 * the controls could move up here at
 * all: on a hundred-league page the header scrolls away after two cards, and a
 * Filters key that has scrolled away is a Filters key you have to scroll back
 * for. Being out of flow, it leaves nothing behind — the shell's top padding
 * carries its height, as `--rack-clear` in `globals.css`, which is one number
 * rather than two spellings that drift the first time a key's padding changes.
 *
 * **It lives in `features/tools` rather than `features/shared`**, which is the
 * one placement worth explaining. Everything it is made of is this folder's
 * own — the tool registry, `toolHref`, the flask mark, the engraved wordmark
 * treatment — and `features/tools` may import `features/shared` where the
 * reverse would invert the layering. Mounting it in `layout.tsx` is `app/`
 * reaching for a feature, which is the direction routes already import in. It
 * is also why `LineupColumnsDialog` moved into `features/shared`: a rack that
 * reached into `features/manager` for it would be one sibling feature importing
 * another.
 *
 * Two things it deliberately does not do:
 *
 * 1. **It renders no `<h1>`.** The wordmark here is two `<span>`s, where
 *    `LabWordmark` engraves the same string into a plate around a heading. A
 *    rack on every page would otherwise put a second `<h1>` above each page's
 *    own — the manager name, the tools headline — and the pages are right.
 * 2. **It holds no page state.** The controls come from `useRackControls`,
 *    which a page publishes into; a page that publishes nothing simply has no
 *    controls. That is the same rule the lit account pill used to live by —
 *    which is gone, because the identity plate names the manager and the season
 *    now and the pill was a second answer to a question already answered. Its
 *    ~185px is what the two control tracks took.
 */
export function AppRack() {
  const pathname = usePathname();
  const account = useStoredAccount();
  const controls = useRackControls();

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

  const currentBase =
    links.find(
      (link) =>
        pathname === link.base || pathname.startsWith(`${link.base}/`),
    )?.base ?? null;

  // **The tools page carries no tool menu.** Its grid *is* the list, and a
  // menu of the same names directly above it is a second copy of the page's
  // own content — the same argument that took the wordmark plate off that
  // page, where the rack already engraves "The Lab". The groove goes with it,
  // since a separator with nothing on its far side is a rule.
  const showMenu = currentBase !== "/tools";

  return (
    // Pinned and **flush**: `top-0`, where it used to float clear at `top-6`.
    // The horizontal gutter and the pill shape stay, so it still reads as a
    // rack unit rather than as a bar welded across the top — what goes is the
    // 24px of ground showing above it, which on a scrolling page was a strip
    // of console nothing ever occupied. `--rack-clear` lost the same 1.5rem on
    // all three arms, so the gap *under* the rack is unchanged.
    <div className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-6xl px-3.5 md:px-4">
      {/*
        Below `md` the rack is two stacked objects — a brand pill and the nav
        track under it — and above it they are one row. Rather than render two
        trees, the brand row becomes `display: contents` at `md`: its box stops
        existing, its children join this flex container directly, and `order`
        puts them back in the reading order the wide layout wants. That is also
        why the pill chrome is on *this* element above `md` and on the row
        below it beneath — there is only ever one box painting it.
      */}
      <div className="flex flex-wrap items-center gap-y-2.5 md:gap-x-4 md:rounded-full md:border md:border-foreground/8 md:bg-[image:var(--key-bg)] md:p-2 md:shadow-[var(--key-shadow),var(--plate-shadow),var(--rack-cast)]">
        {/* The third shadow is new with the pinning: content now passes *under*
            the rack, and a housing with no cast shadow reads as printed on the
            page rather than standing over it. A token, not an `rgba()` in the
            class string, for `globals.css`'s reason — a shadow written for the
            dark ground only smears on the light one. */}
        <div className="flex w-full items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-1.5 pl-1.5 pr-2 shadow-[var(--key-shadow),var(--plate-shadow),var(--rack-cast)] md:contents">
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
            {/* The link's name, at every width — the engraving below is
                `aria-hidden` because it is two copies of this string and only
                one of them is ever a word. */}
            <span className="sr-only">The Lab</span>
            {/*
              The same two-layer engraving as the plate: an extrusion under a
              gradient clipped to the glyphs. `nowrap` on both, for
              `LabWordmark`'s reason — a face that wraps under an extrusion that
              cannot leaves a ghost "LAB" beside it.

              **It is the flask alone below `sm`, and that is a measurement.**
              The rack is one row at every width — a constraint rather than an
              observation, since `--rack-clear` is three values and not five —
              so a row that does not fit does not wrap, it overflows the pill.
              With the wordmark on, the row's content is ~370px against a
              362px pill at 390: it fits from ~412px up and not below, which is
              most phones. The wordmark is what goes, on the theme key's own
              precedent that the legend is the first thing to drop — the flask
              *is* the mark, and it stays. `sm` rather than a bespoke 412px
              because the house has one vocabulary of breakpoints and a tablet
              has room for both.
            */}
            <span
              aria-hidden
              className="relative hidden whitespace-nowrap font-display text-[length:var(--fs-15)] font-bold uppercase leading-none tracking-[0.09em] sm:inline-block md:text-[length:var(--fs-18)]"
            >
              <span className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]">
                The Lab
              </span>
              <span className="relative inline-block bg-[image:var(--chrome-face)] bg-clip-text text-transparent [filter:var(--wordmark-depth)]">
                The Lab
              </span>
            </span>
          </Link>

          {/* The tool menu rides in the brand row below `md` — one key fits
              beside the wordmark where the six-key track never did, which is
              what removes the second stacked row a phone used to get. */}
          {showMenu && (
            <div className="ml-auto shrink-0 md:contents">
              <ToolsMenu links={links} currentBase={currentBase} />
            </div>
          )}

          {/* This page's own controls, published upward by whatever is under
              the rack — see `RackControlsKeys`, which also owns the answer to
              what four keys do below `md`. */}
          {controls && <RackControlsKeys controls={controls} />}

          {/* The theme key, in a recessed pad of its own. Icon-only at a
              phone's width, where the legend is the first thing to go.

              `ml-auto` unconditionally now, at both widths: the lit account
              pill used to take the row's slack above `md`, and with it gone
              there is nothing to the key's right for the slack to sit under. */}
          <div className="ml-auto shrink-0 rounded-full bg-[image:var(--key-bg)] p-1 shadow-[var(--track-shadow)] md:order-6">
            <ThemeToggle
              className={
                "inline-flex items-center gap-2 rounded-full bg-[image:var(--key-bg)] p-[0.4375rem] " +
                "font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/80 " +
                "shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 " +
                "hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                "md:px-3.5 md:py-2"
              }
              labelClassName="hidden md:inline"
            />
          </div>
        </div>

        {showMenu && (
          <span
            aria-hidden
            className="hidden w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)] md:order-2 md:my-1 md:block"
          />
        )}
      </div>
    </div>
  );
}

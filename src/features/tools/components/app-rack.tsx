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
 * The app rack: a pinned housing carrying the wordmark, the name of the tool
 * you are in, the page's own controls and one key that opens the tool tray.
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
 * **Four objects, and each says one thing.** The brand link goes to the tool
 * grid, the readout names the tool you are in, the Browse keys act on the page
 * under the rack, and the tool key opens the tray. That separation is what let
 * the wordmark come back at every phone width — see the note on it below — and
 * it is why only the Browse pair is a filled accent cap: it is the only one of
 * the four that does anything to the page.
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

  // `base` is what names the tool and `href` is where it goes, and they differ
  // for exactly the tools that take an account: Manager points at
  // `/manager/<username>` once one is stored, but `/manager/anyone` is still
  // the Manager page. Matching on the resolved href would leave the readout
  // blank on someone else's page.
  //
  // **The registry is the whole list.** There was a hand-written `/tools` entry
  // at its head, which existed to do two jobs: light the nav key on the tools
  // page, and be a row in the tray. The first went with the key's legend — the
  // readout below renders nothing on a route no tool owns, and `/tools` renders
  // no tray at all — and the second is a second door to a page the brand link
  // is already the door to.
  const links = useMemo(
    () =>
      tools.map((tool) => ({
        base: tool.href,
        href: toolHref(tool, account?.username ?? null),
        text: tool.text,
        short: tool.short,
      })),
    [account],
  );

  const current =
    links.find(
      (link) =>
        pathname === link.base || pathname.startsWith(`${link.base}/`),
    ) ?? null;

  // **The tools page carries no tool menu.** Its grid *is* the list, and a
  // menu of the same names directly above it is a second copy of the page's
  // own content — the same argument that took the wordmark plate off that
  // page, where the rack already engraves "The Lab". The groove goes with it,
  // since a separator with nothing on its far side is a rule.
  //
  // It tests the path rather than a matched entry, because `/tools` is no
  // longer *in* `links` to be matched.
  const showMenu = !(pathname === "/tools" || pathname.startsWith("/tools/"));

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
            // **`mr-auto` below `md` is the row's one auto margin, and it is on
            // the brand rather than on whatever follows it.** Everything to its
            // right — the readout, the Browse key, the tool key, and the theme
            // key on `/tools` — clusters at the right edge, and which of those
            // is *first* depends on the route: a route no tool owns has no
            // readout, and `/tools` has neither readout nor controls. An auto
            // margin on the leading trailing item would therefore have to be
            // three conditionals, and two auto margins in one row split the
            // slack between them rather than pinning either end. At `md` it
            // goes, because there the groove and the readout sit hard against
            // the brand and the tool key takes the slack instead.
            className="mr-auto inline-flex shrink-0 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 md:order-1 md:mr-0"
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

              **It draws at every width now, on every route.** It was dropped
              below `sm` wherever a page published Browse keys, and that
              conditional was a measurement rather than a preference: at 390 on
              `/lineupchecker` the row came to wordmark 129.1 + a menu key
              carrying the tool's name 116.9 + controls key 50 + theme key 38,
              with three 12px gaps — **370px against the 348 the pill's content
              box gives** — and what hung off the right edge was the theme key.
              A row that does not fit does not wrap here, it overflows, since
              the rack is one row at every width by construction (`--rack-clear`
              is three values, not five).

              What paid for it is the two things beside it getting smaller. The
              tool key gave up its legend to the readout opposite and is now a
              32px cap in a 40px track, and the theme key left the rack for the
              tray. Measured at 390 on the same page: brand link 155 + 12 +
              readout (`Lineups`) 68 + 12 + Browse key 42 + 12 + tool key 40 =
              **341 against 342**, one row 54px tall with nothing clipped.
              `/manager` is shorter still, its readout reading `Mgr`.

              **Tightening the row instead was tried and measured**, and it is
              recorded here so it is not tried again as a way of buying room
              back: cutting the rack's gap 12 -> 8, the brand link's 12 -> 8 and
              the tool key's padding and tracking got `/lineupchecker` to +4px
              of slack at 390 and **-12 at 375**, which is an ordinary phone.
              Four pixels is not a margin on a row whose width the next entry in
              `tools.ts` changes.

              The `sr-only` name above is what keeps the link named either way.
            */}
            <span
              aria-hidden
              className="relative inline-block whitespace-nowrap font-display text-[length:var(--fs-15)] font-bold uppercase leading-none tracking-[0.09em] md:text-[length:var(--fs-18)]"
            >
              <span className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]">
                The Lab
              </span>
              <span className="relative inline-block bg-[image:var(--chrome-face)] bg-clip-text text-transparent [filter:var(--wordmark-depth)]">
                The Lab
              </span>
            </span>
          </Link>

          {/*
            **The tool you are in, as an engraved readout.** It was the tool
            key's own legend until the key became a glyph, and moving it out
            rather than deleting it is the point: the lit key was the only thing
            the nav said besides its list, and a rack that had stopped saying
            where you are would be reporting nothing at all.

            It is type on the rack's face — no border, no `--key-bg`, no travel
            — because it reports and does not act. Everything in the rack that
            can be pressed looks pressable; this cannot and does not.

            Two spans switched by the cascade, never by state: a client
            component must not have to hydrate to learn a breakpoint, and this
            one is in the rack above every page. The short form is only ever
            rendered where the registry gives one (see `Tool.short`), and only
            below `sm`, where the row has no slack.

            **A route no tool owns renders nothing here** — `/tools`, whose
            grid names every tool including itself, and any page outside the
            registry. The old key fell back to the string "Tools", which was a
            key that named a page rather than the page you were on.
          */}
          {current && (
            <span className="shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)] md:order-3 md:tracking-[0.16em]">
              {current.short ? (
                <>
                  <span className="sm:hidden">{current.short}</span>
                  <span className="hidden sm:inline">{current.text}</span>
                </>
              ) : (
                current.text
              )}
            </span>
          )}

          {/* This page's own controls, published upward by whatever is under
              the rack — see `RackControlsKeys`, which also owns the answer to
              what the pair does below `md`. */}
          {controls && <RackControlsKeys controls={controls} />}

          {/* The tool tray's key, at the right end of the row: last child here
              below `md`, and `md:order-6 md:ml-auto` on the nav itself above
              it — the slot the theme pad used to hold. */}
          {showMenu && (
            <ToolsMenu links={links} currentBase={current?.base ?? null} />
          )}

          {/* The theme key, in a recessed pad of its own, **only where there is
              no tray to hold it**. It moved into the tool menu, which is the
              one place it can be and still be one control; what is left here is
              the routes that render no menu, which today is `/tools` alone.

              Its geometry is untouched — icon-only at a phone's width, where
              the legend is the first thing to go, and the `Light` / `Dark`
              legend back at `md`. `md:ml-auto` rather than `ml-auto`: below
              `md` the brand link's `mr-auto` has already pushed it right, and a
              second auto margin in that row would split the slack between the
              two rather than pinning either end. */}
          {!showMenu && (
            <div className="shrink-0 rounded-full bg-[image:var(--key-bg)] p-1 shadow-[var(--track-shadow)] md:order-6 md:ml-auto">
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
          )}
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

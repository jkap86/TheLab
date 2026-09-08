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
 * **And they are in that order at every width now.** The phone rack used to
 * read brand … name, controls, tray — the one object on it that *reports*
 * standing at the head of the three that *act*, because the readout inherited
 * the right-hand slot the tool key's legend had been in. It is brand, groove,
 * name, controls … tray now, which is the reading `md` has had since the rack
 * landed and which the groove was already drawn for up there. The ~66px that
 * move freed on the right is most of what let the Browse pair come out of the
 * fold it was in below `md`.
 *
 * **The slack sits in one place, and it is after the controls.** It used to sit
 * between the readout and the Browse caps, because the left-hand cluster below
 * carried an `mr-auto` and the tray had none until `md` — so *both* control
 * groups were pushed to the right edge and the row read as two clusters with a
 * hole between them. The margin is the tray's now, at every width, which is the
 * arrangement `md` has always had: the Browse keys follow the readout they sit
 * beside, and only the tray is pinned right. Nothing changed width, so the
 * measured 390px fit below is untouched — only where the row spends what it has
 * left over.
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
        group: tool.group,
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

  // **Where the wordmark's legend yields to the page's own controls**, and the
  // gate is two conditions because the measurement is two.
  //
  // Unfolding the Browse pair put a 77px channel on the row where a 39px key
  // used to be, and the ~11px this pass took back elsewhere (a 34px bezel, the
  // tighter tracking, a 3px tool track, a 9px brand gutter, 5/7px of pill
  // padding) does not cover it. Measured on `/lineupchecker`, whose readout is
  // the longest of the two that publish controls: the row has **9.4px of slack
  // at 390 and −5.6 at 375**, where it eats into the pill's own right padding,
  // and **−20.6 at 360**, where the tool key hangs outside the pill entirely.
  //
  // So the legend goes below 390, which is the width the design was drawn and
  // measured at — the theme key's own precedent, and the fallback this file has
  // named for exactly this situation since the rack was pinned: the flask stays,
  // and the link keeps its `sr-only` name, so nothing is lost but the word.
  //
  // **It is gated on `controls` and not on width alone.** A route that publishes
  // none has the pair's whole 86px spare — `/tools` and `/trades` fit at 360
  // with the wordmark on — and taking their legend away to fix a row they are
  // not carrying would be a regression on four routes to spare two.
  //
  // Tightening the row instead is measured and recorded on the wordmark itself,
  // below: it buys four pixels, which is not a margin on a row whose width the
  // next entry in `tools.ts` changes.
  const wordmarkFace = controls
    ? "hidden min-[24.375rem]:inline-block"
    : "inline-block";

  return (
    // Pinned and **flush**: `top-0`, where it used to float clear at `top-6`.
    // The horizontal gutter and the pill shape stay, so it still reads as a
    // rack unit rather than as a bar welded across the top — what goes is the
    // 24px of ground showing above it, which on a scrolling page was a strip
    // of console nothing ever occupied. `--rack-clear` lost the same 1.5rem on
    // all three arms, so the gap *under* the rack is unchanged.
    <div
      // **Where an open card parks is measured off this box**, and this
      // attribute is the whole of how it is found. The rack is one row at every
      // width but not one height — 50, 52 and 62px across its three arms — and
      // a card parked against a compiled-in number is either a plate under the
      // rack or a gap nobody asked for. The constant this replaces was wrong
      // twice for exactly that reason — see `FREEZE_TOP_FALLBACK`, which is
      // where its history is written down. It is this element
      // rather than the pill inside it because this one is `fixed`, so its
      // `bottom` is already a viewport coordinate, and it has no vertical
      // padding of its own to add. See `measureFreezeTop`.
      data-app-rack
      className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-6xl px-3.5 md:px-4"
    >
      {/*
        Below `md` the rack is one pill of its own and above `md` it is this
        row, and rather than render two trees the pill becomes
        `display: contents` at `md`: its box stops existing, its children join
        this flex container directly, and `order` puts them back in the reading
        order the wide layout wants. That is also why the pill chrome is on
        *this* element above `md` and on the row below it beneath — there is
        only ever one box painting it.

        (It was literally two stacked objects once, a brand pill over a nav
        track, which is what `flex-wrap` and `gap-y` are still here for. One row
        at every width is the constraint `--rack-clear` encodes, so the wrap is
        a backstop rather than a layout.)
      */}
      <div className="flex flex-wrap items-center gap-y-2.5 md:gap-x-4 md:rounded-full md:border md:border-foreground/8 md:bg-[image:var(--key-bg)] md:p-2 md:shadow-[var(--key-shadow),var(--plate-shadow),var(--rack-cast)]">
        {/*
          **The phone pill wears its own face and its own shadow**, where it
          used to borrow the `md` rack's `--key-bg` and the three-shadow stack
          above. That is a size argument rather than a preference: the wide rack
          is 62px of housing and can afford a flat vertical face, and this one
          is ~52px carrying a 34px bezel, two 32px caps and a readout — at
          `--key-bg`'s stops it reads as a printed lozenge rather than as a
          machined part. `--rack-pill-bg` lifts the top stop so a shallow face
          still catches a light, and `--rack-pill-shadow` chamfers all four
          edges and puts the riser and both casts on one stack, which is what
          `--rack-cast` was doing alone.

          Tokens rather than the literals the handoff spelled, on this file's
          own standing rule: a bevel written for the dark ground does not dim
          for the light one, it inverts, and an `rgba()` in a class string
          cannot. See their notes in `globals.css`.

          No `md:` counterpart, and none is needed: at `md` this element is
          `display: contents` and generates no box at all, so the face and the
          shadow have nothing to paint and the rack above is untouched.
        */}
        <div className="flex w-full items-center gap-[0.5625rem] rounded-full border border-foreground/8 bg-[image:var(--rack-pill-bg)] py-[0.3125rem] pl-[0.3125rem] pr-[0.4375rem] shadow-[var(--rack-pill-shadow)] md:contents">
          {/*
            **Brand, groove and readout are one cluster below `md`**, and the
            three of them are the rack's left-hand reading — who this is, and
            where you are. The design's whole move is putting that reading
            *before* the controls rather than in among them.

            **It carries no auto margin, and the row's one margin is the
            tray's.** It carried an `mr-auto` until this pass, on the argument
            that the margin could not sit on any one of the three because which
            of them is last depends on the route — a page outside the registry
            has no readout, and `/tools` has neither readout nor groove. That
            argument is right about *these three* and is exactly why the margin
            could move to the tray instead: the tray is always last, so there is
            no conditional to be wrong about. What the `mr-auto` here cost was
            the Browse keys, which it pushed to the right edge along with the
            tray — leaving the readout and the caps that act on the same page at
            opposite ends of the row, with all the slack in between.

            Two auto margins in one row would split the slack rather than pin
            either end, so there is exactly one, and it is on the object that is
            unconditionally last. See `ToolsMenu`, and the theme pad below for
            the routes that render no tray.

            `md:contents` is what keeps the wide layout untouched: the box stops
            existing and all three join the rack's own flex row under the orders
            they already carried. A `display: contents` element generates no box
            of its own, which is why nothing here has ever needed a `md:`
            override to be inert up there.

            `self-stretch` is for the groove alone. Left to `items-center` this
            cluster would be as tall as the brand link, and the groove inside it
            would stretch to *that* — 24px — rather than to the pill's own
            content height, which the 40px Browse channel sets. The groove is a
            channel milled through the part, not a tick beside the wordmark.
          */}
          <div className="flex items-center gap-[0.5625rem] self-stretch md:contents">
            <Link
              href="/tools"
              // **The auto margin left this row entirely** — it was here, then on
              // the cluster above, and it is the tray's now, which is the one
              // object in the row that is last on every route. See the note
              // above. What is left here is the link's own geometry.
              //
              // 9px between mark and wordmark below `md` against the 12 the wide
              // rack keeps: at a phone's width the row is spending its slack on a
              // readout and two caps that were not up here before, and the gutter
              // inside a two-part brand is the cheapest 3px in it.
              className="inline-flex shrink-0 items-center gap-[0.5625rem] rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 md:order-1 md:gap-3"
            >
              {/* The flask is sized by attribute, which CSS overrides — so the
                  bezel steps the glyph down at a phone's width without a second
                  copy of the mark.

                  **34px with its own face below `md`**, against the wide rack's
                  44px and `--bezel-bg`. Two pixels off the mount is two pixels of
                  row, which the readout that moved in beside it needed; the face
                  is the pill's argument one part smaller, a radial rather than a
                  vertical gradient so a 34px circle reads domed rather than flat.
                  The mark takes an emboss of its own for the same reason, and it
                  is a `drop-shadow` rather than a `text-shadow` because it has to
                  follow the glyph's strokes rather than the box around them —
                  `--cap-glyph-emboss`'s rule, one object over. */}
              <span
                aria-hidden
                className="inline-flex size-[2.125rem] shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-[image:var(--rack-bezel-bg)] shadow-[var(--rack-bezel-shadow)] [&_svg]:size-[1.1875rem] [&_svg]:[filter:var(--rack-mark-emboss)] md:size-11 md:bg-[image:var(--bezel-bg)] md:shadow-[var(--bezel-shadow)] md:[&_svg]:size-6 md:[&_svg]:[filter:none]"
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

                **It draws on every route, and below 390 only on the routes
                that publish no controls** — see `wordmarkFace` above, which
                carries the measurement. That conditional has been on and off
                this element twice now and it has been a measurement every time,
                never a preference: it went when the tool key gave up its legend
                to the readout and there was room again, and it is back because
                the Browse pair came out of its fold and took 38px of the row
                with it. A row that does not fit does not wrap here, it
                overflows, since the rack is one row at every width by
                construction (`--rack-clear` is three values, not five).

                **The tracking is 0.07em below `md` and 0.09 above**, which is the
                one place this pass bought row width out of the wordmark itself.
                Seven characters at 15px is ~2px of the row, spent on making room
                for the two Browse caps that came off the fold — and unlike the
                gap-tightening recorded below, it costs nothing that has to hold
                at the next entry in `tools.ts`, because it scales with the string
                rather than with the number of objects in the row.

                What paid for it is the two things beside it getting smaller. The
                tool key gave up its legend to the readout opposite and is now a
                32px cap in a 40px track, and the theme key left the rack for the
                tray. Measured at 390 on the same page: brand link 155 + 12 +
                readout (`Lineups`) 68 + 12 + Browse key 42 + 12 + tool key 40 =
                **341 against 342**, one row 54px tall with nothing clipped.
                `/manager` measures the same, its readout having since given up
                its `Mgr` for the whole word — seven characters either way, which
                is the trade that change is made on.

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
                className={`relative ${wordmarkFace} whitespace-nowrap font-display text-[length:var(--fs-15)] font-bold uppercase leading-none tracking-[0.07em] md:text-[length:var(--fs-18)] md:tracking-[0.09em]`}
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
              **The groove, at every width where something stands on both sides
              of it.** It was `md`-only, because below `md` the readout was over
              in the right-hand cluster and a groove after the brand would have
              had an auto margin's worth of nothing on its far side — a rule
              rather than a channel. With the readout here it has a near side and
              a far side at a phone's width too, which is the whole of what a
              groove claims.

              The condition is two, because the two widths separate two different
              things. At `md` it separates the brand from the tool tray at the far
              end of the row, which is `showMenu` and is today's rule untouched.
              Below `md` it separates the brand from the *readout*, so it draws
              only where there is one — which on `/logs`, a route the registry
              does not own, is the difference between a groove and a tick mark
              floating beside the wordmark. Every route with a readout has a menu,
              so `showMenu` still gates both.
            */}
            {showMenu && (
              <span
                aria-hidden
                className={`w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)] md:order-2 md:my-1 md:block ${
                  current ? "my-[0.3125rem] block" : "hidden"
                }`}
              />
            )}

            {/*
              **The tool you are in, as an engraved readout.** It was the tool
              key's own legend until the key became a glyph, and moving it out
              rather than deleting it is the point: the lit key was the only thing
              the nav said besides its list, and a rack that had stopped saying
              where you are would be reporting nothing at all.

              **It sits after the groove now rather than at the head of the
              right-hand cluster**, which is where the tool key left it. Read left
              to right the phone rack was brand … name, controls, tray — the one
              thing on it that reports, wedged in among the three that act. It is
              brand, name, then controls now: the reading order `md` has had since
              the rack landed, and the reason the pair below could come out of its
              fold at all, since a readout on the right was ~66px of exactly the
              room two caps needed.

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
          </div>

          {/* This page's own controls, published upward by whatever is under
              the rack — see `RackControlsKeys`. **The pair is on the rack at
              every width now**: it was one folded key opening a popover below
              `md`, which put the two keys the pinning exists to keep in reach
              two presses away on the one device where scrolling back up the
              page is hardest. What paid for it is the readout leaving this
              cluster, above, and the legends becoming glyphs. */}
          {controls && <RackControlsKeys controls={controls} />}

          {/* The tool tray's key, at the right end of the row, and **the one
              object in it that carries an auto margin** — `ml-auto` on the nav
              itself, at every width. It is last on every route, which is what
              lets one unconditional margin do the job the left-hand cluster's
              `mr-auto` used to do with three. `md:order-6` puts it in the same
              slot the theme pad holds below. */}
          {showMenu && (
            <ToolsMenu links={links} currentBase={current?.base ?? null} />
          )}

          {/* The theme key, in a recessed pad of its own, **only where there is
              no tray to hold it**. It moved into the tool menu, which is the
              one place it can be and still be one control; what is left here is
              the routes that render no menu, which today is `/tools` alone.

              Its geometry is untouched — icon-only at a phone's width, where
              the legend is the first thing to go, and the `Light` / `Dark`
              legend back at `md`.

              **`ml-auto` at every width**, where it was `md:ml-auto` and leant
              on the left-hand cluster's `mr-auto` to be pushed right below `md`.
              That margin is gone, so this pad needs its own — and it can have
              one for the tray's reason, which is that it is unconditionally the
              last thing in the row on the routes that render it. There is still
              exactly one auto margin per row at every width: this pad and the
              tray are mutually exclusive by construction. */}
          {!showMenu && (
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
          )}
        </div>

      </div>
    </div>
  );
}

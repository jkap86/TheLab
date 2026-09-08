"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  BilletFinish,
  CONSOLE_BILLET_FACE,
  ThemeToggle,
} from "@/features/shared";

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
  /**
   * Which bay this row sits in — `Tool.group`, carried across unchanged.
   *
   * It is read as a **run** rather than as a key: the tray cuts a bay wherever
   * the value changes down the list, so the registry's own order is what puts a
   * tool in a bay and nothing here sorts. An entry out of step with its
   * neighbours therefore opens a bay of its own rather than being teleported
   * into a matching one elsewhere in the tray, which is the honest reading of a
   * list whose order is also its meaning.
   */
  group: number;
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
 * **The tray is a milled part, and its groups are bays.** It was a `--key-bg`
 * panel with flat rows, which is a *surface* with a list on it: five tools of
 * equal weight in one column, and no way to say that two of them answer a
 * question about your account and two read the whole crawled corpus. It is
 * billet stock now with a bay cut into its face per group and a brushed key
 * seated in each — three holes in one part, which read as three groups where
 * three runs of rows on one panel read as one list with rules across it.
 *
 * A bay is a run of equal `group` down the registry, never a bucket things are
 * sorted into: see {@link ToolsMenuLink.group}. The `/tools` grid renders the
 * same list in the same order and draws no bays at all, which is what keeps the
 * two from disagreeing about where a tool lives.
 *
 * **The legends are set for reading rather than for finish**, which was an
 * explicit revision to this design and is the reason the key face is a token of
 * its own rather than `--key-metal`: on that face solid `--billet-name`
 * measures 3.53:1 and the word is lost in the vertical brush besides. The brush
 * comes off, the stops darken, and the tracking drops 0.16em to 0.11em at
 * weight 500 — the console's stamped-on-metal grammar rather than its
 * etched-label one. See `--rack-tray-key-bg`, where the measurement is.
 *
 * **The theme control lives in the tray**, as its last row under a milled
 * hairline — and **on the bare billet face rather than in a bay**, which is now
 * what says it is not navigation: it is the one row in the tray that is not a
 * key in a hole. It is also the one row that does **not** dismiss the tray. The
 * others navigate, so closing is right for them, where a toggle is something
 * the reader may want to watch land.
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

  // **One bay per run of equal `group`.** A reduce rather than a `groupBy`,
  // because the field is a run and not a key — see {@link ToolsMenuLink.group}.
  // Nothing sorts, so the tray cannot come to disagree with the `/tools` grid,
  // which renders the same registry in the same order and draws no bays at all.
  const bays = links.reduce<ToolsMenuLink[][]>((acc, link) => {
    const bay = acc.at(-1);
    if (bay && bay[0].group === link.group) bay.push(link);
    else acc.push([link]);
    return acc;
  }, []);

  // A tool key's geometry and travel, carrying **no colour and no surface** —
  // `CONSOLE_KEY_PILL_SHELL`'s rule, and load-bearing here because the lit row
  // and the unlit one differ in border, face, ink and shadow at once. Appending
  // `border-active/45` to a string that already says `border-foreground/10` is a
  // coin flip decided by Tailwind's emit order rather than by the class
  // attribute, and a lit row that lost its rim would be the visible half of it.
  //
  // The travel is spelled here rather than taken from `CONSOLE_KEY_BLOCK`, which
  // is the same idea at a different radius, padding and tracking: composing
  // against it would be that same flip on three more axes.
  //
  // **The tracking is 0.11em at weight 500**, where every other key in the rack
  // is 0.16em at the inherited weight. That is the legibility half of this tray:
  // the legends sit on brushed metal rather than on a flat panel, and 0.16em is
  // a finish on a label where this is a word to be read.
  const toolRow =
    "relative flex w-full items-center justify-between gap-3 rounded-[0.4375rem] border " +
    "px-[0.6875rem] py-[0.5625rem] font-mono text-[length:var(--fs-11)] font-medium uppercase " +
    "tracking-[0.11em] transition-[transform,box-shadow,color] duration-150 " +
    "active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";
  // A key seated in a bay: the brushless face, the console's standard riser, and
  // ink stamped into metal rather than lit on glass — `--billet-name` with
  // `--billet-name-shadow`, which is what the rest of the console's machined
  // faces already carry.
  //
  // **There is no hover *fill*.** It used to be `hover:bg-foreground/[0.04]`,
  // which cannot paint at all now: a background colour sits *under* a background
  // image, and this face is an opaque gradient. The hover is the ink alone,
  // which is the same move the rack's own keys make.
  const unlitRow =
    "border-foreground/10 bg-[image:var(--rack-tray-key-bg)] text-[var(--billet-name)] " +
    "[text-shadow:var(--billet-name-shadow)] shadow-[var(--key-shadow)] hover:text-readout";
  // The row naming the page you are on: the same key, teal-cast, with the accent
  // rim and a halo composed onto the riser. Composed **whole** in one
  // `shadow-[…]`, since a shadow list is atomic and a second utility beside the
  // first would replace the riser rather than add the halo to it.
  const litRow =
    "border-active/45 bg-[image:var(--rack-tray-key-lit-bg)] text-readout " +
    "[text-shadow:var(--readout-text-glow)] " +
    "shadow-[var(--key-shadow),0_0_18px_-6px_var(--accent-glow)]";

  return (
    <nav
      ref={nav}
      aria-label="Tools"
      // The deep channel a single raised key travels in — `CONSOLE_TRACK`,
      // plus the `relative` the tray positions against.
      //
      // **It sits at the right end of the rack and carries the row's one auto
      // margin, at every width.** The margin was `md:ml-auto`, and below `md`
      // the rack leant on an `mr-auto` over on the brand cluster to push this
      // right — which pushed the *Browse keys* right along with it, since they
      // sit between the two. That put the readout at one end of the row and the
      // caps that act on the page it names at the other. This element is the one
      // thing in the row that is last on every route, so an unconditional
      // `ml-auto` here is the whole of what that cluster's margin was doing, and
      // the Browse keys stay beside the readout where `md` has always had them.
      // See `app-rack.tsx`, where the trade is written out.
      //
      // 3px of channel below `md` against 4 above, which is the same 2px the
      // brand's bezel gave up one end of the row and for the same reason: the
      // phone rack is carrying two Browse caps it did not carry before. The
      // key inside keeps its 32px, so what narrows is the surround rather than
      // the target.
      className="relative ml-auto flex shrink-0 items-center rounded-full bg-[image:var(--key-bg)] p-[0.1875rem] shadow-[var(--track-shadow)] md:order-6 md:p-1"
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
        // The tray, milled out of billet stock.
        //
        // It was `CONSOLE_WELL`'s surface with a cast added and flat rows on it
        // — a *panel* with a list — and it is a solid part with a bay cut into
        // its face per group and a brushed key seated in each. The grouping is
        // what that buys: three holes in one part read as three groups, where
        // three runs of rows on one panel read as one list with rules across it.
        //
        // `CONSOLE_BILLET_FACE` rather than `CONSOLE_BILLET`, because the
        // chamfer here is `--rack-tray-shadow` — a shadow list is atomic, so the
        // face is the half that composes and the constant carrying
        // `--billet-shadow` is the half that does not. `BilletFinish` is the
        // grain and the raking specular, which are children rather than a second
        // background for `Scanlines`' reason: CSS cannot spell a second
        // background on an element that already has one.
        //
        // **`right-0`, at both widths.** The trigger is the rightmost object in
        // the pill, and a tray hung from its left edge runs ~90px off the screen
        // at 390.
        <div
          role="menu"
          aria-label="Tools"
          className={`${CONSOLE_BILLET_FACE} absolute right-0 top-full z-50 mt-2.5 min-w-[15.25rem] rounded-[0.875rem] p-1.5 shadow-[var(--rack-tray-shadow)]`}
        >
          <BilletFinish />

          {bays.map((bay, index) => (
            // A bay: one group's hole. 12px of bare billet between them, which
            // is what makes the grouping read at all — at a smaller gap the
            // three collapse back into one list. `relative` puts it over the
            // finish's two overlays; keyed on the group rather than the index,
            // since the run is what the bay *is*.
            //
            // **`role="group"`, which the bays need and a plain wrapper would
            // have cost.** A `role="menu"` owns `menuitem`s, and an
            // intervening generic box breaks that ownership — so the rows
            // would be three divs' worth of children rather than the menu's
            // own. `group` is one of the roles a menu may own, and it is also
            // the honest one: a bay *is* a group, and it is the whole of what
            // this pass added, so a reader who cannot see the three holes is
            // told about them rather than being handed a flat list. Deliberately
            // unlabelled — the design gives a bay no visible name either, and
            // inventing one here would be a claim it does not make.
            <div
              key={bay[0].group}
              role="group"
              className={`relative flex flex-col gap-[0.3125rem] rounded-[0.6875rem] bg-[image:var(--rack-tray-bay-bg)] p-[0.3125rem] shadow-[var(--rack-tray-bay-shadow)] ${
                index > 0 ? "mt-3" : ""
              }`}
            >
              {bay.map((link) => {
                const isCurrent = link.base === currentBase;
                return (
                  <Link
                    key={link.base}
                    role="menuitem"
                    href={link.href}
                    aria-current={isCurrent ? "page" : undefined}
                    // Closing on click is not redundant with the route change:
                    // the current page's own entry navigates nowhere, so nothing
                    // else would dismiss it.
                    onClick={() => setOpen(false)}
                    className={`${toolRow} ${isCurrent ? litRow : unlitRow}`}
                  >
                    {link.text}
                    {/* The lamp beside the page you are on. It says the same
                        thing the rack's tool-name readout does, for the case
                        where the open tray covers that readout and the two are
                        read together. */}
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
          ))}

          {/* What separates the navigation from the one row that is not it. */}
          <span
            aria-hidden
            className="relative mx-1 mb-[0.4375rem] mt-2 block h-px bg-[var(--milled-hairline)] shadow-[var(--milled-hairline-highlight)]"
          />

          {/*
            The theme row, **stamped on the bare billet face rather than seated
            in a bay**. That is the whole of what says it is not navigation: the
            hairline separates it, and being the one row that is not a key in a
            hole is what keeps it from reading as a sixth tool.

            `ThemeToggle` renders both faces and lets `globals.css` show the one
            that matches, which is exactly what a row reading "the theme a press
            switches *to*" needs — so it takes this row's chrome through
            `className` and is otherwise untouched.

            **The word `Theme` is rendered here rather than by the toggle**, and
            that is what leaves the component alone: the row wants a label on the
            left of a `justify-between` row, which the two-faces-in-one-span
            structure cannot express. It is `aria-hidden`, because each face
            already carries the full sentence that names the button; a visible
            "Theme" would only prepend a token to it.

            The two inks are the billet's own pair — a label and the reading it
            names, a step apart — where the rest of this tray is ink on a key.
            It deliberately does **not** dismiss the tray; see the module note.
          */}
          <ThemeToggle
            className={
              "group relative flex w-full items-center justify-between gap-3 rounded-lg " +
              "px-[0.6875rem] py-[0.4375rem] font-mono text-[length:var(--fs-11)] uppercase " +
              "tracking-[0.16em] text-[var(--billet-label)] " +
              "[text-shadow:var(--billet-name-shadow)] transition-[color] duration-150 " +
              "hover:text-[var(--billet-name)] " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
            }
            leadingLabel={<span aria-hidden>Theme</span>}
            // The reading is a step brighter than the label naming it, which is
            // the console's own grammar for a value beside its caption.
            faceClassName="text-[var(--billet-name)]"
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

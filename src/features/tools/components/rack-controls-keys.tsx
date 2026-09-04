"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  activeFilterCount,
  CONSOLE_KEY_PILL,
  CONSOLE_TRACK,
  LeagueFiltersDialog,
  LineupColumnsDialog,
  type RackControls,
} from "@/features/shared";

/**
 * The page's own controls, in the rack: a Browse track and a View track.
 *
 * Four keys that used to be two housings on the manager page's header row. Up
 * here they are reachable at any scroll depth, which on a hundred-league page
 * is the whole point — the header scrolls away after two cards.
 *
 * **What it draws comes from the page, not from this folder.** The rack is
 * mounted above `{children}` and cannot see a page's state, so `RackControls`
 * is published upward and this component only mounts it; a page that publishes
 * nothing renders none of this, the rule the tools menu already lives by. Both
 * dialogs keep their `triggerClassName` seam, and what the rack passes through
 * it is a *pill* where the housing passed a slab — which is exactly what that
 * prop exists for.
 *
 * **Below `lg` the four keys collapse behind one icon-only key.** That is the
 * question the handoff left open, and it is answered the way this folder
 * already answered it once: `ToolsMenu` replaced a six-key track with one key
 * and a menu, because the track did not fit and its far end was reachable only
 * by a horizontal swipe nobody would guess at. Four control keys are ~470px in
 * a 362px pill, so the same answer applies — and the key is icon-only for the
 * theme key's reason, that the legend is the first thing to go. The two
 * alternatives were a second stacked row, which is what the rack was rewritten
 * to remove and which costs ~112px of an 844px screen *permanently* once the
 * rack is pinned, and leaving the controls on the page at narrow widths, which
 * would mount both dialogs twice.
 *
 * **The breakpoint is `lg`, not the `md` the rest of the rack turns on**, and
 * it was measured rather than chosen: with the two tracks in, the rack's row is
 * ~900px of content, so at `md` (768px) it wrapped to a second line — 114px of
 * pinned rack with the page's first row *underneath* it. Everything else about
 * the rack still switches at `md`; only these two tracks wait for the width
 * that actually holds them.
 *
 * The menu is not a `<dialog>`, for `ToolsMenu`'s reason: those are modal, and
 * a popover holding four keys should not trap focus and dim the page. So the
 * dismissal a dialog gives for free is spelled out — a capture-phase
 * `pointerdown`, so a press that starts outside dismisses before whatever it
 * landed on acts on it, and Escape, which returns focus to the key it came
 * from.
 *
 * **What it must not do is dismiss on the press that opens one of its own two
 * dialogs**, and that is the one rule here with a failure nobody can see. Both
 * are mounted inside this menu, and a modal `<dialog>` is only in the top layer
 * for as long as it still generates a box: hide the panel and the modal has no
 * box either, so the press produced a backdrop over an inert page with nothing
 * on it — a Filters key that reads as dead. The menu closes when *its dialog*
 * does instead; see the effect below. Above `lg` the panel is `display: contents`
 * and there is no menu to close, which is why this was invisible on a desktop
 * and broken at every width under 1024px.
 *
 * **The same two tracks serve both layouts, and no markup is rendered twice.**
 * The panel is `display: contents` at `md`, so its box stops existing and the
 * tracks join the rack's flex row directly under their own `order` — the trick
 * the brand row above already turns, and the reason a filter set in the menu on
 * a phone is the same dialog instance as the one set in the rack on a desktop.
 */
export function RackControlsKeys({ controls }: { controls: RackControls }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Dismiss the menu, and put focus back on the key it came out of — the panel
  // is about to stop generating a box, and a browser dumps focus to `<body>`
  // when the element holding it is hidden out from under it.
  const dismiss = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const node = root.current;
    // A dialog opened from in here is still a DOM *descendant* of this menu,
    // so it is only in the top layer as long as the menu keeps generating a
    // box: the moment the panel goes `display: none` the modal has no box
    // either, and what is left on screen is a backdrop over an inert page with
    // nothing on it. That is why nothing below closes the menu on the press
    // that opens one — this does, when the dialog itself closes. `close` does
    // not bubble, but the capture phase runs on every ancestor regardless of
    // that, which is what lets the menu hear its own dialogs without either of
    // them growing a callback for it.
    const onClose = () => dismiss();
    const onDown = (event: PointerEvent) => {
      if (!node?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A modal inside the menu takes Escape for itself, and `close` above is
      // what dismisses the menu behind it. Taking it here as well would hide
      // the panel on the same keystroke that closes the dialog inside it.
      if (node?.querySelector("dialog[open]")) return;
      dismiss();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    node?.addEventListener("close", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      node?.removeEventListener("close", onClose, true);
    };
  }, [open, dismiss]);

  const { drawer, onOpenDrawer } = controls;
  // Lit on the same rule the Filters key inside is lit by. A closed menu says
  // nothing, and a reader who has narrowed to four leagues and scrolled needs
  // *something* on screen to say a filter is on — the plate's `9 / 14` is the
  // other half of that and it is upstairs on the page.
  const filtering = activeFilterCount(controls.filters) > 0;

  const key = `${CONSOLE_KEY_PILL} inline-flex items-center bg-[image:var(--key-bg)] shadow-[var(--key-shadow)]`;
  const state = (on: boolean) =>
    on
      ? "border-active/45 text-readout"
      : "border-foreground/10 text-foreground/80 hover:text-readout";

  return (
    // `md:order-4` places the key between the tools menu and the theme pad for
    // the band where the rack is one row but the tracks are still folded away;
    // at `lg` the box stops existing and the tracks carry their own order.
    <div ref={root} className="relative shrink-0 md:order-4 lg:contents">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="rack-controls-panel"
        onClick={() => setOpen((value) => !value)}
        className={`${CONSOLE_KEY_PILL} inline-flex items-center bg-[image:var(--key-bg)] px-2.5 shadow-[var(--key-shadow)] lg:hidden ${state(
          filtering,
        )}`}
      >
        <SlidersMark />
        <span className="sr-only">Browse and view controls</span>
      </button>

      <div
        id="rack-controls-panel"
        role="group"
        aria-label="Browse and view"
        className={`${
          open
            ? "absolute right-0 top-full z-50 mt-2.5 flex min-w-[14.5rem] flex-col items-stretch gap-2 rounded-[0.875rem] border border-foreground/8 bg-[image:var(--key-bg)] p-1.5 shadow-[var(--well-shadow),0_24px_44px_-20px_#000]"
            : "hidden"
        } lg:contents`}
      >
        <div
          className={`${CONSOLE_TRACK} flex items-center gap-1.5 p-1 lg:order-4 lg:shrink-0`}
        >
          {/* **These two dismiss the menu on the press and the two below do
              not**, and the asymmetry is where each one's dialog is mounted.
              A shares drawer is the *page's* — it is nowhere near this box, so
              hiding the menu behind it leaves a clean page. The filters and
              columns dialogs are mounted right here, and hiding the box they
              sit in takes them off screen with it; see the effect above. */}
          <button
            type="button"
            onClick={() => {
              onOpenDrawer("player");
              setOpen(false);
            }}
            aria-haspopup="dialog"
            aria-expanded={drawer === "player"}
            // Shape and state composed rather than concatenated onto a string
            // that already names a border colour — same specificity, and which
            // one wins is decided by Tailwind's emit order.
            className={`${key} ${state(drawer === "player")}`}
          >
            Players
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenDrawer("leaguemate");
              setOpen(false);
            }}
            aria-haspopup="dialog"
            aria-expanded={drawer === "leaguemate"}
            className={`${key} ${state(drawer === "leaguemate")}`}
          >
            Leaguemates
          </button>
        </div>

        <div
          className={`${CONSOLE_TRACK} flex items-center gap-1.5 p-1 lg:order-5 lg:shrink-0`}
        >
          <LeagueFiltersDialog
            filters={controls.filters}
            onChange={controls.onFilters}
            leagues={controls.leagues}
            triggerClassName={`${CONSOLE_KEY_PILL} inline-flex items-center`}
          />
          <LineupColumnsDialog
            columns={controls.columns}
            board={controls.board}
            ktc={controls.ktc}
            triggerClassName={`${key} ${state(false)}`}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The controls glyph: three channels with a key travelling in each, which is
 * the console's own picture of what is behind this button.
 */
function SlidersMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

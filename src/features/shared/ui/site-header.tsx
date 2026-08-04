"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeTool } from "../tools";
import { HeaderSlotTarget } from "./header-slot";
import { ToolIcon } from "./tool-icon";
import { ToolsMenu } from "./tools-menu";

/**
 * The app bar: the one piece of global chrome.
 *
 * Three zones, left to right — the mark home, the page you are on, and the
 * tools menu. It is **pinned**, so both the way home and the way to any other
 * tool are reachable from the bottom of a several-hundred-row list and not only
 * from the top of it. Its height is `--site-header-h` rather than padding,
 * because the manager card pins itself directly underneath and has to know
 * where this ends — including the extruded edge, which is drawn inside this box
 * for exactly that reason (see `--bar-edge-h`).
 *
 * **It carries a route list now, which the note here used to forbid.** The rule
 * was that a second navigation system competes with the first; what it produced
 * instead was `/tools` as a mandatory waypoint between any two tools, since the
 * bar's single link home was the only way out of one. `ToolsMenu` is not a
 * second system — it is the *only* one, the tools grid reached without the
 * round trip, read from the same catalogue that grid renders.
 *
 * **The middle zone states, it does not switch.** It held the manager tabs, and
 * those were a second way to do what the menu already does: Leagues, Players and
 * Leaguemates are three entries in it. So the bar names the tool you are in —
 * one claim, from `activeTool`, so the label and the menu's highlight can't
 * disagree — and every move between tools happens in one place. The chip is a
 * recessed well rather than a raised key, which is the bar's whole material
 * vocabulary in one detail: raised means press me, recessed means you are here.
 *
 * Hidden on `/tools` itself: the wordmark and the whole tool list are that page,
 * so the bar would be a smaller copy of what is already on screen.
 * `usePathname` is why this is a client component.
 */
export function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/tools") return null;

  const current = activeTool(pathname);

  // Tinted glass rather than an opaque plate: the ambient aurora is fixed behind
  // every page, and a solid bar cut a flat band across the top of it. The
  // translucency is paired with `backdrop-blur` on purpose — that is what keeps
  // the *page* from reading through the extrusion as legible scrolling rows,
  // which is what the opacity was originally protecting against. Blur is not
  // universally supported, so the two gradient stops stay dark enough to carry
  // the bar's text on their own if it is dropped. The inset top line is the
  // specular edge every raised surface here shares.
  return (
    <header className="sticky top-0 z-50 h-[var(--site-header-h)] bg-[linear-gradient(180deg,rgba(28,48,65,0.72),rgba(11,22,34,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_22px_40px_-26px_rgba(0,0,0,1)] backdrop-blur-xl">
      {/* The extruded bottom edge: a dark side wall with the accent lit along
          its base. Inside the header box, so the manager card pinning at
          `--site-header-h` lands flush against it rather than over it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[var(--bar-edge-h)] bg-[var(--edge)]"
      >
        <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-active/55 to-transparent" />
      </span>

      {/* Match `PageShell`'s container so the wordmark lines up with the page
          content below it rather than floating at the viewport edge. */}
      <div className="group/bar mx-auto flex h-[calc(var(--site-header-h)-var(--bar-edge-h))] w-full max-w-4xl items-center gap-2.5 px-4 sm:gap-3.5 sm:px-6">
        <Wordmark />
        {current && (
          <>
            <span aria-hidden className="flex-none text-foreground/25">
              /
            </span>
            <CurrentPage
              text={current.text}
              icon={<ToolIcon name={current.icon} />}
            />
          </>
        )}
        {/* The seat a page fills — the ADP board's trigger today — sits beside
            the Tools key at the bar's trailing end, both pushed there by this
            wrapper's `ml-auto`. An unfilled seat has no width, so every other
            page's bar is laid out exactly as it was. */}
        <div className="ml-auto flex flex-none items-center gap-2.5 sm:gap-3.5">
          <HeaderSlotTarget />
          <ToolsMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * The way home: the flask mark as a moulded key, with the wordmark beside it.
 *
 * The mark is drawn here rather than reusing `FlaskLoader`, which is an animated
 * four-keyframe loading mark; this is a still glyph, and the two would fight
 * over what a flask on screen means. The wordmark takes the gradient the tools
 * page's headline wears — the `foreground` token fading into a pale teal, a
 * literal because a gradient stop has no token to read — so the two spellings of
 * "The Lab" read as one brand.
 *
 * Both parts stay at every width. They used to compete with three manager tabs
 * for a 390px bar; with the tabs gone the bar seats a mark, a wordmark, one chip
 * and the trigger with room to spare, and the chip is the part that yields
 * (`truncate`) if a tool name ever runs long.
 */
function Wordmark() {
  return (
    <Link
      href="/tools"
      aria-label="The Lab — all tools"
      className="group flex flex-none items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/60"
    >
      {/* The key sizes itself off the face rather than the other way round: the
          face carries the 34px square and the wrapper shrink-wraps it, so no
          box here is a percentage of a box that is itself sizing to content. */}
      <span className="lab-key lab-notch inline-flex h-[37px] transition-[filter] duration-300 group-hover:[filter:drop-shadow(0_4px_7px_rgba(0,0,0,0.7))_drop-shadow(0_0_14px_rgba(0,255,229,0.55))]">
        <span className="lab-face lab-notch flex h-[34px] w-[34px] items-center justify-center shadow-[inset_0_1.5px_0_rgba(255,255,255,0.34),inset_0_0_14px_-6px_rgba(0,255,229,0.75)]">
          <FlaskGlyph />
        </span>
      </span>
      {/* It yields on a phone, and only to a *filled* seat.
          A mark, a wordmark, one chip and the tools key fit a 390px bar with
          room to spare, which is what dropping the manager tabs bought and what
          the rule here used to say. A part seated in the bar spends that room:
          with the ADP block in, "Leagues" truncated to "Le…" — a tool naming
          itself in two letters, to keep a wordmark two centimetres from the
          mark that already says it. So the text goes and the mark stays, on
          exactly the pages that took the room.

          Written as one utility rather than as `hidden` against `sm:inline`
          because those two collide: Tailwind v4 emits the display utilities
          alphabetically, so `.inline` beats `.hidden` at every width. A single
          `max-sm:` variant has nothing to lose to. */}
      <span className="bg-gradient-to-b from-foreground from-35% to-[#8feee6] bg-clip-text font-display text-[13px] font-bold uppercase tracking-[0.19em] text-transparent [filter:drop-shadow(0_1px_0_rgba(0,0,0,0.8))] max-sm:group-has-[[data-header-seat]:not(:empty)]/bar:hidden">
        The Lab
      </span>
    </Link>
  );
}

/**
 * Where you are: the tool's icon and name in a recessed, notched well.
 *
 * Deliberately not a link and not a button — it is the bar's one piece of pure
 * state. The well is what says so, against the raised trigger beside it.
 */
function CurrentPage({ text, icon }: { text: string; icon: React.ReactNode }) {
  return (
    <span className="lab-well lab-notch flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-active">
      <span className="flex-none [&>svg]:h-[17px] [&>svg]:w-[17px]">
        {icon}
      </span>
      <span className="truncate font-display text-[12.5px] font-bold tracking-tight sm:text-[13px]">
        {text}
      </span>
    </span>
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

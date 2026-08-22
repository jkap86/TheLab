"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isToolActive, toolHref, toolsInGroup, type Tool } from "../tools";

import { ToolIcon } from "./tool-icon";

/**
 * The manager's three views, drawn as what they are: Leagues, Players,
 * Leaguemates, over the filter rail, with the one you are on cut into the page
 * and the two you are not standing on it.
 *
 * **What this replaces was not a control at all — it was the absence of one.**
 * The three are separate routes and always have been (`/manager/[searched]/…`,
 * three entries in the tools catalogue with a `pattern` apiece), and the only
 * way between them was the app bar's tools menu, behind a press, in a list of
 * seven. What stood in for them on the page were the subject rail's two shares
 * keys — 10px pills at the trailing end of a filter row, which open a *picker*
 * over the current list and never went to either view. So a reader on Leagues
 * had no way to see that two more views of the same account existed, and the
 * two parts that named them were the least prominent things on the row.
 *
 * Five decisions hold it up.
 *
 * **It reads the catalogue rather than listing three routes.** `tools.ts`
 * already owns the names, the destinations, the glyphs and the current-page
 * patterns for exactly these three, because the menu and the tools grid need
 * them; a second list here is the drift a shared catalogue exists to stop, and
 * the way it would drift is a view renamed in one place. `toolsInGroup` is the
 * membership test, so a fourth manager view appears here by joining the group.
 *
 * **The destination is the *searched* manager, not the connected one.** The
 * menu resolves its manager entries against whoever's account is connected,
 * which is right there — it is offering you your own tools. This is a switch
 * between three readings of the account already on screen, so following it must
 * not change whose account that is. `toolHref` owns the URL-encoding for both.
 *
 * **Raised means press me, recessed means you are here** — the app's own
 * grammar, and the reason this needs no "active" tint to be legible. The two
 * you can go to are blocks with a wall running down *and* right; the one you
 * are on is the same box with the face cut away — `.lab-seat` in `globals.css`,
 * which is that family's sink at key scale. The current
 * cell is a `<span>` rather than a link to itself, so there is nothing to press
 * and nothing that travels under the finger — the rule a part that does nothing
 * when pressed must not move.
 *
 * **The three cells are one height, and that is arithmetic rather than a
 * constant.** A raised cell is its face plus the 5px it stands on; the sunk one
 * has no wall, so it takes those 5px back as padding, 2 above and 3 below. Set
 * as one number on both, the tops would not line up and the row would read as
 * three parts seated wrong rather than as one switched.
 *
 * **The wall is 5px where the bar's block is 6px.** Thickness has to fall with
 * count, and this is three of the heaviest part in the app on one line, sitting
 * under a header plate that is already a lit face — a switch prouder than the
 * chrome above it is a rank too many.
 *
 * **What a phone loses is the glyph seat, and nothing else.** Three seats plus
 * three names do not fit 354px, and the seat is the part that can go: the labels
 * never contract here, so the glyph is not what tells one key from another. The
 * cells stay *intrinsic* — an equal-thirds run was tried and is what clipped
 * "LEAGUEMATES" to "LEAGUEM…", which is a tool's own name reading as broken —
 * and measured at 390px the three come to 312px of the 354 available, so the row
 * fits with room and the `flex-wrap` above is the honest failure for a width
 * that does not: a name wrapped to its own line, never one cut inside a word.
 * The lit rail stays at every width for the same reason, being 3px of the 26 to
 * spare: it is the mark that says which cell, and a phone is where the sunk
 * material has the least room to say it alone. What is a fact at every width is
 * the control — three cells, one of them cut in — which is the rule the league
 * cards' own per-card labels were removed for.
 */
export function ViewSwitch({ searched }: { searched: string }) {
  // **`usePathname` is typed `string` and is not one.** Outside the App Router's
  // context it answers null, which reached `isToolActive` as a `.split` on null
  // and took the page down — found by rendering this under the test runner,
  // which is the one caller that will always be outside it. An empty path
  // matches no pattern, so the degradation is that no cell is marked current and
  // all three are offered: a switch that cannot say where you are should hand
  // you every door rather than light the wrong one.
  return <ViewSwitchRow searched={searched} pathname={usePathname() ?? ""} />;
}

/**
 * The switch with its one piece of I/O already resolved — the half that decides
 * and draws, so a test can drive it.
 *
 * Split for the reason every pure module here is split from its composition
 * file: what is worth pinning is which cell is sunk, where the two links go and
 * that the words are the catalogue's, none of which a component reaching into
 * the router can be asked. It is exported for the test and for nothing else;
 * callers want {@link ViewSwitch}.
 */
export function ViewSwitchRow({
  searched,
  pathname,
}: {
  searched: string;
  pathname: string;
}) {
  const views = toolsInGroup("Manager");

  return (
    <nav
      aria-label="Manager views"
      // The clearance is the plate's, not a gap of its own: this sits between
      // two lit faces — the header above and the filter rail below — and both
      // carry their own bottom margin, so what is spent here is only the space
      // this part needs beneath it. The horizontal inset is the rail's own
      // (`px-4 pl-5`), so the switch, the rail and the heading billet share one
      // left edge rather than each finding its own.
      className="mb-3 border border-transparent px-4 pl-5"
    >
      <ul className="flex flex-wrap items-stretch gap-2 sm:gap-2.5">
        {views.map((tool) => {
          const here = isToolActive(tool, pathname);
          return (
            <li key={tool.pattern} className="flex">
              {here ? (
                <span
                  aria-current="page"
                  className="lab-seat lab-notch-all flex items-center gap-2 pb-[11px] pl-[9px] pr-3 pt-[10px] sm:gap-2.5 sm:pr-[15px]"
                >
                  {/* The lit rail, which is the accent's whole appearance on
                      this part. It is beside a cut for the reason it is beside
                      one on the manager plate and in the app bar's block: what
                      follows it is a readout, and this cell is exactly that —
                      the view you are reading, stated rather than offered. */}
                  <span
                    aria-hidden
                    className="lab-billet-rail w-[3px] flex-none self-stretch rounded-[1px]"
                  />
                  <ViewGlyph tool={tool} lit />
                  <ViewLabel tool={tool} lit />
                </span>
              ) : (
                <Link
                  href={toolHref(tool, searched)}
                  // `group` for the glyph alone: the seat it sits in is a cut,
                  // so there is no face to lighten under the cursor and the
                  // block's own glow is doing the rest.
                  className="lab-billet lab-billet-key lab-notch-all group flex pb-[5px] pr-[5px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70"
                >
                  <span className="lab-billet-face lab-notch-all flex items-center gap-2 py-2 pl-[9px] pr-3 sm:gap-2.5 sm:pr-[15px]">
                    <ViewGlyph tool={tool} />
                    <ViewLabel tool={tool} />
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The tool's glyph, sunk in a seat of its own.
 *
 * **The cut is what carries the depth at this size, not the block's outline.**
 * The eye reads the inside of a part before it reads its silhouette — the same
 * argument the app bar's signal bars are milled into a channel for rather than
 * painted on the face. On the current view the seat is the lit face instead, so
 * the accent appears twice on that cell and nowhere on the other two.
 *
 * Dropped below `sm`: the labels do not contract, so the glyph is decoration
 * there rather than the thing telling two keys apart, and it is the one part of
 * the cell that can go without the row overflowing.
 */
function ViewGlyph({ tool, lit = false }: { tool: Tool; lit?: boolean }) {
  return (
    <span
      className={`hidden size-[22px] flex-none place-items-center rounded-[4px] sm:grid ${
        lit
          ? "lab-face lab-face-active"
          : "lab-channel text-foreground/70 transition-colors group-hover:text-active"
      }`}
    >
      <ToolIcon name={tool.icon} size="key" />
    </span>
  );
}

/**
 * The view's name, in the display face.
 *
 * `font-display` because these are tool names, which is the one thing that face
 * is for in this app — the tools grid and the app bar's own current-page chip
 * are already set in it, so a reader arriving from either meets the same word in
 * the same letters. It comes with a size step down, per the face's own rule:
 * Orbitron is wider, so holding the size truncates sooner.
 *
 * `whitespace-nowrap` and deliberately **not** `truncate`: a clipped name reads
 * as a long name where the content varies, and these are three fixed tool names
 * a reader is matching against the app bar's menu. A cell too wide for the row
 * takes its own line, which says "it did not fit"; one clipped inside its own
 * word says the app is broken.
 */
function ViewLabel({ tool, lit = false }: { tool: Tool; lit?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap font-display text-[0.625rem] font-semibold uppercase leading-none tracking-[0.06em] sm:text-xs sm:tracking-[0.09em] ${
        lit ? "text-active" : "text-foreground/90"
      }`}
    >
      {tool.text}
    </span>
  );
}

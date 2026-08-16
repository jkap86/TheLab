"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useStoredAccount } from "../account";
import { TOOL_GROUPS, isToolActive, toolHref, toolsInGroup } from "../tools";
import { Avatar } from "./avatar";
import { ToolIcon } from "./tool-icon";

/**
 * Every tool, one press away from any page — the app bar's menu.
 *
 * The bar used to hold a single link home, which made `/tools` a mandatory stop
 * between any two tools: a round trip through a page whose whole job is the list
 * this menu now carries. The list is read from the shared catalogue, so the grid
 * and the bar can never offer different tools, and destinations resolve through
 * the same `toolHref` — with an account in hand a manager entry jumps straight
 * to that account's tab rather than to the username search.
 *
 * Without an account the entries still *link*, unlike the cards on `/tools`,
 * which grey out. The grid is where an account is resolved, so a dead card there
 * is a prompt; in a nav bar it would be a dead end. What they land on is the
 * search the tool starts with, and the panel's account row says as much.
 *
 * It closes on Escape (returning focus to the trigger), on a press outside it,
 * and whenever the route changes — a menu still hanging over the page you just
 * asked for reads as a bug.
 */
export function ToolsMenu() {
  const pathname = usePathname();
  const user = useStoredAccount();
  // What is stored is the route the menu was opened *on*, so arriving anywhere
  // else closes it as a matter of arithmetic — navigating is what the menu is
  // for, and a boolean would need an effect (and a cascading render) to notice.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const close = () => setOpenedAt(null);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenedAt(null);
      trigger.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapper.current?.contains(event.target as Node)) return;
      setOpenedAt(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    // `flex` so the trigger is a flex item rather than an inline-level box: an
    // inline-flex key in a block would sit on a line box and carry its
    // descender space, which is a few pixels of the bar's height spent on
    // nothing.
    <div ref={wrapper} className="relative flex flex-none">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpenedAt(open ? null : pathname)}
        aria-expanded={open}
        // Only while the panel is in the tree: it is mounted on press, so a
        // permanent reference pointed at an id that isn't in the document on
        // every page where the menu is closed — which is all of them.
        aria-controls={open ? panelId : undefined}
        aria-label="Tools"
        // A raised cyan keycap: the one part of the bar that is meant to be
        // pressed, so it is the one part standing above the plate. It travels
        // its own thickness on `:active` (`lab-key-press`), which is the whole
        // payoff of building the depth out of a stacked layer.
        //
        // The face is the flex row, not the button: a `<button>` is the one
        // element engines disagree about as a flex container, and the row is
        // what the whole part's width comes from. `whitespace-nowrap` says the
        // glyph, the label and the chevron are one line under any layout — the
        // failure worth ruling out is them stacking into a keycap three rows
        // tall, which the bar has no height for and cannot clip.
        className="lab-key lab-key-active lab-key-press lab-notch inline-flex h-[2.3125rem] transition-[filter] duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-active/70"
      >
        <span className="lab-face lab-face-active lab-notch flex h-[2.125rem] items-center justify-center gap-2 whitespace-nowrap px-3 font-display text-[0.6875rem] font-extrabold uppercase tracking-[0.1em]">
          <GridGlyph />
          <span className="hidden sm:inline">Tools</span>
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        // A slab with a visible bottom edge, not a rectangle with a shadow: the
        // wrapper is the edge and `.slab` is the lit face, the same two-layer
        // extrusion the keys use. Rounded rather than notched — the notch is
        // kept for the small parts, so six rows of 11px text sit on a calm
        // surface (and nothing else in the app has to change its corners).
        <div
          id={panelId}
          className="tools-menu-panel absolute right-0 top-full z-50 mt-2.5 w-[min(21.5rem,calc(100vw-1.5rem))] origin-top-right rounded-[20px] bg-[var(--edge)] pb-[5px] [animation:dialog-rise_140ms_ease-out] [filter:drop-shadow(0_30px_46px_rgba(0,0,0,0.88))_drop-shadow(0_0_24px_rgba(0,255,229,0.18))]"
        >
          <div className="overflow-hidden rounded-[17px] bg-[linear-gradient(180deg,#17293b,#0c1a26)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.16)]">
            <AccountRow user={user} onNavigate={close} />

            <nav
              aria-label="Tools"
              className="max-h-[calc(100vh-var(--site-header-h)-2rem)] overflow-y-auto p-2"
            >
              {TOOL_GROUPS.map((group) => (
                <div key={group} className="mb-1 last:mb-0">
                  <p className="flex items-center gap-2.5 px-2 pb-1.5 pt-2 font-display text-[0.59375rem] font-bold uppercase tracking-[0.26em] text-foreground/35">
                    {group}
                    <span
                      aria-hidden
                      className="h-px flex-1 bg-gradient-to-r from-active/35 to-transparent"
                    />
                  </p>
                  <ul>
                    {toolsInGroup(group).map((tool) => {
                      const active = isToolActive(tool, pathname);
                      return (
                        <li key={tool.text}>
                          <Link
                            href={toolHref(tool, user?.username ?? null)}
                            onClick={close}
                            aria-current={active ? "page" : undefined}
                            className={`group flex items-center gap-3 rounded-[13px] px-2 py-2 transition-colors ${
                              active
                                ? "bg-gradient-to-b from-active/15 to-active/[0.04] shadow-[inset_0_1.5px_0_rgba(196,255,249,0.3),0_0_22px_-10px_rgba(0,255,229,0.8)]"
                                : "hover:bg-foreground/[0.05]"
                            }`}
                          >
                            {/* A moulded tile: notched, bevelled, sitting in
                                its own shadow. Lit cyan when it's the row you
                                are standing on. */}
                            <span
                              className={`lab-notch flex h-[2.125rem] w-[2.125rem] flex-none items-center justify-center transition-colors ${
                                active
                                  ? "bg-[linear-gradient(160deg,#a8fff4,#00d9c3)] text-[#052029] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.85),0_2px_5px_-1px_rgba(0,0,0,0.7)]"
                                  : "bg-[linear-gradient(160deg,#2b4b61,#10222f)] text-foreground/55 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.3),inset_0_-3px_6px_rgba(0,0,0,0.6),0_2px_4px_-1px_rgba(0,0,0,0.8)] group-hover:text-active"
                              }`}
                            >
                              <ToolIcon name={tool.icon} />
                            </span>
                            <span className="min-w-0">
                              <span
                                className={`block font-display text-[0.8125rem] font-bold tracking-tight ${
                                  active ? "text-active" : "text-foreground/90"
                                }`}
                              >
                                {tool.text}
                              </span>
                              <span className="mt-0.5 block text-[0.71875rem] leading-snug text-foreground/45">
                                {tool.description}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Who the tools are reading, at the top of the menu.
 *
 * Every entry below it resolves against this account, so naming it here is what
 * makes "Leagues" mean *your* leagues — and what explains an entry landing on a
 * username search when there is no account yet. `/tools` is where one is
 * resolved, so that is where both states point.
 */
function AccountRow({
  user,
  onNavigate,
}: {
  user: ReturnType<typeof useStoredAccount>;
  onNavigate: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-foreground/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)] px-4 py-3">
      {user ? (
        <>
          <Avatar
            url={user.avatar_url}
            name={user.display_name || user.username}
            size="md"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {user.display_name || user.username}
            </span>
            <span className="block truncate text-xs text-foreground/45">
              @{user.username}
            </span>
          </span>
          <Link
            href="/tools"
            onClick={onNavigate}
            className="lab-notch flex-none bg-active/10 px-2.5 py-1.5 font-display text-[0.59375rem] font-bold uppercase tracking-[0.14em] text-active shadow-[inset_0_0_0_1px_rgba(0,255,229,0.35)] transition-colors hover:bg-active/20"
          >
            Change
          </Link>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-xs text-foreground/50">
            No Sleeper account connected — tools will ask for a username.
          </span>
          <Link
            href="/tools"
            onClick={onNavigate}
            className="lab-notch flex-none bg-active/12 px-2.5 py-1.5 font-display text-[0.59375rem] font-bold uppercase tracking-[0.14em] text-active shadow-[inset_0_0_0_1px_rgba(0,255,229,0.45)] transition-colors hover:bg-active/22"
          >
            Connect
          </Link>
        </>
      )}
    </div>
  );
}

/** The four-square menu mark on the trigger. */
function GridGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

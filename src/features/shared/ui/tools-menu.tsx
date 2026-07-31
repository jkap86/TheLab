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
    <div ref={wrapper} className="relative flex-none">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpenedAt(open ? null : pathname)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Tools"
        className={`flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold transition-colors sm:px-3 ${
          open
            ? "border-active/50 bg-active/12 text-active"
            : "border-foreground/12 bg-foreground/[0.05] text-foreground/70 hover:border-foreground/25 hover:bg-foreground/[0.09] hover:text-foreground"
        }`}
      >
        <GridGlyph />
        {/* The label is the affordance on a laptop and a luxury on a phone,
            where the manager tabs beside it want every pixel of the bar. */}
        <span className="hidden sm:inline">Tools</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          id={panelId}
          className="tools-menu-panel absolute right-0 top-full z-50 mt-2 w-[min(21rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-2xl border border-foreground/12 bg-[var(--surface-menu)] shadow-[0_34px_80px_-30px_rgba(0,0,0,0.85)] backdrop-blur-2xl [animation:dialog-rise_140ms_ease-out]"
        >
          {/* A hairline of accent along the top edge, the same signature the
              bar wears under itself. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/60 to-transparent"
          />

          <AccountRow user={user} onNavigate={close} />

          <nav
            aria-label="Tools"
            className="max-h-[calc(100vh-var(--site-header-h)-2rem)] overflow-y-auto p-2"
          >
            {TOOL_GROUPS.map((group) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-2 pb-1 pt-2 font-display text-[10px] font-semibold uppercase tracking-[0.24em] text-foreground/35">
                  {group}
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
                          className={`group flex items-start gap-3 rounded-xl px-2 py-2 transition-colors ${
                            active
                              ? "bg-active/10 text-active"
                              : "text-foreground/85 hover:bg-foreground/[0.06]"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border transition-colors ${
                              active
                                ? "border-active/40 bg-active/10 text-active"
                                : "border-foreground/10 bg-foreground/[0.04] text-foreground/55 group-hover:border-active/35 group-hover:text-active"
                            }`}
                          >
                            <ToolIcon name={tool.icon} />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-display text-sm font-semibold tracking-tight">
                              {tool.text}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-foreground/45">
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
    <div className="flex items-center gap-3 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-3">
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
            className="flex-none rounded-full border border-foreground/12 px-2.5 py-1 text-[11px] font-semibold text-foreground/60 transition-colors hover:border-active/40 hover:text-active"
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
            className="flex-none rounded-full border border-active/40 bg-active/10 px-2.5 py-1 text-[11px] font-semibold text-active transition-colors hover:bg-active/20"
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

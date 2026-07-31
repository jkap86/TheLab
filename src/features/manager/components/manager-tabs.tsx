"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The manager views these tabs move between, in the order they're shown. */
const TABS = [
  { key: "leagues", label: "Leagues" },
  { key: "players", label: "Players" },
  { key: "leaguemates", label: "Leaguemates" },
] as const;

export type ManagerTab = (typeof TABS)[number]["key"];

/**
 * Movement between a manager's three views, mounted in {@link SiteHeader}'s
 * contextual slot.
 *
 * They used to sit in the manager card, which is now pinned: kept there they
 * would have cost a row of the little vertical space a pinned card can afford,
 * and they belong with the other always-visible chrome rather than with the
 * identity and record readout the card is for.
 *
 * It reads the route rather than taking props, because the bar is mounted once
 * in the root layout and has no manager in hand — and the route is the same
 * thing the pages would have passed down. Off a manager view it renders nothing,
 * which is what keeps the bar a bar on every other page.
 *
 * The searched segment comes back from `usePathname` **already URL-encoded**, so
 * it is interpolated bare — encoding it again would double-escape any manager
 * whose name isn't plain ASCII (the same trap as the tool grid's `hrefFor`). It
 * is also the URL's own spelling rather than the resolved username, since
 * Sleeper resolves a user id as readily as a name.
 */
export function ManagerTabs() {
  const pathname = usePathname();
  const [section, searched, view] = pathname.split("/").filter(Boolean);
  if (section !== "manager" || !searched || !view) return null;

  return (
    <nav
      aria-label="Manager views"
      // Marks the bar's contextual slot as filled: the wordmark's text stands
      // down on a phone when these are present, and the bar has no other way to
      // know — this component decides from the route whether it renders at all.
      data-bar-slot
      // A segmented control rather than three underlined words: the bar's other
      // control is the tools trigger, a pill, and two navigation affordances
      // sitting side by side should look like the same kind of thing.
      //
      // Scrolls rather than wraps: the bar is a fixed height, so a narrow phone
      // pushes the last tab sideways instead of off the bottom of the bar.
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border border-foreground/12 bg-foreground/[0.05] p-0.5"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === view;
        return (
          <Link
            key={tab.key}
            href={`/manager/${searched}/${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-none items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition-colors sm:px-3 sm:text-[13px] ${
              isActive
                ? "bg-active/12 text-active shadow-[inset_0_0_0_1px_rgba(0,255,229,0.35)]"
                : "text-foreground/55 hover:bg-foreground/[0.07] hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
      // Scrolls rather than wraps: the bar is a fixed height, so a narrow phone
      // pushes the last tab sideways instead of off the bottom of the bar.
      className="-mb-px flex min-w-0 items-center gap-5 self-stretch overflow-x-auto"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === view;
        return (
          <Link
            key={tab.key}
            href={`/manager/${searched}/${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex flex-none items-center whitespace-nowrap text-sm font-semibold transition-colors ${
              isActive
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-active after:shadow-[0_0_12px_rgba(0,255,229,0.55)]"
                : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The one piece of global chrome: a slim bar giving every page a way back to
 * the tools home. The app has no other nav — each tool is reached by navigating
 * away from `/tools`, with nothing but the browser back button to return — so
 * this is the link that closes that loop.
 *
 * It is **pinned**, so the way home is reachable from the bottom of a
 * several-hundred-row list and not only from the top of it. Its height is
 * `--site-header-h` rather than padding, because the manager card pins itself
 * directly underneath and has to know where this ends; the background is opaque
 * for the same reason — content passes behind it.
 *
 * `children` is a slot for chrome belonging to whatever section you are in,
 * filled by `app/layout.tsx`; that is where the manager tabs live now. It stays
 * a slot rather than a route list because this is still not a site nav — what
 * appears here is movement *within* the tool you are already in, and a page with
 * nothing contextual to add leaves it empty.
 *
 * Hidden on `/tools` itself: a link pointing at the current page is noise, and
 * that page already leads with its own "The Lab" header. `usePathname` is why
 * this is a client component; the link is otherwise static.
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/tools") return null;

  return (
    <header className="sticky top-0 z-50 border-b border-foreground/10 bg-[var(--background)]">
      {/* Match `PageShell`'s container so the wordmark lines up with the page
          content below it rather than floating at the viewport edge. */}
      <div className="mx-auto flex h-[var(--site-header-h)] w-full max-w-4xl items-center gap-5 px-4 sm:px-6">
        <Link
          href="/tools"
          className="flex-none text-sm font-semibold tracking-tight text-foreground/60 transition-colors hover:text-foreground"
        >
          The Lab
        </Link>
        {children}
      </div>
    </header>
  );
}

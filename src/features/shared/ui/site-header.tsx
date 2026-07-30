"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The one piece of global chrome: a slim bar giving every page a way back to
 * the tools home. The app has no other nav — each tool is reached by navigating
 * away from `/tools`, with nothing but the browser back button to return — so
 * this is the link that closes that loop.
 *
 * Hidden on `/tools` itself: a link pointing at the current page is noise, and
 * that page already leads with its own "The Lab" header. `usePathname` is why
 * this is a client component; the link is otherwise static.
 */
export function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/tools") return null;

  return (
    <header className="border-b border-foreground/10">
      {/* Match `PageShell`'s container so the wordmark lines up with the page
          content below it rather than floating at the viewport edge. */}
      <div className="mx-auto flex w-full max-w-4xl items-center px-6 py-3">
        <Link
          href="/tools"
          className="text-sm font-semibold tracking-tight text-foreground/60 transition-colors hover:text-foreground"
        >
          The Lab
        </Link>
      </div>
    </header>
  );
}

"use client";

import { storeAccount, ThemeToggle, useStoredAccount } from "@/features/shared";

import { CONSOLE_HOUSING, CONSOLE_KEY } from "./console-chrome";
import { UserLookup } from "./user-lookup";
import { ToolGrid } from "./tools-grid";

/**
 * The page as one console: a bevelled panel holding the wordmark plate, the
 * account readout and the tool grid.
 *
 * The sticky translucent header the account card used to sit under is gone.
 * The account is a compact readout on the wordmark's row now, so there is
 * nothing left that needs to follow the scroll, and the panel can carry its own
 * light instead of a scrim. (`--header-from` / `--header-to`, the scrim's two
 * tokens, went with it — the sticky header was their only reader.)
 *
 * The gutter steps 6 -> 8 -> 13 rather than going straight to the design's 13:
 * the wordmark plate is a fixed-width object, and at a phone's width the
 * padding is the only thing left to give it.
 */
export function ToolsHome({ heading }: { heading: React.ReactNode }) {
  const user = useStoredAccount();

  return (
    <div className="relative rounded-3xl border border-foreground/9 bg-[image:var(--panel-bg)] px-6 pb-[4.5rem] pt-16 shadow-[var(--panel-shadow)] sm:px-8 md:px-13">
      {/* Grain, then the specular hairline along the panel's top edge. Both are
          what keep a large flat surface from reading as flat. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[image:var(--panel-grain)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-[image:var(--panel-specular)]"
      />

      <header className="relative flex flex-wrap items-center gap-x-6 gap-y-5">
        {heading}
        {/* The cluster wraps within itself rather than the header wrapping it:
            below `sm` the lookup takes a whole row, and the theme key follows
            onto its own, still right-aligned. Squeezing the two onto one line
            at a phone's width leaves an input too narrow to read a username
            in. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          <UserLookup user={user} onUserChange={storeAccount} />
          <div className={CONSOLE_HOUSING}>
            <ThemeToggle className={`${CONSOLE_KEY} inline-flex items-center`} />
          </div>
        </div>
      </header>

      <div
        aria-hidden
        className="my-9 h-px bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
      />

      <ToolGrid user={user} />
    </div>
  );
}

"use client";

import { storeAccount, useStoredAccount } from "@/features/shared";

import { ToolGrid } from "./tool-grid";
import { UserLookup } from "./user-lookup";

/**
 * The tools page's interactive half: the account lookup and the tool grid, with
 * the resolved account read from the shared store so both share it. `UserLookup`
 * writes it and every card reads it — the handoff the lookup section was built
 * to make.
 *
 * The account is persisted (see `features/shared/account`) rather than held in
 * plain `useState`, so a reload or a trip out to a tool and back brings it back
 * instead of an empty search box. That persistence is also what lets a tool
 * *page* pick up the account without asking for a username again — the pick
 * tracker's league picker is on `/picktracker`, not on the card here.
 * `UserLookup`'s "Change" button clears it by writing `null`.
 *
 * The title and the account card pin together as one plate, for the reason
 * `ManagerHeader` pins: the grid is a list you scroll, and whose account a card
 * would open is the fact every row of it depends on. Two details travel with
 * that, both learned there. The plate paints `--background` and bleeds to
 * `PageShell`'s gutter (`-mx-6 px-6`), because cards scrolling through the gaps
 * around a transparent pinned block reads as a rendering bug — it is the one
 * place on this page the aurora is covered. And `SiteHeader` hides itself on
 * `/tools`, so the plate pins at `top-0` rather than offsetting by
 * `--site-header-h`.
 *
 * The `::before` carries that opacity over `PageShell`'s top padding: unpinned,
 * the plate starts 4rem down the page, and a flat edge across the aurora there
 * reads as a seam. It rides *with* the plate, so once pinned it sits above the
 * viewport and costs nothing — which is why it is a pseudo-element rather than
 * more padding, whose 4rem a pinned plate would keep paying out of the list
 * behind it.
 *
 * The lede sits *below* the card and only once an account is resolved: "pick a
 * tool to get started" is an instruction the grid can't carry out until then —
 * every card but the accountless one is inert without one — so before that it
 * asks for the thing the page is refusing. It stays outside the plate for the
 * same reason it moved: it is a caption on the grid, not part of the identity
 * above it.
 */
export function ToolsHome({ heading }: { heading: React.ReactNode }) {
  const user = useStoredAccount();

  return (
    <>
      <div className="sticky top-0 z-30 -mx-6 bg-[var(--background)] px-6 pb-5 pt-3 before:absolute before:inset-x-0 before:bottom-full before:h-24 before:bg-[var(--background)]">
        {heading}
        <div className="mt-6">
          <UserLookup user={user} onUserChange={storeAccount} />
        </div>
      </div>

      {user ? (
        <p className="mb-6 mt-4 text-lg text-foreground/60">
          Pick a tool to get started.
        </p>
      ) : (
        <div className="mt-10" />
      )}

      <ToolGrid user={user} />
    </>
  );
}

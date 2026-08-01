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
 * The plate cancels `PageShell`'s top padding (`-mt-16`) rather than starting
 * below it. Unpinned it began 4rem down the page and then jumped up to `top-0`
 * on the first scroll — a header that moves as you scroll reads as a glitch, and
 * the plate is the one block on the page that is supposed to be fixed. Starting
 * it flush means its resting position *is* its pinned position, so nothing
 * moves. It also retires the `::before` that used to paint that 4rem: with no
 * gap above the plate there is no seam across the aurora to cover.
 *
 * The `::after` is the *other* end of that opacity, and it is the same seam
 * argument applied where the plate stops. A block of flat `--background` butted
 * straight against the aurora draws a hard horizontal line across the page —
 * the glows appear to switch on an inch below the account card, which reads as
 * the backdrop being clipped rather than as a pinned surface. So the paint fades
 * out over the 4rem below the plate instead of ending: the aurora comes up
 * through it gradually, and a card scrolling under the plate dims into it rather
 * than being cut off mid-row. It is `pointer-events-none` because it overhangs
 * the grid, which is made of links.
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
      <div className="sticky top-0 z-30 -mx-6 -mt-16 bg-[var(--background)] px-6 pb-5 pt-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-gradient-to-b after:from-[var(--background)] after:to-transparent">
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

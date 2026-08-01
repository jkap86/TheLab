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
 * The title and the account card pin together as one plate at the top of the
 * page, so the wordmark and the account stay put and only the tool cards
 * scroll. `SiteHeader` hides itself on this route — the wordmark and the grid
 * *are* that bar here — so the plate pins at `top-0` rather than under
 * `--site-header-h`, and it is the page's own top chrome.
 *
 * **The plate is tinted glass, not paint, and the blur is what makes the pin
 * safe.** It was opaque once, which covered the aurora with a flat band across
 * the one page the glows are most of the identity of, and dropping that paint
 * meant dropping the pin with it. The app bar had already answered this: two
 * dark gradient stops carrying an alpha plus `backdrop-blur`, where the blur is
 * the load-bearing half — it diffuses the cards passing underneath into colour
 * rather than legible content, which is the failure the opacity was actually
 * preventing, while the aurora still reads through. The stops stay dark enough
 * to hold the title and the card's own text where `backdrop-filter` is
 * unsupported, the same out the bar relies on.
 *
 * Two measurements go with the pin. It bleeds `-mx-6 px-6` to `PageShell`'s
 * default gutter, because a plate narrower than the page lets cards scroll
 * through the margins beside it. And the fading `::after` below it is what
 * keeps the glass from drawing a hard edge across the grid — the same tail the
 * manager header carries, at the same job.
 *
 * It still cancels `PageShell`'s top padding (`-mt-16`), which is what puts it
 * flush at the top: the wordmark leads the page rather than sitting 4rem down
 * it, and a pinned plate that stopped 4rem short would leave a strip of live
 * page above it.
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
      <div className="sticky top-0 z-40 -mx-6 -mt-16 bg-[linear-gradient(180deg,rgba(28,48,65,0.72),rgba(11,22,34,0.82))] px-6 pb-5 pt-3 backdrop-blur-xl after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-gradient-to-b after:from-[rgba(11,22,34,0.82)] after:to-transparent">
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

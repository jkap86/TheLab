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
 * The title and the account card scroll with the page and paint nothing. They
 * used to pin as one plate over a block of flat `--background` — the one place
 * on this page the aurora was covered — which cost a bleed to `PageShell`'s
 * gutter and a fading `::after` below the plate, both there only to keep that
 * paint from drawing a hard edge across the glows. The aurora reads through the
 * whole page now, and none of that machinery is needed to hold it: a pinned
 * block *has* to be opaque, since cards scrolling through a transparent one
 * reads as a rendering bug, so dropping the paint is dropping the pin.
 *
 * It still cancels `PageShell`'s top padding (`-mt-16`), which is where the pin
 * left it: flush at the top, so the wordmark leads the page rather than sitting
 * 4rem down it.
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
      <div className="-mt-16 pb-5 pt-3">
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

"use client";

import { storeAccount, useStoredAccount } from "@/features/shared";
import { UserLookup } from "./user-lookup";
import { ToolGrid } from "./tools-grid";

/**
 * The page as one console: a bevelled panel holding the account readout and
 * the tool grid.
 *
 * The sticky translucent header the account card used to sit under is gone.
 * The account is a compact readout on the top row now, so there is nothing
 * left that needs to follow the scroll, and the panel can carry its own light
 * instead of a scrim. (`--header-from` / `--header-to`, the scrim's two
 * tokens, went with it — the sticky header was their only reader.)
 *
 * The engraved wordmark plate used to open that row; the rack above the page
 * already carries the same engraving, so `heading` is now the visually-hidden
 * `<h1>` alone. What that changes here is one class: the account control no
 * longer takes `ml-auto`. It is the only object on the row, and `ml-auto`
 * pinned it to the right of an empty one.
 *
 * The gutter steps 6 -> 8 -> 10 rather than going straight to the design's
 * larger figure: at a phone's width the padding is the only thing left to give
 * the content, and at `md` the inset is what the three-across grid is competing
 * with — 52px of it against a `console` shell was still a 241px card. The top
 * inset drops 64 -> 44px for the reason the wordmark plate's removal left
 * behind: the panel was opening on 64px of padding above a lone input.
 */
export function ToolsHome({ heading }: { heading: React.ReactNode }) {
  const user = useStoredAccount();

  return (
    <div className="relative rounded-3xl border border-foreground/9 bg-[image:var(--panel-bg)] px-6 pb-14 pt-11 shadow-[var(--panel-shadow)] sm:px-8 md:px-10">
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
        {/* The theme key used to sit beside the lookup in a housing of its
            own; it is in the app rack now, so the lookup has the row to
            itself and no longer has to share a phone's width with it. */}
        <div className="flex flex-wrap items-center gap-3">
          <UserLookup user={user} onUserChange={storeAccount} />
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

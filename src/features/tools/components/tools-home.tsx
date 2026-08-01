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
 */
export function ToolsHome() {
  const user = useStoredAccount();

  return (
    <>
      <UserLookup user={user} onUserChange={storeAccount} />
      <ToolGrid user={user} />
    </>
  );
}

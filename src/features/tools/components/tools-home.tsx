"use client";

import { useState } from "react";

import type { UserInfo } from "@/shared/contract";

import { ToolGrid } from "./tool-grid";
import { UserLookup } from "./user-lookup";

/**
 * The tools page's interactive half: the account lookup and the tool grid, with
 * the resolved account held here so both share it. `UserLookup` writes it and
 * the pick tracker card (via `ToolGrid`) reads it to list that account's
 * leagues — the handoff the lookup section was built to make.
 */
export function ToolsHome() {
  const [user, setUser] = useState<UserInfo | null>(null);

  return (
    <>
      <UserLookup user={user} onUserChange={setUser} />
      <ToolGrid user={user} />
    </>
  );
}

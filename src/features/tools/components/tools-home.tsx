"use client";

import { storeAccount, useStoredAccount } from "@/features/shared";

import { UserLookup } from "./user-lookup";
import { ToolGrid } from "./tools-grid";

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
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CONSOLE_KEY, CONSOLE_WELL } from "@/features/shared";

/**
 * Track a league by raw id.
 *
 * **This is the path the tool was designed for**, not a fallback for the picker
 * above it: the board is meant to be opened from a league chat mid-draft, where
 * there is an id in the URL bar and no Sleeper account in hand. It stays on the
 * page whether or not an account is stored.
 *
 * A real `<form>`, so Enter submits. It **does not validate** — a typo is
 * discovered as a failed page, which is what `ManagerSearch` does with a
 * username and for the same reason: what you typed is not proof of what exists,
 * and the destination is the only thing that can say.
 */
export function PicktrackerSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        router.push(`/picktracker/${encodeURIComponent(trimmed)}`);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor="picktracker-league-id" className="sr-only">
        Sleeper league ID
      </label>
      <input
        id="picktracker-league-id"
        name="leagueId"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        placeholder="Sleeper league ID"
        onChange={(event) => setValue(event.target.value)}
        className={`${CONSOLE_WELL} min-w-0 flex-1 px-4 py-2.5 text-[16px] text-foreground/90 outline-none placeholder:text-foreground/35 focus-visible:border-active/45 @md:text-sm`}
      />
      <button type="submit" disabled={!trimmed} className={`${CONSOLE_KEY} disabled:opacity-40`}>
        Track
      </button>
    </form>
  );
}

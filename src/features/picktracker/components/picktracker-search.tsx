"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * League-id entry — the way into the pick tracker with no Sleeper account in
 * hand.
 *
 * A real `<form>` for the same reason as `ManagerSearch`: Enter submits, and
 * the browser treats input and button as one control. The id is asked for
 * directly rather than routed through a username because the tracker is built
 * to be shared into a league's chat mid-draft — the id is in every member's
 * URL, no Sleeper account needed to look at it. Someone who *has* looked one up
 * picks from `LeaguePicker` above this instead.
 */
export function PicktrackerSearch() {
  const [leagueId, setLeagueId] = useState("");
  const router = useRouter();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = leagueId.trim();
    if (value) router.push(`/picktracker/${encodeURIComponent(value)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
      <label htmlFor="picktracker-league-id" className="sr-only">
        Sleeper league ID
      </label>
      <input
        id="picktracker-league-id"
        type="text"
        name="leagueId"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="Sleeper league ID"
        value={leagueId}
        onChange={(e) => setLeagueId(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 text-base placeholder:text-foreground/35 focus:border-active/50 focus:outline-none focus:ring-1 focus:ring-active/40"
      />
      <button
        type="submit"
        disabled={!leagueId.trim()}
        className="rounded-lg border border-active/40 bg-active/10 px-5 py-2.5 font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50 disabled:cursor-not-allowed disabled:border-foreground/10 disabled:bg-transparent disabled:text-foreground/25"
      >
        Track
      </button>
    </form>
  );
}

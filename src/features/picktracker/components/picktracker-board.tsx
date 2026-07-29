"use client";

import { useState } from "react";
import Link from "next/link";

import { Avatar } from "@/features/shared";
import { usePicktracker } from "../hooks/use-picktracker";
import type { PicktrackerPickPayload } from "../types";

// Row and heading share this one template, as everywhere else — a header laid
// out separately drifts the moment a width changes.
const columns = "grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]";

/** The tracked draft for one league: who's on the clock, then every pick so far. */
export function PicktrackerBoard({ leagueId }: { leagueId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = usePicktracker(leagueId, refreshKey);

  if (!data) {
    return (
      <div>
        <BackLink />
        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-200">
            {error}
          </div>
        ) : (
          <p className="py-16 text-center text-foreground/55">Loading draft…</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <BackLink />

      <header className="mb-8 flex items-center gap-4">
        <Avatar url={data.league.avatar_url} name={data.league.name} size="lg" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {data.league.name}
          </h1>
          <p className="mt-1 text-foreground/60">
            Pick tracker · kickers standing in for rookie picks
          </p>
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="rounded-xl border border-active/30 bg-active/10 px-5 py-3">
          {data.next_pick ? (
            <>
              <span className="text-sm uppercase tracking-wide text-foreground/50">
                On the clock
              </span>
              <span className="ml-3 text-2xl font-semibold tabular-nums text-active">
                {data.next_pick}
              </span>
            </>
          ) : (
            <span className="text-lg font-medium text-foreground/70">
              Draft complete
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
          className="rounded-lg border border-foreground/15 px-4 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:text-foreground/30"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>

      <div className="overflow-hidden rounded-lg border border-foreground/10">
        <div
          className={`grid ${columns} items-center gap-x-3 border-b border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-xs uppercase tracking-wide text-foreground/40`}
        >
          <span>Pick</span>
          <span>Manager</span>
          <span>Kicker</span>
        </div>
        {data.picks.length === 0 ? (
          <p className="p-10 text-center text-foreground/55">
            No kickers drafted yet.
          </p>
        ) : (
          <ul>
            {data.picks.map((pick) => (
              <PickRow key={pick.pick} pick={pick} />
            ))}
          </ul>
        )}
        <p className="border-t border-foreground/10 px-3 py-1.5 text-[0.65rem] leading-relaxed text-foreground/35">
          Numbered by order among kickers ({data.teams} per round), not by
          draft slot — the Nth kicker off the board is rookie pick N.
        </p>
      </div>
    </div>
  );
}

function PickRow({ pick }: { pick: PicktrackerPickPayload }) {
  return (
    <li
      className={`grid ${columns} items-center gap-x-3 border-b border-foreground/5 px-3 py-2 last:border-b-0`}
    >
      <span className="font-semibold tabular-nums text-active">{pick.pick}</span>
      {pick.picked_by ? (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar
            url={pick.picked_by.avatar_url}
            name={pick.picked_by.display_name}
          />
          <span className="truncate">{pick.picked_by.display_name}</span>
        </span>
      ) : (
        // Autopicks carry no user id — an em dash, not a guessed manager.
        <span className="text-foreground/40">—</span>
      )}
      <span className="truncate text-foreground/80">{pick.player_name}</span>
    </li>
  );
}

const BackLink = () => (
  <Link
    href="/picktracker"
    className="mb-6 inline-block text-sm text-foreground/50 transition-colors hover:text-foreground/80"
  >
    ← Track another league
  </Link>
);

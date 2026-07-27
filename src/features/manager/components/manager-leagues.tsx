"use client";

import { useMemo, useState } from "react";

import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { LeagueCard } from "./league-card";
import {
  DEFAULT_LEAGUE_FILTERS,
  LeaguesFilters,
  matchesFilters,
  type LeagueFilters,
} from "./manager-leagues-filters";
import { LeaguesHeader } from "./manager-leagues-header";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";

export function ManagerLeagues({ searched }: { searched: string }) {
  const { data, progress, refreshing, error } = useManagerLeagues(searched);
  const [filters, setFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );

  const leagues = data?.leagues;
  const filtered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // Cold load: nothing cached yet.
  if (!data) {
    return (
      <Shell>
        {error ? (
          <ErrorCard message={error} />
        ) : (
          <LoadingState searched={searched} progress={progress} />
        )}
      </Shell>
    );
  }

  const { user, season, summary } = data;

  return (
    <Shell>
      <LeaguesHeader
        user={user}
        leagueCount={filtered.length}
        totalCount={data.leagues.length}
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
      />

      {data.leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <>
          <LeaguesFilters filters={filters} onChange={setFilters} />
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/45">
              No leagues match these filters.
            </p>
          ) : (
            <ul className="flex flex-col gap-4 w-full">
              {filtered.map((league) => (
                <LeagueCard key={league.league_id} league={league} />
              ))}
            </ul>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      {children}
    </main>
  );
}

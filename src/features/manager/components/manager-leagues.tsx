"use client";

import { useMemo, useState } from "react";

import { PageShell } from "@/features/shared";

import {
  DEFAULT_LEAGUE_FILTERS,
  matchesFilters,
  type LeagueFilters,
} from "../filters";
import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { LeagueCard } from "./league-card";
import { LeaguesFilters } from "./manager-leagues-filters";
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
      <PageShell width="wide">
        {error ? (
          <ErrorCard message={error} />
        ) : (
          <LoadingState searched={searched} progress={progress} />
        )}
      </PageShell>
    );
  }

  const { user, season, summary } = data;

  return (
    <PageShell width="wide">
      <LeaguesHeader
        user={user}
        searched={searched}
        leagueCount={filtered.length}
        totalCount={data.leagues.length}
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
        refreshError={error}
      />

      {data.leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <>
          <LeaguesFilters filters={filters} onChange={setFilters} />
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-foreground/10 bg-foreground/[0.02] px-4 py-8 text-center text-sm text-foreground/45">
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
    </PageShell>
  );
}

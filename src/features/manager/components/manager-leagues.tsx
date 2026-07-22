"use client";

import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { LeagueCard } from "./league-card";
import { LeaguesHeader } from "./manager-leagues-header";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";

export function ManagerLeagues({ searched }: { searched: string }) {
  const { data, progress, refreshing, error } = useManagerLeagues(searched);

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

  const { user, leagues, season, summary } = data;

  return (
    <Shell>
      <LeaguesHeader
        user={user}
        leagueCount={leagues.length}
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
      />

      {leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {leagues.map((league) => (
            <LeagueCard key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
  );
}

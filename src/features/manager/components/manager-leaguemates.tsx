"use client";

import { useMemo, useState } from "react";

import { PageShell } from "@/features/shared";

import {
  DEFAULT_LEAGUE_FILTERS,
  matchesFilters,
  type LeagueFilters,
} from "../filters";
import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { useManagerLeaguemates } from "../hooks/use-manager-leaguemates";
import { leaguemateShares } from "../leaguemates";
import { LeaguemateShares } from "./leaguemate-shares";
import { ManagerHeader } from "./manager-header";
import { LeaguesFilters } from "./manager-leagues-filters";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { PanelMessage } from "./ui";

/**
 * Leaguemates: who this manager shares leagues with, and how many.
 *
 * Rides on the same leagues stream as the leagues view — that is what syncs the
 * membership this counts over, so asking for it here means the page is never
 * looking at a manager the sync hasn't run for. The filters are the leagues
 * view's, unchanged, and they narrow the population a share is measured against
 * rather than the people: the crowd you play dynasty with and the crowd you
 * redraft with are different answers.
 */
export function ManagerLeaguemates({ searched }: { searched: string }) {
  const { data, progress, refreshing, error } = useManagerLeagues(searched);
  const membership = useManagerLeaguemates(searched, data?.leagues ?? null);
  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);

  const leagues = data?.leagues;
  const filtered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  const selfId = data?.user.user_id;
  const shares = useMemo(
    () =>
      membership.data && selfId
        ? leaguemateShares(
            filtered,
            membership.data.members,
            membership.data.users,
            selfId,
          )
        : null,
    [filtered, membership.data, selfId],
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
      <ManagerHeader
        user={user}
        searched={searched}
        active="leaguemates"
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
      >
        <span className="text-lg font-medium">
          {shares ? shares.mates.length : "—"} leaguemate
          {shares?.mates.length === 1 ? "" : "s"}
        </span>
        {shares && (
          <span className="text-sm text-foreground/45">
            across {shares.league_count} league
            {shares.league_count === 1 ? "" : "s"}
          </span>
        )}
      </ManagerHeader>

      {data.leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <>
          <LeaguesFilters filters={filters} onChange={setFilters} />
          {membership.error ? (
            <ErrorCard message={membership.error} />
          ) : filtered.length === 0 ? (
            <PanelMessage>No leagues match these filters.</PanelMessage>
          ) : !shares ? (
            <PanelMessage>Loading leaguemates…</PanelMessage>
          ) : shares.mates.length === 0 ? (
            // Every filtered league is one whose members aren't cached, or one
            // the manager shares with nobody — a real answer, not an error.
            <PanelMessage>
              No leaguemates in these leagues yet.
            </PanelMessage>
          ) : (
            <LeaguemateShares
              mates={shares.mates}
              leagueCount={shares.league_count}
            />
          )}
        </>
      )}
    </PageShell>
  );
}

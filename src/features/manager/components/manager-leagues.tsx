"use client";

import { useCallback, useState } from "react";

import { useFilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerAdpValue } from "../hooks/use-manager-adp-value";
import { useManagerKtc } from "../hooks/use-manager-ktc";
import { useManagerRanks } from "../hooks/use-manager-ranks";
import { DEFAULT_COLUMNS } from "../league-metrics";
import { LeagueCard } from "./league-card";
import { LeaguesViewLayout } from "./leagues-view-layout";

/**
 * The leagues view: this manager's leagues as a filterable list of cards, each
 * opening the full standings-and-rosters panel.
 *
 * It, players and leaguemates are the same page — leagues stream, filters, and
 * the header/empty/no-match chrome — so all three sit on {@link useFilteredLeagues}
 * and {@link LeaguesViewLayout} and vary only in the resource they read, the count
 * line, and the body. Here the body is the card list; the resource is the rank
 * and KTC chips those cards wear.
 */
export function ManagerLeagues({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);

  // The card chips are a bonus on top of the list, so a fetch that fails costs
  // the chips and nothing else — the errors go deliberately unread. Three reads
  // rather than one because they answer different questions off different caches:
  // a KTC scrape that is behind shouldn't cost the projected ranks, and the ADP
  // value is a third lens on top of both. All fetch over the unfiltered leagues,
  // since the chips belong to every card the filters might later show.
  const leagues = view.data?.leagues ?? null;
  const ranks = useManagerRanks(searched, leagues);
  const ktc = useManagerKtc(searched, leagues);
  const adp = useManagerAdpValue(searched, leagues);

  // Which metric each of the four stat columns shows, shared by every card so the
  // columns line up down the list — a change on any card's picker moves them all.
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const setColumn = useCallback((slot: number, key: string) => {
    setColumns((current) =>
      current.map((existing, i) => (i === slot ? key : existing)),
    );
  }, []);

  const total = view.data?.leagues.length ?? 0;
  const showing = view.filtered.length;

  return (
    <LeaguesViewLayout
      view={view}
      active="leagues"
      count={
        <span className="text-sm text-foreground/60">
          <b className="text-base font-bold text-foreground">
            {showing === total ? total : showing}
          </b>{" "}
          {showing === total ? "" : `of ${total} `}league
          {total === 1 ? "" : "s"}
        </span>
      }
    >
      <ul className="flex flex-col gap-4 w-full">
        {view.filtered.map((league) => (
          <LeagueCard
            key={league.league_id}
            league={league}
            ranks={ranks.data?.ranks[league.league_id] ?? null}
            weeks={ranks.data?.weeks ?? []}
            ktc={ktc.data?.leagues[league.league_id] ?? null}
            valuedAt={ktc.data?.updated_at ?? null}
            adp={adp.data?.leagues[league.league_id] ?? null}
            columns={columns}
            onColumnChange={setColumn}
          />
        ))}
      </ul>
    </LeaguesViewLayout>
  );
}

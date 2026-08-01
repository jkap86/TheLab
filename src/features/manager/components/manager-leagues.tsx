"use client";

import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { useAdpControls } from "../filters-context";
import { useFilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerAdpValue } from "../hooks/use-manager-adp-value";
import { useManagerKtc } from "../hooks/use-manager-ktc";
import { useManagerRanks } from "../hooks/use-manager-ranks";
import {
  DEFAULT_COLUMNS,
  LEAGUE_COLUMN_PRESETS,
  LEAGUE_METRICS,
  type MetricContext,
} from "../league-metrics";
import { ColumnsBar } from "./columns-bar";
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
  // Only the steepness of the shared ADP drawer drives the team value; the board
  // filters beside it belong to the Players-tab per-player ADP, and the drawer's
  // date range with them — each league here is priced on its own season's board.
  const { controls } = useAdpControls();
  const adp = useManagerAdpValue(searched, leagues, controls.steepness);

  // Which metric each of the four stat columns shows, shared by every card so the
  // columns line up down the list — a change on any card's picker moves them all.
  // Kept on the device rather than in state: they are aimed once and then read,
  // so a reload or a trip out to another tool used to cost re-aiming all four.
  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "league",
    DEFAULT_COLUMNS,
    LEAGUE_METRICS,
  );

  const total = view.data?.leagues.length ?? 0;
  const showing = view.filtered.length;

  // What the editor previews a metric against: the first league on screen. An
  // assumption — every league has its own numbers — so the editor names it in
  // the footer rather than letting `#3 / 12` pass as the column's own answer.
  const first = view.filtered[0] ?? null;
  const previewCtx: MetricContext | null = first
    ? {
        league: first,
        ranks: ranks.data?.ranks[first.league_id] ?? null,
        weeks: ranks.data?.weeks ?? [],
        ktc: ktc.data?.leagues[first.league_id] ?? null,
        valuedAt: ktc.data?.updated_at ?? null,
        adp: adp.data?.leagues[first.league_id] ?? null,
      }
    : null;

  return (
    <LeaguesViewLayout
      view={view}
      stat={{
        label: "Leagues",
        value: showing,
        sub: showing === total ? undefined : `of ${total} total`,
      }}
      columns={
        <ColumnsBar
          metrics={LEAGUE_METRICS}
          columns={columns}
          presets={LEAGUE_COLUMN_PRESETS}
          ctx={previewCtx}
          previewLabel={first?.name ?? null}
          onColumnChange={setColumn}
          onColumns={setColumns}
          onReset={reset}
        />
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
          />
        ))}
      </ul>
    </LeaguesViewLayout>
  );
}

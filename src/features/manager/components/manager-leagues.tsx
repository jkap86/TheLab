"use client";

import { useMemo, useState } from "react";

import { adpValueQueryString, todayIso } from "@/features/shared";
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
 *
 * Which league is open lives here rather than in the card, because opening one
 * is a claim about the whole page: the card is pulled to the top of the screen
 * and capped at it, and the manager plate above lets go of the top so the panel
 * has the screen to itself. Two cards making that claim at once is two things
 * each asking to be the one being read, so opening a league closes the one
 * before it.
 */
export function ManagerLeagues({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);
  const [openId, setOpenId] = useState<string | null>(null);

  // The card chips are a bonus on top of the list, so a fetch that fails costs
  // the chips and nothing else — the errors go deliberately unread. Three reads
  // rather than one because they answer different questions off different caches:
  // a KTC scrape that is behind shouldn't cost the projected ranks, and the ADP
  // value is a third lens on top of both. All fetch over the unfiltered leagues,
  // since the chips belong to every card the filters might later show.
  const leagues = view.data?.leagues ?? null;
  const ranks = useManagerRanks(searched, view.userId, leagues);
  const ktc = useManagerKtc(searched, view.userId, leagues);
  // The whole shared ADP drawer drives the team value, not just its curve: the
  // window, the kind of draft, the league size and the format all narrow the
  // population these cards are priced against, so a panel showing startup ADP
  // and a column priced off every draft crawled can't be two answers to one
  // question any more. Scoring and superflex are the exception and stay behind
  // on the server, matched per league — see `adpValueQueryString`.
  const { controls } = useAdpControls();
  const adpBoard = useMemo(() => adpValueQueryString(controls, todayIso()), [controls]);
  const adp = useManagerAdpValue(searched, view.userId, leagues, adpBoard);

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

  // Read against the list on screen rather than trusted: narrowing the filters
  // can take the open league out from under the selection, and an id pointing
  // at a card nobody can see would leave the header unpinned for a panel that
  // isn't there. Derived during render, so there is no effect chasing the
  // filters to reset it.
  const open = view.filtered.some((l) => l.league_id === openId) ? openId : null;

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
      // The header lets go of the top while a league is open — the open card is
      // sized to the screen, and a plate pinned over it would be taking a
      // quarter of the panel to restate facts about the account.
      pinned={open === null}
      columns={
        <ColumnsBar
          view={view}
          headings={showing > 0}
          metrics={LEAGUE_METRICS}
          columns={columns}
          subject="League"
          presets={LEAGUE_COLUMN_PRESETS}
          ctx={previewCtx}
          previewLabel={first?.name ?? null}
          onColumnChange={setColumn}
          onColumns={setColumns}
          onReset={reset}
        />
      }
    >
      {/* 18px rather than the 16 this list ran at, and it is the nameplate's
          number rather than a separation one — the trades board arrived at it
          for the same part. Each card's name rides out of its top edge on a
          plate that hangs into the card's own 12px of padding, so at a 12px gap
          the plate sat almost exactly between two cards and could be read as
          belonging to either; at 18 there is visibly more ground above it than
          below. Check that before moving it. */}
      <ul className="flex w-full flex-col gap-[18px]">
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
            expanded={open === league.league_id}
            onToggle={() =>
              setOpenId((current) =>
                current === league.league_id ? null : league.league_id,
              )
            }
          />
        ))}
      </ul>
    </LeaguesViewLayout>
  );
}

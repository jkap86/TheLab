"use client";

import { useMemo, useState } from "react";

import { adpValueRead, useTodayIso } from "@/features/shared";
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
  managerDataRequirements,
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
 * is a claim about the whole page: the card is pulled up under the pinned header
 * and capped at what is left of the screen, so the panel scrolls inside itself
 * rather than running the list several screens down. Two cards making that claim
 * at once is two things each asking to be the one being read, so opening a league
 * closes the one before it.
 */
export function ManagerLeagues({ searched }: { searched: string }) {
  const view = useFilteredLeagues(searched);
  const [openId, setOpenId] = useState<string | null>(null);

  // Which metric each of the four stat columns shows, shared by every card so the
  // columns line up down the list — a change on any card's picker moves them all.
  // Kept on the device rather than in state: they are aimed once and then read,
  // so a reload or a trip out to another tool used to cost re-aiming all four.
  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "league",
    DEFAULT_COLUMNS,
    LEAGUE_METRICS,
  );

  /**
   * Whether the columns editor has ever been opened on this page.
   *
   * It previews every metric in the catalogue, not the four on screen, so from
   * the moment it opens the two optional datasets are being drawn whatever the
   * selection says. Latched rather than tracking whether it is open, for the
   * reason `useColumnsEditor` latches its own mount: a preview that filled in and
   * then emptied when the dialog closed would be worse than one that never
   * emptied, and the read is cached either way.
   */
  const [editorOpened, setEditorOpened] = useState(false);

  /**
   * Which of the three batch reads anything on screen actually needs.
   *
   * The optional two are expensive at the far end — the KTC route solves every
   * team's optimal lineup in every league, the ADP one prices every roster
   * against a crawled board — and a reader can aim all four columns away from
   * both, which used to cost the requests anyway and display neither. `ranks`
   * comes back true unconditionally, because the record ledge on every card reads
   * the standing off it and no column controls that; see
   * {@link managerDataRequirements}.
   *
   * **The persisted selection is always in hand before either read can fire**,
   * and the two ways onto this page reach that by different routes. On a client
   * navigation there is no server render, so `useLocalValue` reads storage from
   * the first render and the stored columns are what these are derived from. On a
   * fresh load the store deliberately has no server snapshot — that is the
   * hydration rule it exists to keep — so the first render *is* the defaults; but
   * a fresh load starts with an empty `QueryClient`, so `leagues` is null and both
   * reads are gated off it until a stream resolves, which is many frames after
   * hydration has swapped the stored row in. Neither order needs an effect, and
   * neither leaves a window where the defaults ask for something the stored
   * columns would not.
   */
  const needs = useMemo(() => managerDataRequirements(columns), [columns]);

  // The card chips are a bonus on top of the list, so a fetch that fails costs
  // the chips and nothing else — the errors go deliberately unread. Three reads
  // rather than one because they answer different questions off different caches:
  // a KTC scrape that is behind shouldn't cost the projected ranks, and the ADP
  // value is a third lens on top of both. All fetch over the unfiltered leagues,
  // since the chips belong to every card the filters might later show.
  const leagues = view.data?.leagues ?? null;
  // Always asked for — the record ledge reads the standing off it — but its
  // expensive half is asked for only when something draws it. The editor's
  // preview draws every metric in the catalogue, so opening it turns the
  // projected ranks on for the same reason it turns the other two reads on.
  const ranks = useManagerRanks(searched, view.userId, leagues, {
    projections: needs.projections || editorOpened,
    season: view.seasonRead,
  });
  const ktc = useManagerKtc(searched, view.userId, leagues, {
    enabled: needs.ktc || editorOpened,
    season: view.seasonRead,
  });
  // The whole shared ADP drawer drives the team value, not just its curve: the
  // window, the kind of draft and the league rules all narrow the population
  // these cards are priced against, so a panel showing startup ADP and a column
  // priced off every draft crawled can't be two answers to one question any
  // more. Scoring and superflex are the exception and stay behind on the server,
  // matched per league — see `adpValueRead`.
  const { controls, scope } = useAdpControls();
  // Watched rather than read once: a relative window ("last 30 days") is
  // resolved against a date, so a tab left open overnight would go on pricing
  // these cards off yesterday's board — see {@link useTodayIso}.
  const today = useTodayIso();
  const adpBoard = useMemo(
    () => adpValueRead(controls, scope, today),
    [controls, scope, today],
  );
  const adp = useManagerAdpValue(searched, view.userId, leagues, adpBoard, {
    enabled: needs.adp || editorOpened,
    // Which season's *rosters* are priced. The board's own season is inside
    // `adpBoard` and stays the reader's: a 2024 roster read against this year's
    // market is a question somebody can legitimately be asking.
    season: view.seasonRead,
  });

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
      columns={
        <ColumnsBar
          view={view}
          headings={showing > 0}
          // The heading rail holds the top through an open league too: it is
          // what names the four columns the rows under it are being read on, and
          // losing that at the moment a reader goes a level deeper is what the
          // whole header pinning used to be justified by. What it gives up is the
          // fade below itself — an open card pins flush against the rail, so that
          // near-solid background would land on the card's own head rather than
          // on the page.
          pinned
          fade={open === null}
          metrics={LEAGUE_METRICS}
          columns={columns}
          subject="League"
          presets={LEAGUE_COLUMN_PRESETS}
          ctx={previewCtx}
          previewLabel={first?.name ?? null}
          onColumnChange={setColumn}
          onColumns={setColumns}
          onReset={reset}
          // The editor previews the whole catalogue, so from here on the two
          // optional reads are on screen whatever the four columns hold.
          onEditorOpen={() => setEditorOpened(true)}
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
      <ul className="flex w-full flex-col gap-[1.125rem]">
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

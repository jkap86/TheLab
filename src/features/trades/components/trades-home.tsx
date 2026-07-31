"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Avatar,
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  LeagueFiltersModal,
  filterSummary,
  matchesFilters,
  todayIso,
  useStoredAccount,
  useUserLeagues,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";

import {
  DEFAULT_TRADE_FILTERS,
  tradeFilterSummary,
  tradeMatches,
  tradeRangeBounds,
} from "../filters";
import type { TradeFilters } from "../filters";
import { useTrades } from "../hooks/use-trades";
import { TradeCard } from "./trade-card";
import { TradeFiltersModal } from "./trade-filters-modal";

/**
 * Every trade in the stored account's leagues, newest first, behind two
 * independent filter sets.
 *
 * The page reads the account the tools grid resolved rather than asking for a
 * username again — the same persistence the pick tracker's league picker leans
 * on. With no account there is nothing to read at all, so it says so and points
 * back at the tool that resolves one, rather than rendering an empty list that
 * looks like an account with no trades.
 *
 * Both filter sets are applied here, on the client, over one read of the season's
 * trades. That is the shape the filters demand rather than a shortcut: the
 * league filters run against the league list this page already streams (the same
 * `settings` quirks the manager tabs read), and the trade filters' own option
 * lists — which players moved, who deals most — are read *off the trades*, so
 * the unnarrowed set has to be in hand either way.
 */
export function TradesHome() {
  const user = useStoredAccount();
  const leaguesState = useUserLeagues(user?.user_id ?? null);
  const { data, loading, error } = useTrades(
    user?.user_id ?? null,
    leaguesState.leagues,
  );

  const [leagueFilters, setLeagueFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );
  const [tradeFilters, setTradeFilters] = useState<TradeFilters>(
    DEFAULT_TRADE_FILTERS,
  );

  const leagues = useMemo(() => leaguesState.leagues ?? [], [leaguesState.leagues]);
  const leaguesById = useMemo(
    () => new Map(leagues.map((league) => [league.league_id, league])),
    [leagues],
  );

  // Resolved once per render rather than per trade, and against a date rather
  // than the clock, so the list only moves when the day does.
  const today = todayIso();
  const bounds = useMemo(
    () => tradeRangeBounds(tradeFilters.range, today),
    [tradeFilters.range, today],
  );

  const trades = useMemo(() => data?.trades ?? [], [data]);
  const inLeagues = useMemo(() => {
    const allowed = new Set(
      leagues
        .filter((league) => matchesFilters(league, leagueFilters))
        .map((league) => league.league_id),
    );
    // Before the league list answers there is nothing to narrow *with*, so the
    // trades stand rather than being filtered down to none by an empty set.
    return leaguesById.size === 0
      ? trades
      : trades.filter((trade) => allowed.has(trade.league_id));
  }, [trades, leagues, leagueFilters, leaguesById]);

  const visible = useMemo(
    () => inLeagues.filter((trade) => tradeMatches(trade, tradeFilters, bounds)),
    [inLeagues, tradeFilters, bounds],
  );

  if (!user) return <NoAccount />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Trades</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-foreground/60">
            <Avatar
              url={user.avatar_url}
              name={user.display_name || user.username}
            />
            <span className="min-w-0 truncate">
              {/* What the count beside it is over, in words — the two modals
                  hide their own state, so the scope is stated outside them. */}
              {user.display_name || user.username} ·{" "}
              {filterSummary(leagueFilters)} · {tradeFilterSummary(tradeFilters)}
            </span>
          </p>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <p className="text-right text-sm text-foreground/60">
            <b className="text-lg font-semibold tabular-nums text-foreground">
              {visible.length}
            </b>{" "}
            {visible.length === inLeagues.length
              ? "trades"
              : `of ${inLeagues.length} trades`}
          </p>
          <LeagueFiltersModal
            filters={leagueFilters}
            onChange={setLeagueFilters}
            leagues={leagues}
          />
          <TradeFiltersModal
            filters={tradeFilters}
            onChange={setTradeFilters}
            trades={inLeagues}
            players={data?.players ?? {}}
            managers={data?.managers ?? {}}
            today={today}
          />
        </div>
      </header>

      {error && <Note tone="error">{error}</Note>}

      {loading && !data ? (
        <div className="flex flex-col items-center gap-3 py-16 text-foreground/60">
          <FlaskLoader />
          <p className="text-sm">Reading your leagues&rsquo; trades…</p>
        </div>
      ) : visible.length === 0 ? (
        <Note>
          {trades.length === 0
            ? // Transactions arrive with the league sync, so an account nobody
              // has looked up yet has none stored rather than none made.
              "No trades stored for this account's leagues yet. They sync with your leagues — open the manager tool if this is your first visit."
            : "No trades match these filters."}
        </Note>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((trade) => (
            <li key={trade.transaction_id}>
              <TradeCard
                trade={trade}
                league={leaguesById.get(trade.league_id) ?? null}
                players={data?.players ?? {}}
                managers={data?.managers ?? {}}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NoAccount() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Trades</h1>
      <p className="mt-2 text-foreground/60">
        Every trade in your leagues, filterable by league, date, the players and
        picks that moved, and who was involved.
      </p>
      <p className="mt-6 text-sm text-foreground/60">
        Look up your Sleeper account on the{" "}
        <Link href="/tools" className="font-semibold text-active hover:underline">
          tools page
        </Link>{" "}
        first — this page reads your leagues from it.
      </p>
    </div>
  );
}

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={`rounded-xl border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-400/25 bg-red-400/5 text-red-200"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/60"
      }`}
    >
      {children}
    </p>
  );
}

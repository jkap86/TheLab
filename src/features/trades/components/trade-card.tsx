"use client";

import { Fragment } from "react";

import {
  Avatar,
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  MONTH_ABBREVIATIONS,
  RowSheen,
  ordinal,
} from "@/features/shared";
import type { ManagerLeague } from "@/shared/manager";

import { isEmptyBundle, isPairedExchange, tradeExchange } from "../exchange";
import type { SideExchange, TradeBundle } from "../exchange";
import type { PlayerSummary, Trade, TradeManager, TradeSide } from "../types";

/**
 * One trade: which league it happened in, when, and what each side came away
 * with.
 *
 * On a wide screen the sides are columns rather than a "gave / got" sentence,
 * because a trade has no privileged direction — three-way trades happen, and
 * even in a two-way one the reader is as likely to be reading it from either
 * end. Each column is headed by the manager and lists what *they received*,
 * which is the only framing that scales past two participants.
 *
 * On a phone those columns stack, and a stack loses the thing the columns were
 * for: what one side received sits above what the other did, with nothing to
 * read across. So the narrow layout turns the card ninety degrees — a row per
 * manager, with what they give beside what they receive — which fits because a
 * two-sided trade's giving half is derivable (`../exchange`). A trade with more
 * sides keeps the stacked columns at every width, since there is no honest way
 * to say who gave what in one.
 */
export function TradeCard({
  trade,
  league,
  players,
  managers,
}: {
  trade: Trade;
  /** Null where the league list hasn't answered yet; the id stands in. */
  league: ManagerLeague | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
}) {
  const exchange = tradeExchange(trade);
  const paired = isPairedExchange(exchange);

  return (
    // The same lit surface a league or a share row wears: a trade *is* a row in a
    // long list, and the three lists reading as one material is the point of
    // sharing it. The side columns keep their own opaque ground below.
    <article className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER} overflow-hidden`}>
      <RowSheen />

      <header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/10 px-4 py-2.5 pl-5">
        <h3 className="min-w-0 truncate font-display text-[13px] font-semibold tracking-tight">
          {league?.name ?? trade.league_id}
        </h3>
        <span className="ml-auto text-xs tabular-nums text-foreground/50">
          {formatTradeDate(trade.completed_at)}
          {trade.week ? ` · Wk ${trade.week}` : ""}
        </span>
      </header>

      {paired && (
        <ExchangeTable
          exchange={exchange}
          trade={trade}
          players={players}
          managers={managers}
        />
      )}

      <div
        className={`relative gap-px bg-foreground/10 sm:grid-cols-2 ${
          // Where the give/take table is drawn, these columns are the wide
          // layout only; a three-way trade has no table and keeps them at every
          // width. The display utility is written once per branch rather than a
          // base `grid` with `hidden` layered over it — two display utilities on
          // one element resolve by stylesheet order, not by class order.
          paired ? "hidden sm:grid" : "grid"
        }`}
      >
        {trade.sides.map((side) => (
          <SideColumn
            key={side.roster_id}
            side={side}
            trade={trade}
            players={players}
            managers={managers}
          />
        ))}
      </div>
    </article>
  );
}

/**
 * The narrow layout: a row per manager, giving on the left and receiving on the
 * right, under one pair of headings.
 *
 * The manager column is fixed and narrow because the assets are what is being
 * read across — a name is a label on the row, and letting it take a third of a
 * 390px screen would wrap every player in the two columns that matter. Assets
 * wrap rather than truncate for the same reason: a truncated "Christian McCa…"
 * beside a truncated pick is a card that has to be opened elsewhere to read.
 */
function ExchangeTable({
  exchange,
  trade,
  players,
  managers,
}: {
  exchange: SideExchange[];
  trade: Trade;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
}) {
  return (
    <div className="relative grid grid-cols-[4.75rem_1fr_1fr] gap-x-2 bg-foreground/[0.02] px-3 py-2 sm:hidden">
      <span />
      <ColumnHeading>Gives</ColumnHeading>
      <ColumnHeading>Receives</ColumnHeading>

      {exchange.map((side) => {
        const manager = side.user_id ? managers[side.user_id] : undefined;
        const name = manager?.display_name || `Roster ${side.roster_id}`;
        // Guarded by `isPairedExchange` at the call site; a null here would be a
        // three-way trade, which never reaches this layout.
        const given = side.given ?? { players: [], picks: [], faab: 0 };

        return (
          <Fragment key={side.roster_id}>
            <div className={`${ROW_CELL} flex min-w-0 items-center gap-1.5`}>
              <Avatar url={manager?.avatar_url} name={name} />
              <span className="min-w-0 truncate text-xs font-semibold">
                {name}
              </span>
            </div>
            <BundleList
              bundle={given}
              trade={trade}
              players={players}
              managers={managers}
              className={ROW_CELL}
            />
            <BundleList
              bundle={side.received}
              trade={trade}
              players={players}
              managers={managers}
              className={ROW_CELL}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The rule between two managers' rows. It is worn by each of the three cells
 * rather than by a row wrapper, because the rows *are* grid cells — a wrapper
 * would take the columns out of the grid and let each row size its own.
 */
const ROW_CELL = "border-t border-foreground/10 py-2";

function ColumnHeading({ children }: { children: string }) {
  return (
    <span className="pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/35">
      {children}
    </span>
  );
}

function SideColumn({
  side,
  trade,
  players,
  managers,
}: {
  side: TradeSide;
  trade: Trade;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
}) {
  const manager = side.user_id ? managers[side.user_id] : undefined;
  const name = manager?.display_name || `Roster ${side.roster_id}`;

  return (
    // Translucent rather than the flat panel it was, so the card's own glass
    // reads through it — the hairline between two sides is the grid's `gap-px`
    // showing where the cells don't reach, which a translucent cell still leaves.
    <div className="bg-foreground/[0.02] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/35">
          Receives
        </span>
      </div>

      <BundleList
        bundle={{ players: side.players, picks: side.picks, faab: side.faab }}
        trade={trade}
        players={players}
        managers={managers}
      />
    </div>
  );
}

/**
 * What one bundle holds, as lines. Shared by both layouts so the two can't drift
 * about how a pick or a FAAB line reads.
 */
function BundleList({
  bundle,
  trade,
  players,
  managers,
  className = "",
}: {
  bundle: TradeBundle;
  trade: Trade;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  className?: string;
}) {
  if (isEmptyBundle(bundle)) {
    // A side of a three-way can take nothing from this participant, and in the
    // give/take layout a giving column can be empty too; saying so is clearer
    // than a blank cell that reads as a rendering gap.
    return (
      <p className={`${className} text-[13px] text-foreground/40 sm:text-sm`}>
        Nothing
      </p>
    );
  }

  return (
    <ul className={`${className} flex flex-col gap-1.5`}>
      {bundle.players.map((id) => (
        <li
          key={id}
          className="flex flex-wrap items-baseline gap-x-2 text-[13px] sm:text-sm"
        >
          <span className="min-w-0 break-words">{players[id]?.name ?? id}</span>
          <span className="shrink-0 text-xs text-foreground/45">
            {[players[id]?.position, players[id]?.team]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
      {bundle.picks.map((pick) => (
        <li
          key={`${pick.season}-${pick.round}-${pick.roster_id}`}
          className="text-[13px] text-foreground/80 sm:text-sm"
        >
          {pick.season} {ordinal(pick.round)}
          {/* Whose pick it originally is, where the trade names that roster
              — a 2026 1st is a different asset depending on who it's from. */}
          <span className="text-xs text-foreground/45">
            {" "}
            {pickOrigin(pick.roster_id, trade, managers)}
          </span>
        </li>
      ))}
      {bundle.faab > 0 && (
        <li className="text-[13px] text-foreground/80 sm:text-sm">
          ${bundle.faab} FAAB
        </li>
      )}
    </ul>
  );
}

/**
 * Whose pick this is, named where the trade itself names that roster.
 *
 * Only the participating rosters are resolvable from a trade — a pick can come
 * from a team that isn't in it, and chasing that name would mean loading every
 * league's rosters to decorate a line. The roster number is the honest fallback.
 */
function pickOrigin(
  rosterId: number,
  trade: Trade,
  managers: Record<string, TradeManager>,
): string {
  const owner = trade.sides.find((s) => s.roster_id === rosterId)?.user_id;
  const name = owner ? managers[owner]?.display_name : null;
  return `from ${name || `roster ${rosterId}`}`;
}

/**
 * The completed date, e.g. `Jul 15, 2026`. Spelled out through the shared month
 * table rather than `toLocaleDateString` so it reads the same wherever the page
 * is opened — the same rule the ADP range labels follow. An undated trade (one
 * Sleeper filed without a timestamp) says so rather than showing an epoch.
 */
function formatTradeDate(at: number | null): string {
  if (at === null) return "date unknown";
  const d = new Date(at);
  return `${MONTH_ABBREVIATIONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

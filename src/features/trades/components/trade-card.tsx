"use client";

import { Avatar, MONTH_ABBREVIATIONS, ordinal } from "@/features/shared";
import type { ManagerLeague } from "@/shared/manager";

import type { PlayerSummary, Trade, TradeManager, TradeSide } from "../types";

/**
 * One trade: which league it happened in, when, and what each side came away
 * with.
 *
 * Sides are columns rather than a "gave / got" sentence, because a trade has no
 * privileged direction — three-way trades happen, and even in a two-way one the
 * reader is as likely to be reading it from either end. Each column is headed by
 * the manager and lists what *they received*, which is the only framing that
 * scales past two participants.
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
  return (
    <article className="overflow-hidden rounded-xl border border-foreground/10 bg-foreground/[0.02]">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/10 px-4 py-2.5">
        <h3 className="min-w-0 truncate text-sm font-semibold">
          {league?.name ?? trade.league_id}
        </h3>
        <span className="ml-auto text-xs tabular-nums text-foreground/50">
          {formatTradeDate(trade.completed_at)}
          {trade.week ? ` · Wk ${trade.week}` : ""}
        </span>
      </header>

      <div className="grid gap-px bg-foreground/10 sm:grid-cols-2">
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
  const empty =
    side.players.length === 0 && side.picks.length === 0 && side.faab === 0;

  return (
    <div className="bg-[#0b1621] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/35">
          Receives
        </span>
      </div>

      {empty ? (
        // A side of a three-way can take nothing from this participant; saying so
        // is clearer than an empty column that reads as a rendering gap.
        <p className="text-sm text-foreground/40">Nothing</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {side.players.map((id) => (
            <li key={id} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 truncate">
                {players[id]?.name ?? id}
              </span>
              <span className="shrink-0 text-xs text-foreground/45">
                {[players[id]?.position, players[id]?.team]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
          {side.picks.map((pick) => (
            <li
              key={`${pick.season}-${pick.round}-${pick.roster_id}`}
              className="text-sm text-foreground/80"
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
          {side.faab > 0 && (
            <li className="text-sm text-foreground/80">${side.faab} FAAB</li>
          )}
        </ul>
      )}
    </div>
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

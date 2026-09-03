"use client";

import { memo } from "react";

import type { ManagerLeague, Trade, TradeSide } from "@/shared/contract";
import { pickSlotKey } from "@/shared/trades/pick-slots";
import { Avatar } from "@/features/shared";

import {
  givenBundle,
  isEmptyBundle,
  receivedBundle,
  type TradeBundle,
} from "../exchange";
import { pickLabel, pickOriginRoster } from "../pick-display";
import type { TradesData } from "../trades-data";

/**
 * One trade, as a plate with a side per participating roster.
 *
 * **Each side says what it received and what it gave, and the redundancy is the
 * point.** On a two-sided card the give lines repeat the other side's take
 * lines — which is what lets one manager's half be read on its own, the way a
 * card in a long list actually gets read. It is paid for by drawing the gives
 * as the dimmer half of the pair, so the card still reads take-first.
 *
 * A three-way trade has no knowable gives: nothing Sleeper stores says which
 * participant a pick came *through*, so `givenBundle` answers null and the
 * card draws the take column alone rather than guessing.
 *
 * `memo`'d because the list re-renders on every appended page and a card's
 * props are stable — the maps it reads are the folded ones, which only change
 * when a page lands.
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  data,
}: {
  trade: Trade;
  /** Null before the leagues request lands, or if it failed. */
  league: ManagerLeague | null;
  data: TradesData;
}) {
  return (
    <li className="relative">
      <article className="relative rounded-2xl border border-foreground/9 bg-[image:var(--card-bg)] px-5 pb-5 pt-7 shadow-[var(--card-shadow)]">
        {/* Both plates straddle the top edge, the way the console's plates do —
            the league is what the trade is *in* and the date is when, so they
            label the card rather than sitting inside it as more lines.
            **One flex row rather than two absolutely-positioned spans**: laid
            out independently they overlap at 390, where the date is nearly as
            wide as the card and the league name ran straight under it. In a
            row the date keeps its width and the name truncates, which is the
            right way round — a clipped league name is still readable, a
            clipped date is not. */}
        <div className="absolute -top-2.5 left-5 right-5 flex items-center gap-2">
          <span className="min-w-0 truncate rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-3 py-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/70 shadow-[var(--plate-shadow)]">
            {league?.name ?? trade.league_id}
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-3 py-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/60 shadow-[var(--plate-shadow)]">
            <TradeDate at={trade.completed_at} week={trade.week} />
          </span>
        </div>

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {trade.sides.map((side) => (
            <SideColumn
              key={side.roster_id}
              trade={trade}
              side={side}
              data={data}
            />
          ))}
        </div>
      </article>
    </li>
  );
});

/**
 * When the trade went through.
 *
 * **An undated trade says so in words rather than drawing an empty plate.**
 * Sleeper files a few with neither timestamp, and they sort to the bottom of
 * the board by the same rule; a blank where every other card carries a date
 * reads as a rendering fault.
 */
function TradeDate({ at, week }: { at: number | null; week: number | null }) {
  if (at === null) return <>Undated{week ? ` · Wk ${week}` : ""}</>;
  const date = new Date(at);
  return (
    <>
      {date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
      {week ? ` · Wk ${week}` : ""}
    </>
  );
}

/** One roster's half: who they are, what came in, and what went out. */
function SideColumn({
  trade,
  side,
  data,
}: {
  trade: Trade;
  side: TradeSide;
  data: TradesData;
}) {
  const manager = side.user_id ? data.managers[side.user_id] : undefined;
  const received = receivedBundle(side);
  const given = givenBundle(trade, side);

  return (
    <section className="min-w-0 rounded-xl border border-foreground/8 bg-foreground/[0.02] p-3.5">
      <header className="mb-3 flex min-w-0 items-center gap-2.5">
        <Avatar
          url={manager?.avatar_url}
          name={manager?.display_name ?? `Roster ${side.roster_id}`}
          size="sm"
        />
        <span className="truncate text-[0.8125rem] font-medium text-foreground/90">
          {/* Sleeper lets a display name go missing and leaves orphan rosters
              with no owner at all, so the roster number is the fallback — a
              real label, not a placeholder. */}
          {manager?.display_name ?? `Roster ${side.roster_id}`}
        </span>
      </header>

      <AssetTrack
        direction="in"
        bundle={received}
        trade={trade}
        side={side}
        data={data}
      />
      {given && (
        <AssetTrack
          direction="out"
          bundle={given}
          trade={trade}
          side={side}
          data={data}
        />
      )}
    </section>
  );
}

/**
 * One direction's lines.
 *
 * The give track is dimmer and the take track is not, which is the whole of how
 * a card that says everything twice still reads take-first.
 */
function AssetTrack({
  direction,
  bundle,
  trade,
  side,
  data,
}: {
  direction: "in" | "out";
  bundle: TradeBundle;
  trade: Trade;
  side: TradeSide;
  data: TradesData;
}) {
  const inbound = direction === "in";
  const tone = inbound ? "text-foreground/85" : "text-foreground/60";
  const sign = inbound ? "+" : "−";

  if (isEmptyBundle(bundle)) {
    // A real case in a three-way: a roster can send a player one way and take
    // nothing back from that participant. Saying "nothing" is the answer; an
    // absent track would read as a card that failed to draw.
    return (
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
        {inbound ? "Received nothing" : "Gave nothing"}
      </p>
    );
  }

  return (
    <ul className={`space-y-1 ${inbound ? "" : "mt-2.5 border-t border-foreground/8 pt-2.5"}`}>
      {bundle.players.map((id) => {
        const player = data.players[id];
        return (
          <li key={`p${id}`} className={`flex min-w-0 gap-2 text-[0.8125rem] ${tone}`}>
            <span aria-hidden className="shrink-0 font-mono text-foreground/35">
              {sign}
            </span>
            <span className="truncate">
              {/* The id is the fallback rather than a blank: it is a visible,
                  searchable token when the stored players map is behind
                  Sleeper's. */}
              {player?.name ?? id}
              {player?.position && (
                <span className="ml-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-foreground/60">
                  {player.position}
                  {player.team ? ` · ${player.team}` : ""}
                </span>
              )}
            </span>
          </li>
        );
      })}

      {bundle.picks.map((pick, i) => {
        const slot =
          data.pickSlots[
            pickSlotKey(trade.league_id, pick.season, pick.roster_id)
          ] ?? null;
        // The origin is drawn exactly when it is a *surprise* — a pick that did
        // not come from the roster handing it over. Printing "from X" beside a
        // pick X just gave away is noise on most cards that carry one.
        const origin = pickOriginRoster(
          pick,
          inbound
            ? // For the take track the giver is the counterparty, which
              // `givenBundle`'s own rule already knows how to find; a
              // three-way makes it unknowable, and then the origin always
              // prints, which is the honest answer.
              (trade.sides.length === 2
                ? (trade.sides.find((s) => s.roster_id !== side.roster_id)
                    ?.roster_id ?? null)
                : null)
            : side.roster_id,
        );
        const from = origin === null ? null : data.managers[pick.user_id ?? ""];

        return (
          <li
            key={`k${pick.season}-${pick.round}-${pick.roster_id}-${i}`}
            className={`flex min-w-0 gap-2 text-[0.8125rem] ${tone}`}
          >
            <span aria-hidden className="shrink-0 font-mono text-foreground/35">
              {sign}
            </span>
            <span className="truncate">
              {pickLabel(pick, slot)}
              {origin !== null && (
                <span className="ml-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-foreground/60">
                  {/* Named as a *person*: "from" points at who traded it away,
                      where the side header prefers whatever the manager is
                      called. A roster with no stored owner keeps its number. */}
                  from {from?.display_name ?? `Roster ${pick.roster_id}`}
                </span>
              )}
            </span>
          </li>
        );
      })}

      {bundle.faab > 0 && (
        <li className={`flex gap-2 text-[0.8125rem] ${tone}`}>
          <span aria-hidden className="shrink-0 font-mono text-foreground/35">
            {sign}
          </span>
          {/* In the league's own units, which Sleeper does not name — so the
              figure carries the label rather than a currency symbol. */}
          <span className="font-mono">{bundle.faab} FAAB</span>
        </li>
      )}
    </ul>
  );
}

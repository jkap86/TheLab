"use client";

import { memo } from "react";

import type { ManagerLeague, Trade, TradeSide } from "@/shared/contract";
import { pickSlotKey } from "@/shared/trades/pick-slots";
import {
  CardPlateRow,
  CONSOLE_CARD,
  CONSOLE_WINDOW,
  LeaguePlate,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";

import {
  bundleValue,
  formatAssetValue,
  assetValue,
  NO_ASSET_VALUES,
} from "../asset-value";
import {
  givenBundle,
  isEmptyBundle,
  receivedBundle,
  type TradeBundle,
} from "../exchange";
import { pickLabel, pickOriginRoster } from "../pick-display";
import type { TradesData } from "../trades-data";

/**
 * One trade, as a housing with a lit window per participating roster.
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
 * **The card is an instrument housing and every side is a window cut into it**,
 * which is the console-card language `/manager` and `/lineupchecker` carry too
 * — the same league seen from three tools should read as the same object. Type
 * inside the card is all mono, set on the article so nothing inside has to
 * remember.
 *
 * **There is no fairness or "who won" indicator, deliberately.** An earlier
 * round of the design had a balance meter and a delta plate and they were
 * removed: the values are shown and the comparison is left to the reader. Do
 * not reintroduce one.
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
      <article className={`${CONSOLE_CARD} font-mono`}>
        {/* The league is what the trade is *in* and the date is when, so they
            label the card from its top edge rather than sitting inside it as
            two more lines. One row, never two absolutely-positioned spans —
            `CardPlateRow` carries the reason. */}
        <CardPlateRow>
          {/* `size="md"`: the trade is the card's subject and the league is
              where it happened, where on a manager card the league is the
              subject outright. */}
          <LeaguePlate
            size="md"
            name={league?.name ?? trade.league_id}
            avatarUrl={league?.avatar_url}
          />
          <ReadingPlate>
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] tabular-nums text-foreground/60">
              <TradeDate at={trade.completed_at} />
            </span>
          </ReadingPlate>
        </CardPlateRow>

        <div className="grid gap-4 sm:grid-cols-2">
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
 * When the trade went through, to the minute.
 *
 * **The minute is the point of it.** The plate used to read `Aug 28, 2026 · Wk
 * 0`, and a scoring week is a coarse, offseason-shaped answer to a question a
 * reader of a *newest-first* board is actually asking: where in today's run of
 * trades does this one sit. `completed_at` is already epoch ms on the payload,
 * so this is a formatting change and nothing more.
 *
 * **An undated trade says so in words rather than drawing an empty plate.**
 * Sleeper files a few with neither timestamp, and they sort to the bottom of
 * the board by the same rule; a blank where every other card carries a date
 * reads as a rendering fault.
 */
function TradeDate({ at }: { at: number | null }) {
  if (at === null) return <>Undated</>;
  const date = new Date(at);
  return (
    <>
      {/* **The year comes off the plate below `sm`**, which a render at 390
          forced: the plate is ~172px of a 322px row there, and the league name
          opposite truncates to five characters. The board answers one season by
          construction, so the year is the most redundant token on the plate —
          drawn as two spans and switched by the cascade rather than by state,
          which keeps this component free of a breakpoint it would have to
          hydrate to learn. */}
      <span className="sm:hidden">
        {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
      <span className="hidden sm:inline">
        {date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      {" · "}
      {/* The two halves are formatted separately and joined on the console's
          own separator rather than taken from one `toLocaleString`, which
          glues them with a second comma — `Aug 28, 2026, 9:42 PM` reads as a
          three-part list where the plate is saying two things. */}
      {date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}
    </>
  );
}

/** One roster's half: who they are, what it is worth, what came in and out. */
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
    <section className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.6875rem] px-[15px] pb-[15px] pt-3.5`}>
      <Scanlines />

      <header className="relative mb-[13px] flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 truncate font-mono text-xs uppercase tracking-[0.12em] text-readout">
          {/* Sleeper lets a display name go missing and leaves orphan rosters
              with no owner at all, so the roster number is the fallback — a
              real label, not a placeholder. */}
          {manager?.display_name ?? `Roster ${side.roster_id}`}
        </span>
        {/* What the haul is worth, or `—` where nothing in it could be priced.
            Never `0` — see `asset-value` for why that would be a claim. */}
        <span className="ml-auto shrink-0 font-mono text-lg tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
          {formatAssetValue(bundleValue(received, NO_ASSET_VALUES))}
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
        <>
          <span
            aria-hidden
            className="relative my-3 block h-px bg-gradient-to-r from-active/30 to-active/[0.04]"
          />
          <AssetTrack
            direction="out"
            bundle={given}
            trade={trade}
            side={side}
            data={data}
          />
        </>
      )}
    </section>
  );
}

/**
 * One direction's lines: a sign, the asset, and what it is worth.
 *
 * The give track is drawn whole in `--readout-muted` and the take track is not,
 * which is how a card that says everything twice still reads take-first. **The
 * give track carries no notes** — no position, no team, no pick origin — for
 * the same reason: the take track opposite already carries them, and a second
 * copy is the noise that would make the two halves compete.
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
  const row = `grid grid-cols-[11px_minmax(0,1fr)_auto] items-baseline gap-2 text-[0.8125rem] ${
    inbound ? "text-readout-line" : "text-readout-muted"
  }`;
  const signTone = inbound ? "text-active" : "text-readout-muted";
  const valueTone = inbound
    ? "text-readout [text-shadow:0_0_9px_var(--accent-glow)]"
    : "text-readout-muted";
  const sign = inbound ? "+" : "−";

  if (isEmptyBundle(bundle)) {
    // A real case in a three-way: a roster can send a player one way and take
    // nothing back from that participant. Saying "nothing" is the answer; an
    // absent track would read as a card that failed to draw.
    return (
      <p className="relative m-0 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout-label">
        {inbound ? "Received nothing" : "Gave nothing"}
      </p>
    );
  }

  return (
    <ul className="relative m-0 flex list-none flex-col gap-1.5 p-0">
      {bundle.players.map((id) => {
        const player = data.players[id];
        return (
          <li key={`p${id}`} className={row}>
            <span aria-hidden className={`font-mono ${signTone}`}>
              {sign}
            </span>
            <span className="truncate">
              {/* The id is the fallback rather than a blank: it is a visible,
                  searchable token when the stored players map is behind
                  Sleeper's. */}
              {player?.name ?? id}
              {inbound && player?.position && (
                <span className="ml-[7px] font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout-label">
                  {player.position}
                  {player.team ? ` · ${player.team}` : ""}
                </span>
              )}
            </span>
            <span className={`font-mono text-[0.78125rem] tabular-nums ${valueTone}`}>
              {formatAssetValue(assetValue(id, NO_ASSET_VALUES))}
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
            className={row}
          >
            <span aria-hidden className={`font-mono ${signTone}`}>
              {sign}
            </span>
            <span className="truncate">
              {pickLabel(pick, slot)}
              {inbound && origin !== null && (
                <span className="ml-[7px] font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout-label">
                  {/* Named as a *person*: "from" points at who traded it away,
                      where the side header prefers whatever the manager is
                      called. A roster with no stored owner keeps its number. */}
                  from {from?.display_name ?? `Roster ${pick.roster_id}`}
                </span>
              )}
            </span>
            <span className={`font-mono text-[0.78125rem] tabular-nums ${valueTone}`}>
              {formatAssetValue(assetValue(pick, NO_ASSET_VALUES))}
            </span>
          </li>
        );
      })}

      {bundle.faab > 0 && (
        <li className={row}>
          <span aria-hidden className={`font-mono ${signTone}`}>
            {sign}
          </span>
          {/* In the league's own units, which Sleeper does not name — so the
              figure carries the label rather than a currency symbol. */}
          <span className="truncate">{bundle.faab} FAAB</span>
          {/* A dash rather than a number, permanently: FAAB is a league's own
              currency and no market prices it. */}
          <span className={`font-mono text-[0.78125rem] tabular-nums ${valueTone}`}>
            {formatAssetValue(null)}
          </span>
        </li>
      )}
    </ul>
  );
}

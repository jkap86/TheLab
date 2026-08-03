"use client";

import { memo } from "react";
import {
  Avatar,
  LIST_ROW_HOVER,
  LIST_ROW_SURFACE,
  MONTH_ABBREVIATIONS,
  RowSheen,
} from "@/features/shared";
// The pure module directly, never the `@/shared/ktc` barrel: this is a client
// component, and the barrel re-exports the `pg`-backed queries beside it.
import { isSuperflexLineup } from "@/shared/ktc/roster";
// Same rule, and the same key the route wrote the slots under — one definition
// read from both ends of the wire.
import { pickSlotKey } from "@/shared/trades/pick-slots";
import type { ManagerLeague } from "@/shared/manager";

import { counterpartyRoster, isEmptyBundle, receivedBundle } from "../exchange";
import { pickLabel, pickOriginRoster } from "../pick-display";
import { bundleAssets } from "../trade-metrics";
import type {
  TradeAsset,
  TradeAssetCell,
  TradeMetric,
  TradeSideContext,
} from "../trade-metrics";
import type {
  KtcValue,
  PlayerSummary,
  Trade,
  TradeManager,
  TradePickAsset,
  TradeSide,
} from "../types";
import { TradeValueTag } from "./trade-value";

/**
 * One trade: which league it happened in, when, and what each side came away
 * with.
 *
 * **A side lists what it received, at every width — the card used to draw a
 * give-and-take table below `sm` and no longer does.** The narrow layout paired
 * each manager's take with what they sent, on the reasoning that a stack loses
 * what columns are for. What it actually produced on a two-sided trade — which
 * is nearly all of them — was every asset printed twice: once as a `+` on the
 * side that took it and once as a `−` on the side that sent it. That is the
 * densest thing on the card and it carries no information, since the second
 * listing is a rearrangement of the first, and it is what left a phone-width
 * card with four columns of names to read. Dropping it is what makes room for
 * the per-asset values, which are new information rather than a re-listing.
 *
 * So there is one layout: a block per manager, headed by who they are and what
 * their haul is worth, listing what they received with a value against each
 * line. The blocks are columns from `sm` up and stack below it, which is the
 * only thing that changes with width.
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  players,
  managers,
  metric,
  ktc,
  pickSlots,
}: {
  trade: Trade;
  /** Null where the league list hasn't answered yet; the id stands in. */
  league: ManagerLeague | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  /** The value column every side wears, chosen once for the whole list. */
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  /** Draft slots for the picks whose league has set an order — see `../pick-display`. */
  pickSlots: Record<string, number>;
}) {
  // Which KTC board this trade reads, from the league's own lineup — the stream
  // spans every crawled league, and the two boards move in opposite directions
  // at quarterback. An unsynced lineup falls to 1QB, which is what
  // `isSuperflexLineup` answers for an unknown one.
  const superflex = isSuperflexLineup(league?.roster_positions ?? null);

  return (
    // The same lit surface a league or a share row wears: a trade *is* a row in a
    // long list, and the three lists reading as one material is the point of
    // sharing it. The side columns keep their own opaque ground below.
    <article className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER} overflow-hidden`}>
      <RowSheen />

      {/* `pl-5` on this and on every side below: the card's leading edge carries
          the cyan rail, and content flush against it reads as touching. */}
      <header className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/10 py-3 pl-5 pr-4">
        <h3 className="min-w-0 truncate font-display text-[13px] font-semibold tracking-tight">
          {league?.name ?? trade.league_id}
        </h3>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground/45">
          {formatTradeDate(trade.completed_at)}
          {formatTradeTime(trade.completed_at)}
        </span>
      </header>

      <div className="relative grid gap-px bg-foreground/10 sm:grid-cols-2">
        {trade.sides.map((side, i) => (
          <SideColumn
            key={side.roster_id}
            side={side}
            // The odd side of a three-way takes the whole row rather than
            // leaving the cell beside it empty: an empty cell in a grid of
            // sides reads as a participant who came away with nothing, which
            // is a real state this card draws in words.
            wide={trade.sides.length % 2 === 1 && i === trade.sides.length - 1}
            trade={trade}
            players={players}
            managers={managers}
            metric={metric}
            ktc={ktc}
            superflex={superflex}
            pickSlots={pickSlots}
          />
        ))}
      </div>
    </article>
  );
});

/**
 * One manager's half of the trade: who they are, what the haul is worth, and the
 * lines it is made of.
 *
 * **Per-asset values are drawn only where there is more than one line to break
 * down.** A side that took a single player would otherwise print that player's
 * price against his name and the identical number as the side total a line
 * above — the same figure twice, on the most common trade there is. A breakdown
 * of one *is* the total, so the column appears exactly when it says something
 * the total doesn't. Counted over the lines the metric actually covers rather
 * than over the assets, since a player-and-a-pick haul is one priced line as far
 * as KTC is concerned.
 */
function SideColumn({
  side,
  trade,
  players,
  managers,
  metric,
  ktc,
  superflex,
  pickSlots,
  wide,
}: {
  side: TradeSide;
  trade: Trade;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  superflex: boolean;
  pickSlots: Record<string, number>;
  /** Whether this side takes the whole row — see the grid at the call site. */
  wide: boolean;
}) {
  const manager = side.user_id ? managers[side.user_id] : undefined;
  const name = manager?.display_name || `Roster ${side.roster_id}`;
  const received = receivedBundle(side);
  const ctx: TradeSideContext = { received, ktc, superflex };

  const assets = bundleAssets(received);
  // Who handed this side its haul, resolved once for the side rather than per
  // pick line — it is the same answer for every asset a side received.
  const giver = counterpartyRoster(trade, side);
  const read = metric.asset;
  const cells = read ? assets.map((asset) => read(ctx, asset)) : [];
  const showValues = cells.filter((cell) => cell !== null).length > 1;

  return (
    // Translucent rather than a flat panel, so the card's own glass reads through
    // it — the hairline between two sides is the grid's `gap-px` showing where
    // the cells don't reach, which a translucent cell still leaves.
    <div
      className={`bg-foreground/[0.02] py-3.5 pl-5 pr-4 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      {/* No "Receives" eyebrow: at half a card's width it spent ~70px of the
          manager's line restating what every `+` under it already says, and the
          name is what was giving way for it. */}
      <div className="mb-2.5 flex items-center gap-2">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
        {/* Flush right, which is the same edge the per-line values below sit on —
            so the column reads as the lines summing to the figure above them. */}
        <span className="ml-auto shrink-0 pl-2">
          <TradeValueTag metric={metric} ctx={ctx} />
        </span>
      </div>

      {isEmptyBundle(received) ? (
        // A side of a three-way can take nothing from the others; saying so is
        // clearer than a blank block that reads as a rendering gap.
        <p className="text-[13px] text-foreground/40">Nothing</p>
      ) : (
        <ul className="flex flex-col gap-y-1.5">
          {assets.map((asset, i) => (
            <AssetRow
              key={assetKey(asset, i)}
              asset={asset}
              leagueId={trade.league_id}
              giver={giver}
              players={players}
              managers={managers}
              pickSlots={pickSlots}
              cell={showValues ? (cells[i] ?? null) : null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One line of a haul: what it is on the left, what the chosen metric makes of it
 * on the right.
 *
 * A two-track grid rather than a flex row, so every value in a side lands on the
 * same x whatever the names beside them do — the structure a column of numbers
 * is worth having at all. The name track is `minmax(0,1fr)` so a long name wraps
 * inside it rather than pushing the value off the card: assets wrap rather than
 * truncate here, because a truncated "Christian McCa…" is a card that has to be
 * opened somewhere else to read.
 */
function AssetRow({
  asset,
  leagueId,
  giver,
  players,
  managers,
  pickSlots,
  cell,
}: {
  asset: TradeAsset;
  /** Whose draft order a pick on this line is looked up in. */
  leagueId: string;
  /** The roster that handed this side its haul; null in a three-way. */
  giver: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
  /** Null where the metric doesn't cover this line, or where the side has one. */
  cell: TradeAssetCell | null;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 leading-snug">
      <span className="min-w-0 break-words text-[13px] text-foreground/85 sm:text-sm">
        <AssetLabel
          asset={asset}
          leagueId={leagueId}
          giver={giver}
          players={players}
          managers={managers}
          pickSlots={pickSlots}
        />
      </span>
      {cell && (
        <span
          title={cell.title}
          className="shrink-0 text-xs font-medium tabular-nums text-foreground/60"
        >
          {/* The em dash the whole catalogue rests on: covered by this metric and
              not priced is not the same as worth nothing. */}
          {cell.text ?? <span className="text-foreground/25">—</span>}
        </span>
      )}
    </li>
  );
}

/**
 * What one asset is called.
 *
 * The `+` marks the line as something this manager came away with. It is the
 * only direction mark left on the card — with the give column gone every line is
 * a `+`, so it earns its place as the bullet that starts each row rather than as
 * a sign in opposition to a `−`, and it is a real plus at a hair over its own
 * width so names start at one x.
 */
function AssetLabel({
  asset,
  leagueId,
  giver,
  players,
  managers,
  pickSlots,
}: {
  asset: TradeAsset;
  leagueId: string;
  giver: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
}) {
  if (asset.kind === "player") {
    const player = players[asset.id];
    const meta = [player?.position, player?.team].filter(Boolean).join(" · ");
    return (
      <>
        <Bullet />
        {player?.name ?? asset.id}
        {meta && (
          <span className="ml-1.5 whitespace-nowrap text-[11px] text-foreground/45">
            {meta}
          </span>
        )}
      </>
    );
  }

  if (asset.kind === "pick") {
    const { pick } = asset;
    const slot =
      pickSlots[pickSlotKey(leagueId, pick.season, pick.roster_id)] ?? null;
    // Whose pick it originally is, drawn only where that isn't the roster
    // handing it over — see `../pick-display` for the rule and Sleeper's.
    const origin = pickOriginRoster(pick, giver);
    return (
      <>
        <Bullet />
        {pickLabel(pick, slot)}
        {origin !== null && (
          <span className="ml-1.5 text-[11px] text-foreground/45">
            from {pickOwnerLabel(pick, managers)}
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <Bullet />${asset.amount.toLocaleString()} FAAB
    </>
  );
}

/** See {@link AssetLabel} — the line's leading mark, dimmer than what it marks. */
function Bullet() {
  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-block w-[0.7em] tabular-nums text-foreground/40"
    >
      +
    </span>
  );
}

/**
 * React's key for one line. The index is in it because a haul can hold the same
 * asset twice — two 2027 firsts from different rosters share a season and a
 * round, and a three-way can move two of them — so nothing about an asset is
 * unique within a side.
 */
function assetKey(asset: TradeAsset, index: number): string {
  if (asset.kind === "player") return `p${index}-${asset.id}`;
  if (asset.kind === "pick") {
    return `d${index}-${asset.pick.season}-${asset.pick.round}-${asset.pick.roster_id}`;
  }
  return `f${index}`;
}

/**
 * Whose pick this originally is, as a person.
 *
 * The owner rides on the pick rather than being looked up among the sides,
 * because the pick worth naming an owner for is usually one that came from a
 * roster that *isn't* in this trade — see {@link TradePickAsset.user_id}. The
 * roster number stays the fallback for a team whose owner isn't cached.
 */
function pickOwnerLabel(
  pick: TradePickAsset,
  managers: Record<string, TradeManager>,
): string {
  const name = pick.user_id ? managers[pick.user_id]?.display_name : null;
  return name || `roster ${pick.roster_id}`;
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

/**
 * The time of day the trade went through, e.g. ` · 3:07 PM`, or nothing at all
 * where Sleeper filed no timestamp.
 *
 * It holds the slot the scoring week used to. A week is a coarser reading of the
 * same instant the date beside it already gives — "Aug 1, 2026 · Wk 1" says
 * twice when, and says it in a unit that means nothing for most of the calendar,
 * since Sleeper files an offseason trade under no week at all. The clock time is
 * what the date was missing: trades come in flurries, and which of this
 * afternoon's five deals landed first is a question the card couldn't answer.
 *
 * Read in the **reader's own zone**, unlike the season-shaped dates elsewhere in
 * the app: `TODAY_ET` is Eastern because it decides what the NFL has played,
 * where this is a wall-clock reading of a moment for whoever is looking at it.
 * It is still spelled out by hand rather than through `toLocaleTimeString`, so
 * the punctuation matches the date it follows in every locale.
 */
function formatTradeTime(at: number | null): string {
  if (at === null) return "";
  const d = new Date(at);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return ` · ${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

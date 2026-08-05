"use client";

import { memo } from "react";
import { Avatar, MONTH_ABBREVIATIONS } from "@/features/shared";
// The pure module directly, never the `@/shared/ktc` barrel: this is a client
// component, and the barrel re-exports the `pg`-backed queries beside it.
import { isSuperflexLineup } from "@/shared/ktc/roster";
// Same rule, and the same key the route wrote the slots under — one definition
// read from both ends of the wire.
import { pickSlotKey } from "@/shared/trades/pick-slots";
import type { ManagerLeague } from "@/shared/manager";

import {
  counterpartyRoster,
  givenBundle,
  isEmptyBundle,
  receivedBundle,
} from "../exchange";
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
 * with — beside what it handed over.
 *
 * **The card is machined rather than glass, and that is a deliberate break from
 * the other two lists.** League cards and share cards wear `LIST_ROW_SURFACE`,
 * and the point of sharing it is that three lists read as one material; this one
 * wears `.lab-slab` instead — the app bar's corner-lit block at card scale, with
 * a wall running down *and* right, a chamfered leading and trailing corner, a
 * brushed face and a static specular sweep. What buys the divergence is that a
 * trade card is not a row that opens into something: it is the whole of what it
 * has to say, four columns deep, and the depth is what sorts those columns into
 * an order. The cyan rail, the hover lift and the bloom all survive, so the card
 * still answers the pointer the way its neighbours do.
 *
 * **A side lists what it received *and* what it gave.** The give half was
 * dropped once, for a narrow layout that printed every asset twice — once as a
 * `+` on the side that took it and once as a `−` on the side that sent it — and
 * the redundancy is real and unchanged. What changed is what it buys: a manager's
 * block can now be read on its own, which is how a card in a windowed list of
 * forty thousand is actually read, rather than by finding the counterparty's
 * column and inverting it. It is paid for in *material* rather than in height —
 * the gives sit in a groove milled into the side plate, dimmer and a step
 * smaller, so the card still reads take-first — and it is drawn only where it is
 * honest, which is a two-sided trade (see `../exchange`).
 */
export const TradeCard = memo(function TradeCard({
  trade,
  league,
  players,
  managers,
  metric,
  ktc,
  pickKtc,
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
  /**
   * KTC's rookie-pick rows for the picks on this page, keyed by season, round
   * and tier. Which row a pick reads is resolved from `pickSlots` below plus the
   * league's own size — see `../trade-metrics`.
   */
  pickKtc: Record<string, KtcValue>;
  /** Draft slots for the picks whose league has set an order — see `../pick-display`. */
  pickSlots: Record<string, number>;
}) {
  // Which KTC board this trade reads, from the league's own lineup — the stream
  // spans every crawled league, and the two boards move in opposite directions
  // at quarterback. An unsynced lineup falls to 1QB, which is what
  // `isSuperflexLineup` answers for an unknown one.
  const superflex = isSuperflexLineup(league?.roster_positions ?? null);

  return (
    // The wall, and the face standing on it. Both carry the chamfer: a wall that
    // turns two corners shows a square one wherever the clip doesn't follow it.
    <div className="lab-slab lab-notch-lg">
      <article className="lab-slab-face lab-notch-lg p-2.5 sm:p-3">
        {/* The card's leading edge carries the accent rail — the same mark the
            pinned manager plate wears, so a trade card and the header above it
            are visibly the same material. It is a flex item rather than an
            absolute box, since the chamfer is what a leading edge has instead of
            a corner and the rail has to sit clear of it. */}
        <header className="flex items-center gap-2.5 px-1 pb-2.5">
          <span
            aria-hidden="true"
            className="lab-billet-rail h-4 w-0.5 shrink-0 rounded-sm"
          />
          {/* `h2`: the page's own title is a visually-hidden `h1` (the ledge is
              what leads it on screen), so a card is the next level down and a 3
              here skipped one. */}
          <h2 className="min-w-0 truncate font-display text-[13px] font-bold uppercase tracking-[0.13em] text-foreground/85 [text-shadow:0_1px_0_rgba(255,255,255,0.12),0_-1px_1px_rgba(0,0,0,0.9)]">
            {league?.name ?? trade.league_id}
          </h2>
          <span className="lab-readout ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums text-foreground/60">
            {formatTradeDate(trade.completed_at)}
            {formatTradeTime(trade.completed_at)}
          </span>
        </header>

        {/* Gaps rather than the old `gap-px` hairline: the sides are seated
            plates now, so what separates them is the ground showing between two
            objects and there is no rule to draw. */}
        <div className="grid gap-2 sm:grid-cols-2">
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
              pickKtc={pickKtc}
              superflex={superflex}
              pickSlots={pickSlots}
              teams={league?.total_rosters ?? null}
            />
          ))}
        </div>
      </article>
    </div>
  );
});

/**
 * One manager's half of the trade: who they are, what the haul is worth, what
 * they took and what they sent.
 *
 * **Per-asset values are drawn only where there is more than one line to break
 * down**, and each track answers that question for itself. A side that took a
 * single player would otherwise print that player's price against his name and
 * the identical number as the side total a line above — the same figure twice,
 * on the most common trade there is. A breakdown of one *is* the total, so the
 * column appears exactly when it says something the total doesn't. Counted over
 * the lines the metric actually covers rather than over the assets, since a
 * player-and-a-pick haul is one priced line as far as KTC is concerned.
 *
 * The give track carries values on the same terms, and they are worth their
 * width for the reason the track is: they say which piece of what left carried
 * the weight, without making the reader find the other column and add it up.
 */
function SideColumn({
  side,
  trade,
  players,
  managers,
  metric,
  ktc,
  pickKtc,
  superflex,
  pickSlots,
  teams,
  wide,
}: {
  side: TradeSide;
  trade: Trade;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  pickKtc: Record<string, KtcValue>;
  superflex: boolean;
  pickSlots: Record<string, number>;
  /**
   * How many teams draft in this league — what turns a pick's slot into the
   * third of the round KTC prices. Null where the league list hasn't answered,
   * which prices the pick without placing it.
   */
  teams: number | null;
  /** Whether this side takes the whole row — see the grid at the call site. */
  wide: boolean;
}) {
  const manager = side.user_id ? managers[side.user_id] : undefined;
  const name = manager?.display_name || `Roster ${side.roster_id}`;
  const received = receivedBundle(side);
  const ctx: TradeSideContext = {
    received,
    ktc,
    pickKtc,
    superflex,
    leagueId: trade.league_id,
    pickSlots,
    teams,
  };

  // Who handed this side its haul, resolved once for the side rather than per
  // pick line — it is the same answer for every asset a side received.
  const giver = counterpartyRoster(trade, side);
  // Null in a three-way, where nothing Sleeper stores says which participant an
  // asset came through; empty where a two-sided counterparty took nothing.
  const given = givenBundle(trade, side);
  const showGiven = given !== null && !isEmptyBundle(given);

  return (
    // Seated in the card's own face, which is why it wears both the thinner wall
    // and the lifted fill: a part seated in another has to catch more light than
    // what it is seated in, or the two read as one surface with a seam.
    <div
      className={`lab-plate-sm lab-plate-brushed rounded-lg px-2.5 py-2.5 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      {/* No "Receives" eyebrow: at half a card's width it spent ~70px of the
          manager's line restating what every `+` under it already says, and the
          name is what was giving way for it. The parting line under the row is a
          milled one — a dark cut with a lit far lip — rather than a border. */}
      <div className="mb-2 flex items-center gap-2 pb-2 shadow-[0_1px_0_rgba(0,0,0,0.6),0_2px_0_rgba(255,255,255,0.06)]">
        <Avatar url={manager?.avatar_url} name={name} />
        <span className="min-w-0 truncate text-[13px] font-bold">{name}</span>
        {/* Under glass, and flush right — the same edge the per-line values
            below sit on, so the column reads as the lines summing to the figure
            above them. */}
        <span className="lab-readout lab-lens ml-auto shrink-0 rounded px-2 py-0.5">
          <TradeValueTag metric={metric} ctx={ctx} />
        </span>
      </div>

      {isEmptyBundle(received) && !showGiven ? (
        // A side of a three-way can take nothing from the others; saying so is
        // clearer than a blank block that reads as a rendering gap.
        <p className="text-[13px] text-foreground/40">Nothing</p>
      ) : (
        // Two tracks side by side from `sm` up and stacked below it, which is
        // the same thing that happens to the sides themselves one level out —
        // and for the same reason. What breaks down at 390px is geometry, not
        // the idea: a track is ~120px there, and a column that narrow turns
        // every name into two lines. The give track takes the smaller share of
        // the pair, because its lines carry no position and team.
        <div
          className={`grid gap-x-2 gap-y-2 ${
            showGiven ? "sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" : ""
          }`}
        >
          <AssetTrack
            bundle={received}
            tone="in"
            trade={trade}
            ctx={ctx}
            metric={metric}
            giver={giver}
            players={players}
            managers={managers}
            pickSlots={pickSlots}
          />
          {showGiven && (
            <AssetTrack
              bundle={given}
              tone="out"
              trade={trade}
              ctx={ctx}
              metric={metric}
              // A pick this side is handing over needs no "from" line when it
              // was this side's own — the same rule as the take half, with the
              // roster on the other end of it.
              giver={side.roster_id}
              players={players}
              managers={managers}
              pickSlots={pickSlots}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One track of a side: everything that moved in one direction, with the metric's
 * reading of each line.
 *
 * The two tracks are the same component because they are the same list of the
 * same kind of thing — what separates them is the surface they sit on and the
 * sign that starts each line, which is exactly the amount of difference there
 * is. The give track is a groove milled into the plate; the take track sits on
 * the plate's own face.
 */
function AssetTrack({
  bundle,
  tone,
  trade,
  ctx,
  metric,
  giver,
  players,
  managers,
  pickSlots,
}: {
  bundle: Parameters<typeof bundleAssets>[0];
  tone: "in" | "out";
  trade: Trade;
  /** The side's own context; only the board and the pick lookups are read here. */
  ctx: TradeSideContext;
  metric: TradeMetric;
  giver: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
}) {
  const assets = bundleAssets(bundle);
  const read = metric.asset;
  // The metric reads this track's own haul, so a give line is priced against the
  // bundle it belongs to rather than against the side's take.
  const trackCtx: TradeSideContext = { ...ctx, received: bundle };
  const cells = read ? assets.map((asset) => read(trackCtx, asset)) : [];
  const showValues = cells.filter((cell) => cell !== null).length > 1;

  return (
    <ul
      className={
        tone === "out"
          ? "lab-groove flex min-w-0 flex-col gap-y-1 rounded-md px-1.5 py-1.5"
          : "flex min-w-0 flex-col gap-y-1.5"
      }
    >
      {assets.map((asset, i) => (
        <AssetRow
          key={assetKey(asset, i)}
          asset={asset}
          tone={tone}
          leagueId={trade.league_id}
          giver={giver}
          players={players}
          managers={managers}
          pickSlots={pickSlots}
          cell={showValues ? (cells[i] ?? null) : null}
        />
      ))}
    </ul>
  );
}

/**
 * One line of a haul: what it is on the left, what the chosen metric makes of it
 * on the right.
 *
 * A two-track grid rather than a flex row, so every value in a track lands on the
 * same x whatever the names beside them do — the structure a column of numbers
 * is worth having at all. The name track is `minmax(0,1fr)` so a long name wraps
 * inside it rather than pushing the value off the card: assets wrap rather than
 * truncate here, because a truncated "Christian McCa…" is a card that has to be
 * opened somewhere else to read.
 */
function AssetRow({
  asset,
  tone,
  leagueId,
  giver,
  players,
  managers,
  pickSlots,
  cell,
}: {
  asset: TradeAsset;
  /** Which track this line is in — see {@link AssetTrack}. */
  tone: "in" | "out";
  /** Whose draft order a pick on this line is looked up in. */
  leagueId: string;
  /** The roster on the other end of this line; null in a three-way. */
  giver: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
  /** Null where the metric doesn't cover this line, or where the track has one. */
  cell: TradeAssetCell | null;
}) {
  const out = tone === "out";
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 leading-snug ${
        out ? "text-xs" : "text-[13px]"
      }`}
    >
      <span
        className={`min-w-0 break-words ${
          out
            ? "text-foreground/50 [text-shadow:0_1px_1px_rgba(0,0,0,0.9)]"
            : "text-foreground/85"
        }`}
      >
        <AssetLabel
          asset={asset}
          tone={tone}
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
          className={`shrink-0 text-[11px] font-medium tabular-nums ${
            out ? "text-foreground/30" : "text-foreground/60"
          }`}
        >
          {/* The em dash the whole catalogue rests on: covered by this metric and
              not priced is not the same as worth nothing. */}
          {cell.text ?? (
            <span className={out ? "text-foreground/20" : "text-foreground/25"}>
              —
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * What one asset is called.
 *
 * The sign says which way the line moved, and it is the only direction mark on
 * the card — a real `+` or `−` at a hair over its own width, so names in both
 * tracks start at one x. The two are not equally lit: the take is the thing
 * being read and its sign carries the accent, where the give's is the dimmest
 * mark in the block.
 */
function AssetLabel({
  asset,
  tone,
  leagueId,
  giver,
  players,
  managers,
  pickSlots,
}: {
  asset: TradeAsset;
  tone: "in" | "out";
  leagueId: string;
  giver: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  pickSlots: Record<string, number>;
}) {
  const dim = tone === "out";
  const meta = dim ? "text-foreground/25" : "text-foreground/45";

  if (asset.kind === "player") {
    const player = players[asset.id];
    // **A give line names the player and nothing else.** His position and team
    // are already printed against him on the side that took him — the give
    // column exists on a two-sided trade, so that listing is always there — and
    // in a track this narrow the eight characters were the difference between
    // one line and two. What the origin of a *pick* says is not available
    // anywhere else on the card, so that one stays on both tracks.
    const detail = dim
      ? null
      : [player?.position, player?.team].filter(Boolean).join(" · ");
    return (
      <>
        <Bullet tone={tone} />
        {player?.name ?? asset.id}
        {detail && (
          <span className={`ml-1.5 whitespace-nowrap text-[11px] ${meta}`}>
            {detail}
          </span>
        )}
      </>
    );
  }

  if (asset.kind === "pick") {
    const { pick } = asset;
    const slot =
      pickSlots[pickSlotKey(leagueId, pick.season, pick.roster_id)] ?? null;
    // Whose pick it originally is, drawn only where that isn't the roster on the
    // other end of this line — see `../pick-display` for the rule and Sleeper's.
    const origin = pickOriginRoster(pick, giver);
    return (
      <>
        <Bullet tone={tone} />
        {pickLabel(pick, slot)}
        {origin !== null && (
          <span className={`ml-1.5 text-[11px] ${meta}`}>
            from {pickOwnerLabel(pick, managers)}
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <Bullet tone={tone} />${asset.amount.toLocaleString()} FAAB
    </>
  );
}

/** See {@link AssetLabel} — the line's leading mark, dimmer than what it marks. */
function Bullet({ tone }: { tone: "in" | "out" }) {
  return (
    <span
      aria-hidden="true"
      className={`mr-1 inline-block w-[0.7em] tabular-nums ${
        tone === "out" ? "text-foreground/25" : "text-active/50"
      }`}
    >
      {tone === "out" ? "−" : "+"}
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

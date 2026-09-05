"use client";

import { memo } from "react";

import type {
  KtcBoardChoice,
  ManagerLeague,
  MetricRank,
  Trade,
  TradeSide,
  TradeValueBasis,
} from "@/shared/contract";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { pickSlotKey } from "@/shared/trades/pick-slots";
import {
  CardPlateRow,
  CONSOLE_CARD,
  CONSOLE_WINDOW,
  formatInstantDate,
  formatInstantTime,
  LeagueConfigWindow,
  LeaguePlate,
  rankColor,
  rankFill,
  rankPercentile,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";

import {
  assetPrice,
  bundleValue,
  formatAssetValue,
  TRADE_BASIS_UNITS,
  type ValueLens,
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
  basis,
  board,
}: {
  trade: Trade;
  /** Null before the leagues request lands, or if it failed. */
  league: ManagerLeague | null;
  data: TradesData;
  /** Which of the three bases every figure on the board is on — `ValuePanel`. */
  basis: TradeValueBasis;
  /** The reader's KeepTradeCut market choice — see `useKtcBoard`. */
  board: KtcBoardChoice;
}) {
  // Resolved here rather than on the server, because the payload carries every
  // basis and both markets and only this card knows which league it is — see
  // `asset-value`. A league whose row has not arrived reads as `auto`'s
  // non-dynasty case, which prices nothing wrongly: both markets are on the
  // wire, and the one it lands on is corrected the moment the leagues request
  // answers.
  const lens: ValueLens = {
    basis,
    format: resolveKtcFormat(board, leagueType(league)),
  };
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
            <span className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] tabular-nums text-foreground/60">
              <TradeDate at={trade.completed_at} />
            </span>
          </ReadingPlate>
        </CardPlateRow>

        {/* What game this league is playing, between the plate that names it
            and the hauls it prices. It is the manager card's own window, read
            from the same rules rather than re-derived — see
            `LeagueConfigWindow` — and it is what a value on this board could
            not say on its own: the same two players are a different trade in a
            dynasty superflex league than in a redraft one.

            **Drawn only once the league row has arrived.** Every rule it reads
            treats an absent blob as its own default — an absent `type` is
            redraft, an absent `best_ball` is managed — which is right for a
            league that answered and said nothing, and a claim for one that has
            not answered yet. The card would state "Redraft · Managed" over a
            dynasty league for as long as `/api/trades/leagues` took, then
            silently correct itself. Nothing is the honest reading, and it is
            the same beat the league's name spends showing its id. */}
        {league && <LeagueConfigWindow league={league} className="mb-4" />}

        <div className="grid gap-4 sm:grid-cols-2">
          {trade.sides.map((side) => (
            <SideColumn
              lens={lens}
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
  return (
    <>
      {/* **The year comes off the plate below `sm`**, which a render at 390
          forced: the plate is ~172px of a 322px row there, and the league name
          opposite truncates to five characters. The board answers one season by
          construction, so the year is the most redundant token on the plate —
          drawn as two spans and switched by the cascade rather than by state,
          which keeps this component free of a breakpoint it would have to
          hydrate to learn. */}
      <span className="sm:hidden">{formatInstantDate(at, { year: false })}</span>
      <span className="hidden sm:inline">{formatInstantDate(at)}</span>
      {" · "}
      {/* The two halves are formatted separately and joined on the console's
          own separator rather than taken from one `toLocaleString`, which
          glues them with a second comma — `Aug 28, 2026, 9:42 PM` reads as a
          three-part list where the plate is saying two things. */}
      {formatInstantTime(at)}
    </>
  );
}

/** One roster's half: who they are, what it is worth, what came in and out. */
function SideColumn({
  trade,
  side,
  data,
  lens,
}: {
  trade: Trade;
  side: TradeSide;
  data: TradesData;
  lens: ValueLens;
}) {
  const manager = side.user_id ? data.managers[side.user_id] : undefined;
  const received = receivedBundle(side);
  const given = givenBundle(trade, side);

  return (
    <section className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.6875rem] px-[15px] pb-[15px] pt-3.5`}>
      <Scanlines />

      <header className="relative mb-[13px] flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 truncate font-mono text-[length:var(--fs-12)] uppercase tracking-[0.12em] text-readout">
          {/* Sleeper lets a display name go missing and leaves orphan rosters
              with no owner at all, so the roster number is the fallback — a
              real label, not a placeholder. */}
          {manager?.display_name ?? `Roster ${side.roster_id}`}
        </span>
        {/* The unit, because the three bases are three scales and a figure
            that changed when the reader flipped the panel would otherwise be
            indistinguishable from one that moved. It is the same rule the
            manager card's lens keys live by — three figures on three scales
            never share a column without one. */}
        <span className="ml-auto shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label">
          {TRADE_BASIS_UNITS[lens.basis]}
        </span>
        {/* What the haul is worth, or `—` where nothing in it could be priced.
            Never `0` — see `asset-value` for why that would be a claim.

            **Never coloured**, whatever the assets under it are doing. The
            colour on this card is a statement about one asset's standing among
            its league's; a coloured total would be a statement about who won
            the trade, which this card rules out by name above. */}
        <span className="shrink-0 font-mono text-[length:var(--fs-18)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
          {formatAssetValue(
            bundleValue(trade.league_id, received, data.assetValues, lens),
          )}
        </span>
      </header>

      <AssetTrack
        direction="in"
        bundle={received}
        trade={trade}
        side={side}
        data={data}
        lens={lens}
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
            lens={lens}
          />
        </>
      )}
    </section>
  );
}

/**
 * One direction's lines: a sign, the asset, what it is worth, and — on the take
 * track alone — where that figure stands in its own league.
 *
 * The give track is drawn whole in `--readout-muted` and the take track is not,
 * which is how a card that says everything twice still reads take-first. **The
 * give track carries no notes** — no position, no team, no pick origin — for
 * the same reason: the take track opposite already carries them, and a second
 * copy is the noise that would make the two halves compete.
 *
 * **The colour and the meter land on the take track only**, and that is the
 * same rule one step on rather than a new one. A give line is the other side's
 * take line; colouring both would draw every asset on a two-sided card twice,
 * in two places, in the same hue — and the card would stop reading take-first,
 * which is the one thing its redundancy is paid for by.
 */
function AssetTrack({
  direction,
  bundle,
  trade,
  side,
  data,
  lens,
}: {
  direction: "in" | "out";
  bundle: TradeBundle;
  trade: Trade;
  side: TradeSide;
  data: TradesData;
  lens: ValueLens;
}) {
  const inbound = direction === "in";
  // Two rows per line on the take track: the line itself, and a meter under the
  // figure. `items-baseline` on a two-row grid would align the meter to the
  // text baseline of a row it is not on, so the alignment moves onto the cells
  // that need it.
  const row = `grid grid-cols-[11px_minmax(0,1fr)_auto] gap-x-2 gap-y-[5px] text-[length:var(--fs-13)] ${
    inbound ? "text-readout-line" : "text-readout-muted"
  }`;
  const signTone = inbound ? "text-active" : "text-readout-muted";
  const sign = inbound ? "+" : "−";

  if (isEmptyBundle(bundle)) {
    // A real case in a three-way: a roster can send a player one way and take
    // nothing back from that participant. Saying "nothing" is the answer; an
    // absent track would read as a card that failed to draw.
    return (
      <p className="relative m-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
        {inbound ? "Received nothing" : "Gave nothing"}
      </p>
    );
  }

  return (
    <ul className="relative m-0 flex list-none flex-col gap-[9px] p-0">
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
                <span className="ml-[7px] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
                  {player.position}
                  {player.team ? ` · ${player.team}` : ""}
                </span>
              )}
            </span>
            <AssetFigure
              price={assetPrice(trade.league_id, id, data.assetValues, lens)}
              lit={inbound}
            />
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
                <span className="ml-[7px] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
                  {/* Named as a *person*: "from" points at who traded it away,
                      where the side header prefers whatever the manager is
                      called. A roster with no stored owner keeps its number. */}
                  from {from?.display_name ?? `Roster ${pick.roster_id}`}
                </span>
              )}
            </span>
            <AssetFigure
              price={assetPrice(trade.league_id, pick, data.assetValues, lens)}
              lit={inbound}
            />
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
          {/* A dash rather than a number, permanently and on every basis: FAAB
              is a league's own currency, and neither a market, a draft board
              nor a projection prices one. */}
          <AssetFigure price={null} lit={inbound} />
        </li>
      )}
    </ul>
  );
}

/**
 * One asset's figure, and — where it has a place in its league — the ramp
 * colour and the meter that say where.
 *
 * **The colour is `rankColor` and the width is `rankFill`, both off the one
 * rank the payload shipped.** That is the whole reason the server sends a
 * `{rank, of}` rather than a percentile: these are the same two functions the
 * manager card's rank tiles are drawn from, so a bar and a hue on this board
 * cannot disagree with each other, and neither can disagree with the same
 * asset's tile one page over.
 *
 * **`rankPercentile` and not `rankFill` for the hue**, which is the trap that
 * module exists to mark: `rankFill` answers 0 to two different questions — last
 * in the league, and nothing to rank — and the meter is right to draw both
 * empty where the ramp is not. An absent place painted full red would claim a
 * result nobody finished.
 *
 * A give line is drawn muted and gets neither, which is `AssetTrack`'s rule.
 * An unpriced asset is an em dash with no track under it at all: a meter under
 * a dash would be a zero-width bar, and a zero-width bar is exactly the reading
 * "worst in the league" that the dash is there to avoid making.
 */
function AssetFigure({
  price,
  lit,
}: {
  price: { value: number; rank: MetricRank | null } | null;
  /** The take track. A give line carries the figure and nothing else. */
  lit: boolean;
}) {
  const rank = lit ? (price?.rank ?? null) : null;
  const percentile = rankPercentile(rank);
  const colour = rankColor(percentile);

  return (
    <>
      <span
        className="font-mono text-[length:var(--fs-12-5)] tabular-nums"
        style={
          lit && percentile !== null
            ? { color: colour, textShadow: `0 0 10px ${rankColor(percentile, 0.55)}` }
            : undefined
        }
      >
        <span
          className={
            lit && percentile !== null
              ? ""
              : lit
                ? "text-readout [text-shadow:0_0_9px_var(--accent-glow)]"
                : "text-readout-muted"
          }
        >
          {formatAssetValue(price?.value ?? null)}
        </span>
      </span>
      {rank !== null && (
        // The meter spans the name and figure columns rather than sitting under
        // the figure alone: at a phone's width a figure column is four
        // characters wide, and a bar that narrow reads as a tick rather than as
        // a scale. Capped so it stays a meter on a wide card instead of
        // becoming a rule across the window.
        <span
          aria-hidden
          className="col-start-2 col-span-2 h-1 w-full max-w-[9rem] justify-self-end overflow-hidden rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${rankFill(rank)}%`, backgroundColor: colour }}
          />
        </span>
      )}
    </>
  );
}

/**
 * A league's Sleeper `settings.type`, or null where the row has not arrived.
 *
 * Guarded rather than cast: `settings` is the raw blob and every reader of it
 * in this app checks the shape before trusting a value. Null falls to `auto`'s
 * non-dynasty arm, which is the right reading of "we do not know yet" — the
 * redraft board is the conservative one, and the card corrects itself the
 * moment `/api/trades/leagues` answers.
 */
function leagueType(league: ManagerLeague | null): number | null {
  const type = league?.settings?.type;
  return typeof type === "number" ? type : null;
}

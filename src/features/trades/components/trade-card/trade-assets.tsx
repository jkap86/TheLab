// The pure module directly, never the `@/shared/trades` barrel: this is client
// code, and the barrel re-exports the `pg`-backed queries beside it. It is also
// the same key the route wrote the slots under — one definition read from both
// ends of the wire.
import { pickSlotKey } from "@/shared/trades/pick-slots";

import type { TradeBundle } from "../../exchange";
import { pickLabel, pickOriginRoster } from "../../pick-display";
import type {
  TradeAsset,
  TradeAssetCell,
  TradeMetric,
  TradeSideContext,
} from "../../trade-metrics";
import {
  ASSET_BULLET,
  ASSET_NAME,
  ASSET_ROW,
  ASSET_TONES,
  ASSET_VALUE,
  type AssetToneStyle,
} from "./trade-card.constants.ts";
import type { AssetTone, TradeCardLookups } from "./trade-card.types.ts";
import { pickOwnerLabel, trackLines } from "./trade-card.utils.ts";

/**
 * One track of a side: everything that moved in one direction, with the metric's
 * reading of each line.
 *
 * The two tracks are the same component because they are the same list of the
 * same kind of thing — what separates them is the surface they sit on and the
 * sign that starts each line, which is exactly the amount of difference there
 * is. That difference is a row of `ASSET_TONES` rather than a ternary per
 * element, so the give track cannot end up a step brighter than the take track
 * it must never outrank.
 *
 * What order the lines are in, which of them carry a value, and how they are
 * keyed, is all {@link trackLines} — pure, and tested where a loop in a
 * component would not be.
 */
export function AssetTrack({
  bundle,
  tone,
  context,
  metric,
  giver,
  lookups,
}: {
  bundle: TradeBundle;
  tone: AssetTone;
  /** The side's own context; the track re-bases it on its own haul. */
  context: TradeSideContext;
  metric: TradeMetric;
  /** The roster on the other end of these lines; null in a three-way. */
  giver: number | null;
  lookups: TradeCardLookups;
}) {
  const style = ASSET_TONES[tone];

  return (
    <ul className={style.track}>
      {trackLines(metric, context, bundle).map((line) => (
        <AssetRow
          key={line.key}
          asset={line.asset}
          style={style}
          leagueId={context.leagueId}
          giver={giver}
          lookups={lookups}
          cell={line.cell}
        />
      ))}
    </ul>
  );
}

/**
 * One line of a haul: what it is on the left, what the chosen metric makes of it
 * on the right. The grid behind that pairing is `ASSET_ROW`.
 */
function AssetRow({
  asset,
  style,
  leagueId,
  giver,
  lookups,
  cell,
}: {
  asset: TradeAsset;
  /** The material of the track this line is in — see {@link AssetTrack}. */
  style: AssetToneStyle;
  /** Whose draft order a pick on this line is looked up in. */
  leagueId: string;
  giver: number | null;
  lookups: TradeCardLookups;
  /** Null where the metric doesn't cover this line, or where the track has one. */
  cell: TradeAssetCell | null;
}) {
  return (
    <li className={`${ASSET_ROW} ${style.row}`}>
      <span className={`${ASSET_NAME} ${style.name}`}>
        <AssetLabel
          asset={asset}
          style={style}
          leagueId={leagueId}
          giver={giver}
          lookups={lookups}
        />
      </span>
      {cell && <AssetValue cell={cell} style={style} />}
    </li>
  );
}

/** The metric's reading of one line, on the same edge as the side's own total. */
function AssetValue({
  cell,
  style,
}: {
  cell: TradeAssetCell;
  style: AssetToneStyle;
}) {
  return (
    <span title={cell.title} className={`${ASSET_VALUE} ${style.value}`}>
      {/* The em dash the whole catalogue rests on: covered by this metric and
          not priced is not the same as worth nothing. */}
      {cell.text ?? <span className={style.dash}>—</span>}
    </span>
  );
}

/**
 * What one asset is called.
 *
 * The sign says which way the line moved, and it is the only direction mark on
 * the card — a real `+` or `−` at a hair over its own width, so names in both
 * tracks start at one x.
 */
function AssetLabel({
  asset,
  style,
  leagueId,
  giver,
  lookups,
}: {
  asset: TradeAsset;
  style: AssetToneStyle;
  leagueId: string;
  giver: number | null;
  lookups: TradeCardLookups;
}) {
  if (asset.kind === "player") {
    const player = lookups.players[asset.id];
    // Whether this track spells out a position and team at all is the tone's
    // own rule — see `AssetToneStyle.playerDetail`.
    const detail = style.playerDetail
      ? [player?.position, player?.team].filter(Boolean).join(" · ")
      : null;
    return (
      <>
        <Bullet style={style} />
        {player?.name ?? asset.id}
        {detail && (
          <span className={`ml-1.5 whitespace-nowrap text-[0.6875rem] ${style.meta}`}>
            {detail}
          </span>
        )}
      </>
    );
  }

  if (asset.kind === "pick") {
    const { pick } = asset;
    const slot =
      lookups.pickSlots[pickSlotKey(leagueId, pick.season, pick.roster_id)] ??
      null;
    // Whose pick it originally is, drawn only where that isn't the roster on the
    // other end of this line — see `../../pick-display` for the rule and
    // Sleeper's.
    const origin = pickOriginRoster(pick, giver);
    return (
      <>
        <Bullet style={style} />
        {pickLabel(pick, slot)}
        {origin !== null && (
          <span className={`ml-1.5 text-[0.6875rem] ${style.meta}`}>
            from {pickOwnerLabel(pick, lookups.managers)}
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <Bullet style={style} />${asset.amount.toLocaleString()} FAAB
    </>
  );
}

/** See {@link AssetLabel} — the line's leading mark, dimmer than what it marks. */
function Bullet({ style }: { style: AssetToneStyle }) {
  return (
    <span aria-hidden="true" className={`${ASSET_BULLET} ${style.bullet}`}>
      {style.sign}
    </span>
  );
}

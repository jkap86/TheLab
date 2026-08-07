import { ktcPickPrice, pickTier } from "../../shared/ktc/picks.ts";
import type { KtcPickMatch, KtcPickTier } from "../../shared/ktc/picks.ts";
import { ktcBoardValue } from "../../shared/ktc/roster.ts";
import { adpValue } from "../../shared/manager/adp-value.ts";
import { pickSlotKey } from "../../shared/trades/pick-slots.ts";
import { ordinal } from "../shared/format.ts";
import type { Metric } from "../shared/metric-cell.ts";
import type { TradeBundle } from "./exchange.ts";
import { pickAdpValue } from "./pick-value.ts";
import type {
  PickAdpMatch,
  PickAdpMiss,
  PickAdpResult,
  RookieLadderRung,
} from "./pick-value.ts";
import type {
  AdpBoardStats,
  AdpBoardType,
  AdpPlayerPayload,
  KtcValue,
  TradePickAsset,
} from "./types";

/**
 * The metrics a trade card's value column can show, and how to read one off one
 * side of one trade.
 *
 * The fifth grain in the catalogue table, and the first outside the manager tool:
 * a row here is **what one roster came away with**. That is the only grain a
 * trade offers a number at — a trade as a whole has no value worth printing,
 * since the sides are the same assets counted twice, and "the trade is worth
 * 12,000" says nothing a reader arrived to ask. What they did arrive to ask is
 * which side got more, which is one number per side and the same number on each.
 *
 * The card carries **one** slot rather than the cards' four. A trade card is
 * already a table of assets, and four columns of aggregates beside them would be
 * reading the card twice; one column is a summary of the haul the rows spell
 * out.
 *
 * **A metric may also read one asset at a time**, which is the half that makes
 * the total worth trusting: a side total says which haul was bigger and nothing
 * about which piece of it carried the weight, and "three players for a first" is
 * a different trade depending on whether the three are 8,000 apiece or 800.
 * {@link TradeMetric.asset} is that reading, and it is optional because most of
 * this catalogue has no per-asset form — a count of players is 1 on every line,
 * which is a column of ones.
 *
 * Pure and free of runtime imports beyond {@link ktcBoardValue} and
 * {@link adpValue} — both arriving relatively with an explicit `.ts` extension,
 * the way the league filters reach the same files — so the numbers are tested
 * without a fetch behind them, the bar its four sibling catalogues hold.
 */

/** What a trade metric reads from: one side's haul, priced on its league's board. */
export type TradeSideContext = {
  /** What this side received — the only half a stored trade holds. */
  received: TradeBundle;
  /**
   * Player id → both KTC boards, as the stream delivered them. An id KTC doesn't
   * price is absent rather than zero, which is what lets a haul say how much of
   * itself it managed to price.
   */
  ktc: Record<string, KtcValue>;
  /**
   * KTC's rookie-pick rows, as the page delivered them — keyed by season, round
   * and tier rather than by an id, because a pick has none.
   */
  pickKtc: Record<string, KtcValue>;
  /**
   * Which of KTC's two boards this trade's league reads — derived from the
   * league's own lineup, since the stream spans leagues that read different
   * ones and a roster read off the wrong board is wrong at every position. A
   * league whose lineup isn't stored falls to the 1QB board, which is what
   * `isSuperflexLineup` answers for an unknown lineup.
   */
  superflex: boolean;
  /** The league this trade happened in — half of a pick's draft-slot key. */
  leagueId: string;
  /**
   * The page's draft slots, keyed by {@link pickSlotKey} — the same map the card
   * names a pick from, so the price and the label can't disagree about which
   * pick this is.
   */
  pickSlots: Record<string, number>;
  /**
   * How many teams draft in that league, which is what turns a slot into a
   * third of the round. Null where the league list hasn't answered yet, which
   * reads exactly as an unset draft order does: the pick is priced, without a
   * place.
   */
  teams: number | null;
  /**
   * Player id → his row on the ADP board **the panel is showing**, carrying the
   * redraft and dynasty markets side by side the way `/api/adp` answers them. A
   * player that board didn't average — past its tail, or taken in too few of its
   * drafts to have a number worth trusting — is absent rather than zero, which
   * is what lets a haul say how much of itself it managed to price.
   */
  adp: Record<string, AdpPlayerPayload>;
  /**
   * Which of those two markets this trade's league plays in, read from its own
   * `settings.type`. The same shape as `superflex` above and there for the same
   * reason: this board spans every crawled league, and a dynasty roster priced
   * off redraft drafts is a different claim at every line — a rookie is a first-
   * round asset in one market and undrafted in the other.
   */
  adpBoard: AdpBoardType;
  /**
   * The startable pool the value curve is anchored to: this league's teams times
   * its starting slots. Anchoring to the pool rather than to a pick count is
   * what makes a late first worth the same in a 10- and a 14-team league, and it
   * is why this is a fact about the league rather than about the board.
   */
  adpPool: number;
  /**
   * How many times value halves across that pool — the panel's own slider, so
   * flattening the curve reprices every card on the page rather than only the
   * drawer's preview column.
   */
  steepness: number;
  /**
   * The rookie class of the same board, in the order those drafts took them —
   * which *is* the rookie-pick ladder, so a traded pick is priced by the player
   * it buys. Built once per market for the whole page, since it is a fact about
   * the board rather than about a trade; a card reads the one matching
   * {@link adpBoard}. See `./pick-value`.
   */
  adpLadder: readonly RookieLadderRung[];
};

/**
 * Which of KTC's rows prices one of this side's picks, or null where the board
 * has nothing for its season and round.
 *
 * The two facts it needs are on the context rather than the pick, for the reason
 * the slot itself is: where a pick falls belongs to the league's draft, not to
 * the pick, so one map serves every trade naming that roster's pick.
 */
function pickMatch(
  ctx: TradeSideContext,
  pick: TradePickAsset,
): KtcPickMatch | null {
  const slot =
    ctx.pickSlots[pickSlotKey(ctx.leagueId, pick.season, pick.roster_id)] ??
    null;
  const tier =
    slot === null || ctx.teams === null ? null : pickTier(slot, ctx.teams);
  return ktcPickPrice(ctx.pickKtc, pick, tier);
}

/** `"2027 Mid 1st"` — the row a price was read off, as KTC names it. */
function pickRowName(
  pick: TradePickAsset,
  tier: KtcPickTier | null,
): string {
  const third = tier === null ? "" : `${tier[0].toUpperCase()}${tier.slice(1)} `;
  return `${pick.season} ${third}${ordinal(pick.round)}`;
}

/**
 * One line of a haul, as the card lists it and a metric reads it.
 *
 * A discriminated union rather than three parallel readers, so a metric that has
 * something to say about only one kind of asset says so by returning null for
 * the others — and so the card walks one list in one order instead of three.
 */
export type TradeAsset =
  | { kind: "player"; id: string }
  | { kind: "pick"; pick: TradePickAsset }
  | { kind: "faab"; amount: number };

/**
 * What a metric says about one asset, or null where it has nothing to say about
 * that *kind* of asset at all.
 *
 * The two ways of saying nothing are deliberately different, and it is the same
 * distinction the side total's hover already draws. A null cell means the metric
 * does not cover this line — KTC has no opinion on FAAB, so a dash against it
 * would read as a hole in the board rather than as a category it was never in. A
 * cell with a null `text` means the metric *does* cover it and has no number: an
 * unpriced player, or a pick from a draft KTC no longer carries, which is a
 * genuine gap and reads as an em dash.
 */
export type TradeAssetCell = { text: string | null; title: string };

export type TradeMetric = Metric<TradeSideContext> & {
  /** See {@link TradeAssetCell}; absent where the metric has no per-asset form. */
  asset?: (ctx: TradeSideContext, asset: TradeAsset) => TradeAssetCell | null;
};

/**
 * A haul as the lines a card draws for it: players, then picks, then FAAB.
 *
 * One ordering in one place, so the value column beside the names cannot fall
 * out of step with them and so both are read off the same list.
 */
export function bundleAssets(bundle: TradeBundle): TradeAsset[] {
  const assets: TradeAsset[] = bundle.players.map((id) => ({
    kind: "player" as const,
    id,
  }));
  for (const pick of bundle.picks) assets.push({ kind: "pick", pick });
  if (bundle.faab > 0) assets.push({ kind: "faab", amount: bundle.faab });
  return assets;
}

/** Which board a number was read on, for the hovers that have to say. */
function boardName(superflex: boolean): string {
  return superflex ? "superflex board" : "1QB board";
}

/**
 * One player's row on the market his league plays in, or null where the panel's
 * board has no average for him.
 *
 * Two different absences arrive here as one null and that is deliberate: a
 * player past the board's tail and one taken in fewer drafts than `min_picks`
 * are both "this board has no number for him", and the cell says exactly that.
 * What it must never do is read the *other* market's row as a stand-in — the
 * whole reason `/api/adp` answers both is that they are two different games.
 */
function adpStats(ctx: TradeSideContext, id: string): AdpBoardStats | null {
  return ctx.adp[id]?.[ctx.adpBoard] ?? null;
}

/** That row as draft capital, under the panel's own pool and curve. */
function adpPlayerValue(ctx: TradeSideContext, id: string): number | null {
  const stats = adpStats(ctx, id);
  return stats === null ? null : adpValue(stats.adp, ctx.adpPool, ctx.steepness);
}

/** `dynasty` / `redraft`, for the hovers that have to name the market. */
function marketName(board: AdpBoardType): string {
  return board === "dynasty" ? "dynasty" : "redraft";
}

/**
 * What an ADP average rests on, for the per-line hover: the spread it was taken
 * over and how many of that market's drafts stood behind it. The same "state the
 * population" habit `/api/adp` is required to keep wherever its number surfaces
 * — there is no ADP endpoint, so every one of these is an average of the drafts
 * this app happens to have crawled.
 */
function adpSampleTitle(stats: AdpBoardStats, board: AdpBoardType): string {
  return `ADP ${stats.adp.toFixed(1)} on the ${marketName(board)} board · picks ${
    stats.min_pick
  }–${stats.max_pick} over ${stats.picks} draft${stats.picks === 1 ? "" : "s"}`;
}

/**
 * One of this side's picks on the rookie ladder, priced against the same board
 * and curve its players are — see `./pick-value` for why that is one scale and
 * not two.
 */
function adpPickMatch(
  ctx: TradeSideContext,
  pick: TradePickAsset,
): PickAdpResult {
  return pickAdpValue({
    ladder: ctx.adpLadder,
    pick,
    // The same map the card names the pick from, so the price and the label
    // cannot disagree about which pick this is.
    slot:
      ctx.pickSlots[pickSlotKey(ctx.leagueId, pick.season, pick.roster_id)] ??
      null,
    teams: ctx.teams,
    pool: ctx.adpPool,
    steepness: ctx.steepness,
    ktcPicks: ctx.pickKtc,
    superflex: ctx.superflex,
  });
}

/**
 * What a pick's price rests on: the rung it read, and the discount that got it
 * from a pick spendable now to one several drafts out.
 *
 * The rookie is named because that is what the number *is* — a reader who sees
 * 4,800 against a 2028 1st has no way to judge it otherwise, and "≈ the 5th
 * rookie off this board" is the whole of the reasoning in four words.
 */
const ADP_PICK_MISS: Record<PickAdpMiss, (market: string) => string> = {
  "no-ladder": (market) =>
    `No rookies on the ${market} ADP board to rank this pick against`,
  "past-ladder": (market) =>
    `Deeper than the rookie class the ${market} ADP board priced`,
  "no-discount": () => "Too far out — KTC carries no row to discount it by",
};

function adpPickTitle(match: PickAdpMatch, board: AdpBoardType): string {
  const waiting =
    match.base === null
      ? ""
      : ` · ×${match.discount.toFixed(2)} against ${match.base} on KTC`;
  const assumed = match.exact ? "" : " (draft order not set)";
  return `Rookie pick ${match.overall} ≈ ${match.player} on the ${marketName(
    board,
  )} board${waiting}${assumed}`;
}

/**
 * Every metric a trade card's value column can show, in the order the picker
 * lists them: what the haul is worth, then what it is made of.
 *
 * **ADP leads, and it is what a card opens on** — the column used to be KTC's
 * dynasty board and now reads the board the ADP panel in the app bar is
 * showing. The panel was already on this page and narrowed nothing on it: a
 * reader could cut the market to 2024 startups, or to 10-team half-PPR drafts,
 * and every card under it went on quoting one national dynasty board. That is
 * the same two-answers-to-one-question the manager tool's `adp-value` was built
 * to close, arriving on the page whose whole premise is that it spans leagues
 * playing different games. So the season, the window, the draft kind, the size
 * and the format all reach these numbers, and so does the value curve — the
 * drawer's slider reprices the board rather than only its own preview column.
 *
 * **ADP prices the picks too, which is the half that makes it a whole answer.**
 * A board of player prices has no row for a draft pick, and the first cut of
 * this column left them blank on the strength of that — on a board where a
 * first is routinely the whole trade, which is the same mistake the KTC column
 * had already been corrected for. It has no row because it doesn't need one:
 * a rookie pick is a *place in a queue*, and ranking the rookies the selected
 * drafts averaged puts the 1.01 on the first of them. `./pick-value` is that
 * ladder; KTC's rows are read for one thing only, the ratio that says what
 * waiting three drafts costs.
 *
 * KTC stays in the picker beside it as the other lens rather than the other
 * half: it prices the same assets off a *national dynasty* board, where this
 * reads whichever population the reader selected on whichever market the league
 * plays in. Neither total is the other's units, which is why they are two
 * columns and never one blended number — a haul summing a player's KTC price
 * and a pick's ADP value would claim a scale this app nowhere says exists.
 *
 * A partly-priced haul says so in its hover either way — the same habit as the
 * league card's `priced` of `rostered`, and the reason a total is never a zero
 * standing in for an absence.
 */
export const TRADE_METRICS: TradeMetric[] = [
  {
    key: "adp",
    group: "Value",
    label: "ADP",
    cell: (ctx) => {
      const { received, adpBoard } = ctx;
      let total = 0;
      let priced = 0;
      // How many priced lines rest on a stand-in — an unplaced pick taking the
      // middle of its round, or a KTC row for a tier it doesn't publish.
      // Counted rather than flagged so the hover can say how much of the total
      // is an assumption, the same habit the KTC column keeps.
      let assumed = 0;

      for (const id of received.players) {
        const value = adpPlayerValue(ctx, id);
        if (value === null) continue;
        total += value;
        priced += 1;
      }
      for (const pick of received.picks) {
        const match = adpPickMatch(ctx, pick);
        if (match.value === null) continue;
        total += match.value;
        priced += 1;
        if (!match.exact) assumed += 1;
      }

      // Players and picks together: the rookie ladder puts them on one scale, so
      // a haul is priced out of everything in it that could carry a price. FAAB
      // is not — it is the league's own currency and no draft board has ever had
      // an opinion on it.
      const of = received.players.length + received.picks.length;
      const market = marketName(adpBoard);
      return {
        kind: "value",
        // Zero priced assets is not a value of zero, the rule the whole
        // catalogue rests on: it is a haul these drafts have nothing to say
        // about.
        text: priced > 0 ? total.toLocaleString() : null,
        title:
          priced > 0
            ? `Draft capital from crawled ${market} ADP · ${priced} of ${of} asset${
                of === 1 ? "" : "s"
              } priced${
                assumed > 0
                  ? ` · ${assumed} pick${assumed === 1 ? "" : "s"} priced off a stand-in`
                  : ""
              }`
            : of === 0
              ? // A FAAB-only haul, which no board covers at all. Saying so is
                // more use than "nothing priced", which reads as a gap in a
                // board this side's assets were never on.
                "ADP prices players and rookie picks; this side received neither"
              : `Nothing in this haul is priced on the ${market} ADP board`,
      };
    },
    // Per line, on the same board and ladder the total was summed on. A player
    // and a pick each get a cell; **FAAB gets none**, since a dash against it
    // would report a hole in a board it was never on, where the dash on an
    // unpriced player or an unreachable pick is a genuine one.
    asset: (ctx, asset) => {
      const market = marketName(ctx.adpBoard);

      if (asset.kind === "player") {
        const stats = adpStats(ctx, asset.id);
        if (stats === null) {
          return { text: null, title: `Not on the ${market} ADP board` };
        }
        return {
          text: adpValue(stats.adp, ctx.adpPool, ctx.steepness).toLocaleString(),
          title: adpSampleTitle(stats, ctx.adpBoard),
        };
      }

      if (asset.kind === "pick") {
        const match = adpPickMatch(ctx, asset.pick);
        if (match.value === null) {
          // The three ways a pick goes unpriced are worth telling apart: two are
          // facts about the board the panel is showing, which widening it fixes,
          // and one is a fact about how far out the pick is, which no filter
          // will move.
          return { text: null, title: ADP_PICK_MISS[match.reason](market) };
        }
        return {
          text: match.value.toLocaleString(),
          title: adpPickTitle(match, ctx.adpBoard),
        };
      }

      return null;
    },
  },
  {
    key: "ktc",
    group: "Value",
    label: "KTC",
    cell: (ctx) => {
      const { received, ktc, superflex } = ctx;
      let total = 0;
      let priced = 0;
      // How many of the priced lines came off a row that isn't the pick's own
      // tier — see {@link ktcPickPrice}. Counted rather than merely flagged so
      // the hover can say how much of the total rests on a stand-in.
      let assumed = 0;

      for (const id of received.players) {
        const value = ktcBoardValue(superflex, ktc[id]);
        if (value === null) continue;
        total += value;
        priced += 1;
      }
      for (const pick of received.picks) {
        const match = pickMatch(ctx, pick);
        if (!match) continue;
        const value = ktcBoardValue(superflex, match.price);
        if (value === null) continue;
        total += value;
        priced += 1;
        if (!match.exact) assumed += 1;
      }

      // Players and picks together: they are one board now, so a haul is priced
      // out of everything in it that could carry a price. FAAB is not — it is
      // the league's own currency and KTC has never had an opinion on it.
      const of = received.players.length + received.picks.length;
      return {
        kind: "value",
        // Zero priced assets is not a value of zero: it is a haul this board has
        // nothing to say about — a kicker, an IDP, a pick five drafts out.
        text: priced > 0 ? total.toLocaleString() : null,
        title:
          priced > 0
            ? `Dynasty KTC, ${boardName(superflex)} · ${priced} of ${of} asset${
                of === 1 ? "" : "s"
              } priced${
                assumed > 0
                  ? ` · ${assumed} pick${assumed === 1 ? "" : "s"} priced off a stand-in row`
                  : ""
              }`
            : `Nothing in this haul is priced on the ${boardName(superflex)}`,
      };
    },
    // Per line, the same board the total above was summed on. FAAB alone returns
    // null rather than an em dash: it is not an asset this board covers, so a
    // dash against it would report a gap in a board it was never on, where the
    // dash on an unpriced player or pick is a genuine one.
    asset: (ctx, asset) => {
      const { ktc, superflex } = ctx;

      if (asset.kind === "player") {
        const value = ktcBoardValue(superflex, ktc[asset.id]);
        return {
          text: value === null ? null : value.toLocaleString(),
          title:
            value === null
              ? `Not priced on the ${boardName(superflex)}`
              : `Dynasty KTC, ${boardName(superflex)}`,
        };
      }

      if (asset.kind === "pick") {
        const match = pickMatch(ctx, asset.pick);
        const value = match ? ktcBoardValue(superflex, match.price) : null;
        if (!match || value === null) {
          return {
            text: null,
            title: `Not priced on the ${boardName(superflex)}`,
          };
        }
        return {
          text: value.toLocaleString(),
          // The row is named rather than the pick, because it is the row that
          // was priced: a reader who sees "2027 Mid 1st" against a pick whose
          // draft has no order yet can tell the number is the middle of the
          // round and not a claim about where this one lands.
          title: `Dynasty KTC, ${boardName(superflex)} · ${pickRowName(
            asset.pick,
            match.tier,
          )}${match.exact ? "" : " (draft order not set)"}`,
        };
      }

      return null;
    },
  },
  {
    key: "players",
    group: "Haul",
    label: "Players",
    cell: ({ received }) => ({
      kind: "value",
      // A count, so zero is an answer rather than an absence — a side that took
      // only picks received no players, which is a fact about the trade.
      text: String(received.players.length),
      title: `${received.players.length} player${
        received.players.length === 1 ? "" : "s"
      } received`,
    }),
  },
  {
    key: "picks",
    group: "Haul",
    label: "Picks",
    cell: ({ received }) => ({
      kind: "value",
      text: String(received.picks.length),
      title: `${received.picks.length} draft pick${
        received.picks.length === 1 ? "" : "s"
      } received`,
    }),
  },
  {
    key: "faab",
    group: "Haul",
    label: "FAAB",
    cell: ({ received }) => ({
      kind: "value",
      // Unlike the counts, absent rather than `$0`: FAAB moves in a minority of
      // trades, so a zero on every other card is a column spent saying nothing.
      text: received.faab > 0 ? `$${received.faab.toLocaleString()}` : null,
      title:
        received.faab > 0
          ? `$${received.faab.toLocaleString()} FAAB received`
          : "No FAAB moved",
    }),
  },
];

/**
 * The column a trade card opens with — the value the others are context for.
 *
 * It was `ktc`. A stored selection naming a metric this build still holds wins
 * over a default, so a reader who has explicitly picked KTC keeps it, and
 * everyone who never touched the picker gets the board their panel is set to.
 * That is `resolveColumns` behaving exactly as designed, and it is why moving
 * the default is the whole of the migration.
 */
export const DEFAULT_TRADE_COLUMNS: readonly string[] = ["adp"];

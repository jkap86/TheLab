import type { Trade } from "@/shared/trades";

import { shiftDays } from "../shared/date-range.ts";
import { ordinal } from "../shared/format.ts";

/**
 * What narrows the trades list, and the rules for deciding whether a trade
 * passes.
 *
 * Kept apart from the modal that renders it, and pure, for the same reason the
 * league filters are: these are the rules, and they are worth reading and
 * testing without a fetch or a dialog behind them.
 *
 * They are a *different* set from the league filters the page also carries, and
 * the two stay independent on purpose — the same distinction the manager tool
 * draws between its header filters and its ADP drawer. The league filters say
 * which leagues' trades are in the list at all; these say which of those trades
 * are worth looking at. One is about where you play, the other about what
 * happened there.
 */

export type TradeRangePreset = "7d" | "30d" | "90d" | "all" | "custom";

/**
 * When the trade completed. A window rather than a week, because a week is a
 * fact about the NFL schedule and dries up in the offseason — where dynasty
 * leagues trade hardest — while "the last 7 days" is the question the page is
 * usually being asked.
 */
export type TradeRange = {
  preset: TradeRangePreset;
  /** `YYYY-MM-DD`, both inclusive. Read only when `preset` is `"custom"`; either may be null for an open end. */
  from: string | null;
  to: string | null;
};

/**
 * The presets, in the order the modal offers them. `custom` is deliberately not
 * among them: it is what the two date inputs below produce, not a mode to enter
 * first. The relative ones keep earning their place because "Last 30 days" is
 * still the last 30 days tomorrow, where the dates behind it would not be.
 */
export const TRADE_RANGE_PRESETS: {
  value: Exclude<TradeRangePreset, "custom">;
  label: string;
}[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const DEFAULT_TRADE_RANGE: TradeRange = {
  preset: "all",
  from: null,
  to: null,
};

export type TradeFilters = {
  range: TradeRange;
  /** Player ids that must have moved — on either side, see {@link tradeMatches}. */
  players: string[];
  /** Pick assets as `season-round` tokens, e.g. `"2026-1"`. */
  picks: string[];
  /** User ids that must be party to the trade. */
  managers: string[];
  /**
   * Whether a trade has to carry *every* selection or just one of them.
   *
   * Both are real questions and neither is a safe default for the other: "did
   * these two managers trade with each other" and "what have my two rookies
   * been traded for" are `all`, while "show me anything involving any of these
   * three players" is `any`. One control over the whole selection rather than
   * one per category, because a per-category mix ("all of these managers, any of
   * these players") is a sentence nobody can read off a filter bar.
   */
  match: "all" | "any";
};

export const DEFAULT_TRADE_FILTERS: TradeFilters = {
  range: DEFAULT_TRADE_RANGE,
  players: [],
  picks: [],
  managers: [],
  match: "all",
};

/** The window in epoch milliseconds; null on a side it doesn't bound. */
export type TradeBounds = { from: number | null; to: number | null };

/**
 * Resolve a range against today, as instants.
 *
 * Local time, not UTC and not ET: a trade carries an instant, and the day a
 * reader means by "yesterday" is the day where they are. This is the client, so
 * unlike the ADP board — where the same question is answered in SQL because only
 * the database knows the zone to read a bare date in — the reader's own zone is
 * the one in hand.
 *
 * The end bound is the *next* midnight so the named day is included whole, which
 * is the same exclusive-end rule `/api/adp` applies to its dates. The relative
 * presets leave the end open rather than closing it at today, so a trade
 * completed minutes ago can't fall outside "last 7 days" on a clock technicality.
 *
 * `today` is passed in (`YYYY-MM-DD`) rather than read from the clock, so this
 * stays pure and a filter's result changes when the date does rather than on
 * every render.
 */
export function tradeRangeBounds(
  range: TradeRange,
  today: string,
): TradeBounds {
  switch (range.preset) {
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: startOfDay(range.from), to: startOfDay(shiftDay(range.to)) };
    case "7d":
      return { from: startOfDay(shiftDays(today, -6)), to: null };
    case "30d":
      return { from: startOfDay(shiftDays(today, -29)), to: null };
    case "90d":
      return { from: startOfDay(shiftDays(today, -89)), to: null };
  }
}

const shiftDay = (date: string | null) => (date ? shiftDays(date, 1) : null);

/** Local midnight of a `YYYY-MM-DD`; null passes through as an open end. */
function startOfDay(date: string | null): number | null {
  if (!date) return null;
  // No offset in the string, so this parses as local time, which is the point.
  const ms = Date.parse(`${date}T00:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** `{season: "2026", round: 1}` → `"2026-1"`, the token a pick filter holds. */
export function pickToken(pick: { season: string; round: number }): string {
  return `${pick.season}-${pick.round}`;
}

/**
 * `"2026-1"` → `"2026 1st"` — how a pick is spoken about.
 *
 * A token is a season and a round and *not* the roster the pick came from,
 * though the trade carries that: "a 2026 1st" is the asset a reader is looking
 * for, and splitting it twelve ways by origin would make the filter list
 * unreadable while answering a question nobody asks of a whole league's trades.
 * The origin still shows on the trade itself, where it says whose pick moved.
 */
export function pickLabel(token: string): string {
  const [season, round] = token.split("-");
  return `${season} ${ordinal(Number(round))}`;
}

/** Every player, pick token and manager a trade names, on either side. */
export type TradeAssets = {
  players: Set<string>;
  picks: Set<string>;
  managers: Set<string>;
};

/**
 * What a trade contains, pooled across its sides.
 *
 * Pooled on purpose: the filters ask what *moved*, not who ended up with it.
 * Someone looking up a player wants the trade he was in, and having to know
 * which way he went before it will show is a filter that only answers when you
 * already know the answer. Which side each asset landed on is the trade's own
 * display, and it says so there.
 */
export function tradeAssets(trade: Trade): TradeAssets {
  const assets: TradeAssets = {
    players: new Set(),
    picks: new Set(),
    managers: new Set(),
  };
  for (const side of trade.sides) {
    side.players.forEach((id) => assets.players.add(id));
    side.picks.forEach((pick) => assets.picks.add(pickToken(pick)));
    if (side.user_id) assets.managers.add(side.user_id);
  }
  return assets;
}

/**
 * Whether a trade passes the filters, given the window already resolved by
 * {@link tradeRangeBounds} (once per render, rather than per trade).
 *
 * The window always narrows — it is a bound on when, not a selection — so it is
 * applied before `match` is consulted and is never one of the "any" alternatives.
 * A trade Sleeper filed with no timestamp at all is dropped by *any* bound, for
 * the reason `/api/adp` drops an undated draft: there is no honest side of the
 * boundary to put it on. An unbounded range still counts it.
 */
export function tradeMatches(
  trade: Trade,
  filters: TradeFilters,
  bounds: TradeBounds,
): boolean {
  const at = trade.completed_at;
  if (bounds.from !== null && (at === null || at < bounds.from)) return false;
  if (bounds.to !== null && (at === null || at >= bounds.to)) return false;

  const selections = [
    ...filters.players.map((id) => ["players", id] as const),
    ...filters.picks.map((token) => ["picks", token] as const),
    ...filters.managers.map((id) => ["managers", id] as const),
  ];
  if (selections.length === 0) return true;

  const assets = tradeAssets(trade);
  const has = ([kind, value]: readonly [keyof TradeAssets, string]) =>
    assets[kind].has(value);
  return filters.match === "all" ? selections.every(has) : selections.some(has);
}

/** How many filters are narrowing the list — the count on the modal's trigger. */
export function activeTradeFilterCount(filters: TradeFilters): number {
  return (
    (filters.range.preset === "all" ? 0 : 1) +
    filters.players.length +
    filters.picks.length +
    filters.managers.length
  );
}

/**
 * The window in words, for the trigger and the header — the same job
 * `filterSummary` does for the league filters, and lower case for the same
 * reason: it is read mid-sentence. A preset keeps its name; only a custom window
 * spells its dates out, since "Last 30 days" stays true as time passes.
 */
export function tradeRangeLabel(range: TradeRange): string {
  if (range.preset !== "custom") {
    return TRADE_RANGE_PRESETS.find((p) => p.value === range.preset)!.label;
  }
  const { from, to } = range;
  if (from && to) return `${from} – ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Through ${to}`;
  // A custom window with neither end set narrows nothing, so say what it does.
  return "All time";
}

/**
 * The whole selection in words — the window, then what is selected and under
 * which mode, e.g. `"last 30 days · all of 2 managers, 1 player"`.
 *
 * The modal hides its own state, so this is what says outside it not just *that*
 * filters are on (the trigger's count does that) but what they are asking. The
 * match mode has nowhere else to surface at all: "all of" and "any of" are the
 * difference between two very different lists, and a reader who left it on the
 * other one would otherwise have to open the dialog to find out.
 *
 * Lower case because it is read mid-sentence, beside `filterSummary`'s account
 * of the league filters — the same rule, so the two halves of the scope line
 * read as one sentence.
 */
export function tradeFilterSummary(filters: TradeFilters): string {
  const chosen = (
    [
      [filters.managers.length, "manager"],
      [filters.players.length, "player"],
      [filters.picks.length, "pick"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);

  const window = tradeRangeLabel(filters.range).toLowerCase();
  if (chosen.length === 0) return window;
  const mode = filters.match === "all" ? "all of" : "any of";
  return `${window} · ${mode} ${chosen.join(", ")}`;
}

/** One selectable value in a filter list, with how many trades carry it. */
export type TradeOption = {
  value: string;
  label: string;
  /** The dim trailing detail — a player's position and team, a pick's nothing. */
  note?: string;
  /** Trades in the list that name it. */
  count: number;
};

type Labeller = (value: string) => { label: string; note?: string };

/**
 * The options one filter offers, counted over the trades handed in.
 *
 * The caller passes the trades narrowed by *everything except these filters* —
 * the league filters and the date window, but not the selection itself. Counting
 * over the fully filtered list instead would collapse the menu to whatever is
 * already selected the moment you selected it, which is a filter you can't widen
 * without clearing it first.
 *
 * Ordered by count and then by label: the busiest player, the manager who deals
 * most, the pick season everyone is trading. That is the order this list is
 * scanned in, and alphabetical would bury it.
 */
export function tradeOptions(
  trades: readonly Trade[],
  kind: keyof TradeAssets,
  label: Labeller,
): TradeOption[] {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    for (const value of tradeAssets(trade)[kind]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts]
    .map(([value, count]) => ({ ...label(value), value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

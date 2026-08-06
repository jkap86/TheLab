
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
 * **What is left here is the vocabulary, not the matching.** `tradeAssets`,
 * `tradeMatches` and `tradeOptions` used to live beside these — the predicate a
 * trade was judged by and the menu counted off the season — and both now happen
 * in SQL, because the browser no longer holds a season to run them over. Their
 * definitions did not move so much as change language: `tradeMatches` is the
 * selection half of `shared/trades/sql`, and `tradeOptions` is
 * `getTradeFacets`. What stays is what both ends still have to agree on — the
 * shape of a selection, the pick token\u2019s spelling, and how a window resolves
 * against today.
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

/**
 * How close to the reader's own account a trade has to be.
 *
 * **One selection rather than three switches, because the three nest.** Every
 * trade in a league you play in was made by people you play against, and
 * everyone you play against shares a league with you — so
 * `mine ⊆ leaguemates ⊆ leaguemate-leagues`, and independent switches would only
 * ever offer the widest one ticked. What varies is how far out the circle is
 * drawn, which is one question with four answers.
 *
 * It is the one filter on this page the browser cannot resolve for itself: which
 * leagues are yours and who shares them is the database's answer, so the account
 * id and this word are what cross the wire and `shared/trades/circle` turns them
 * into ids. Every other filter here is sent as its own answer.
 *
 * Spelled identically to `shared/trades/params`' own `TradeCircle`, which the
 * compiler does not check — the standing arrangement between these two ends, and
 * the reason both are pure modules with tests.
 */
export type TradeCircle = "all" | "mine" | "leaguemates" | "leaguemate-leagues";

/**
 * The circles, widest last, as the dialog offers them.
 *
 * Each carries what it means in a sentence, because the names alone do not
 * separate the two leaguemate readings: one is about *who was dealing* and the
 * other about *where the deal happened*, and a reader picking between them is
 * picking between "what are the people I play against doing" and "what does the
 * market next to mine look like".
 */
export const TRADE_CIRCLES: {
  value: TradeCircle;
  label: string;
  /** Lower case — read mid-sentence in the page's scope line. */
  summary: string;
  note: string;
}[] = [
  {
    value: "all",
    label: "Every league",
    summary: "every crawled league",
    note: "The whole crawled market.",
  },
  {
    value: "mine",
    label: "My leagues",
    summary: "my leagues",
    note: "Leagues you field a team in.",
  },
  {
    value: "leaguemates",
    label: "Leaguemate trades",
    summary: "leaguemate trades",
    note: "Trades a leaguemate was party to, in any league of theirs.",
  },
  {
    value: "leaguemate-leagues",
    label: "Leaguemate leagues",
    summary: "leaguemate leagues",
    note: "Any league a leaguemate plays in, whoever made the trade.",
  },
];

/**
 * One side of the trade a reader is describing: whose it is, and what it took.
 *
 * **Everything in it is what that side received, and there is no `gave`.** What a
 * side gave up is what the other side received, so "what did jkap give up" is
 * jkap on one side and the player on the other — which is how a direction gets
 * into this vocabulary without a single directional field. `assembleTrade` stores
 * a trade the same way and for the same reason: two halves that can disagree
 * eventually do.
 *
 * **`manager` is one name because a side is one roster.** Two people cannot own
 * one side, which is the thing the old flat `managers[]` could not say — it could
 * only ask "was this person in it", never "what did *he* give *her*".
 *
 * Spelled identically to `shared/trades/params`' `TradeSideQuery`, which the
 * compiler does not check: the standing arrangement between these two ends, and
 * the reason both are pure modules with tests.
 */
export type TradeSideFilter = {
  /** The user id whose side this is, or null for "anyone". */
  manager: string | null;
  /** Player ids that side received. */
  players: string[];
  /** Pick tokens that side received, e.g. `"2026-1"`. */
  picks: string[];
};

/** Which bay a mutation is aimed at. Two on screen; the wire takes more. */
export type SideIndex = 0 | 1;

export type TradeFilters = {
  range: TradeRange;
  /** How close to the reader's account — see {@link TradeCircle}. */
  circle: TradeCircle;
  /**
   * The two bays, always both present and usually mostly empty.
   *
   * **A fixed pair here where the wire takes a list**, and the asymmetry is
   * deliberate: the control is two side plates, so the client always has exactly
   * two to render and never has to reason about an absent one, while
   * `shared/trades/params` parses up to `MAX_TRADE_SIDES` so a third bay is a UI
   * change and not a protocol change. A three-way trade is a real thing this
   * board carries; two is what a reader asks about.
   *
   * **An empty side narrows nothing.** One bay filled is the board this page had
   * before the second one existed — a player named there is "some side received
   * him", which every trade he moved in satisfies.
   */
  sides: readonly [TradeSideFilter, TradeSideFilter];
  /**
   * Whether a side has to have received *all* of the assets named in it or any
   * one of them.
   *
   * It applies **within** a side, which is all it has left to say: which side an
   * asset went to is what the bays express, so there is no across-sides reading
   * of `any` that anybody wants. Drawn only when some bay holds two assets, for
   * the reason `MatchToggle` is drawn only on a second subject — a mode over a
   * set of one has one answer.
   */
  match: "all" | "any";
};

/** A bay with nothing in it, which is the neutral form of the whole control. */
export const EMPTY_SIDE: TradeSideFilter = {
  manager: null,
  players: [],
  picks: [],
};

export const DEFAULT_TRADE_FILTERS: TradeFilters = {
  range: DEFAULT_TRADE_RANGE,
  // The whole market, which is the page's premise: the leagues a reader plays in
  // are a fraction of the trades worth reading, and narrowing back to them is
  // one press away.
  circle: "all",
  sides: [EMPTY_SIDE, EMPTY_SIDE],
  match: "all",
};

/** Nothing named and nothing asked — the state that narrows nothing. */
export function isSideEmpty(side: TradeSideFilter): boolean {
  return (
    side.manager === null && side.players.length === 0 && side.picks.length === 0
  );
}

/** How many assets a bay holds — what the match mode is drawn against. */
export function sideAssetCount(side: TradeSideFilter): number {
  return side.players.length + side.picks.length;
}

/** Replace one bay, leaving the other and everything around it alone. */
export function withSide(
  filters: TradeFilters,
  index: SideIndex,
  side: TradeSideFilter,
): TradeFilters {
  const sides: [TradeSideFilter, TradeSideFilter] = [...filters.sides];
  sides[index] = side;
  return { ...filters, sides };
}

/**
 * Put an asset in a bay, or take it out of one.
 *
 * **An asset moves rather than being duplicated**: naming it on one side and then
 * on the other is a reader changing their mind about which way it went, not a
 * claim that two sides both received it — which is unsatisfiable, so honouring it
 * literally would empty the board with no way to see why.
 */
export function toggleSideAsset(
  filters: TradeFilters,
  index: SideIndex,
  kind: "player" | "pick",
  id: string,
): TradeFilters {
  const key = kind === "player" ? "players" : "picks";
  const held = filters.sides[index][key].includes(id);
  const sides = filters.sides.map((side, at) => {
    if (at === index) {
      return {
        ...side,
        [key]: held ? side[key].filter((v) => v !== id) : [...side[key], id],
      };
    }
    // The other bay gives it up whichever way this went — removing an id it
    // doesn't hold is a no-op, so this needs no condition of its own.
    return { ...side, [key]: side[key].filter((v) => v !== id) };
  }) as [TradeSideFilter, TradeSideFilter];
  return { ...filters, sides };
}

/**
 * Name the manager whose bay this is, or clear it with null.
 *
 * The same move rule as an asset, for a sharper reason: a manager is one *side*,
 * so naming them in both bays asks for a trade someone made with themselves.
 */
export function setSideManager(
  filters: TradeFilters,
  index: SideIndex,
  manager: string | null,
): TradeFilters {
  const sides = filters.sides.map((side, at) =>
    at === index
      ? { ...side, manager }
      : { ...side, manager: side.manager === manager ? null : side.manager },
  ) as [TradeSideFilter, TradeSideFilter];
  return { ...filters, sides };
}

/**
 * Flip the two bays.
 *
 * "Did Darkside give Nabers to jkap" and the reverse are different questions with
 * the same four tokens, so this has to be cheaper than re-picking them — which is
 * the whole argument for the key between the bays.
 */
export function swapSides(filters: TradeFilters): TradeFilters {
  return { ...filters, sides: [filters.sides[1], filters.sides[0]] };
}

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

/**
 * How many filters are narrowing the list — the count on the ledge's trigger.
 *
 * A named manager counts as one, exactly as an asset does: both are one thing the
 * reader picked, and a bay that says "jkap got Nabers" is two narrowings however
 * differently the two are stored.
 */
export function activeTradeFilterCount(filters: TradeFilters): number {
  return (
    (filters.range.preset === "all" ? 0 : 1) +
    (filters.circle === "all" ? 0 : 1) +
    filters.sides.reduce(
      (count, side) =>
        count + (side.manager === null ? 0 : 1) + sideAssetCount(side),
      0,
    )
  );
}

/** Whether either bay says anything — what the empty state's wording turns on. */
export function hasSideSelection(filters: TradeFilters): boolean {
  return filters.sides.some((side) => !isSideEmpty(side));
}

/**
 * How to say what a thing in a bay is called. Ids are all this module holds, and
 * the names live in the page's own lookup maps.
 *
 * A missing name falls back to the id rather than to a placeholder: it is the
 * only true thing available, and a summary reading "1 player" while the bay
 * beside it draws a name was the old shape's tell that it was counting rather
 * than reading.
 */
export type TradeNames = {
  player: (id: string) => string;
  manager: (id: string) => string;
};

/**
 * What a bay is called in prose — the label table, resolved from whoever is
 * standing in *either* bay.
 *
 * Three states and a reader crosses all of them in one search: nobody named
 * reads "one side got", one manager reads "jkap got" on their own bay and
 * "jkap gave" on the other, and a manager in each reads "<name> got" twice.
 *
 * **The bays themselves print `who got` and never `gave`**, because each one
 * carries a who-slot: a bay whose slot says "anyone" cannot also claim to be
 * jkap's giving. This is the *sentence* over both bays at once, where the
 * relation is the thing being described rather than a slot's own contents, and
 * "jkap gave Nabers" is what that relation is called.
 */
export function sideLabel(
  filters: TradeFilters,
  index: SideIndex,
  names: TradeNames,
): string {
  const side = filters.sides[index];
  if (side.manager !== null) return `${names.manager(side.manager)} got`;
  const other = filters.sides[index === 0 ? 1 : 0];
  if (other.manager !== null) return `${names.manager(other.manager)} gave`;
  return index === 0 ? "one side got" : "the other side got";
}

/** A circle in words, lower case — see {@link tradeFilterSummary}. */
export function tradeCircleSummary(circle: TradeCircle): string {
  return TRADE_CIRCLES.find((c) => c.value === circle)!.summary;
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
 *
 * **The circle is deliberately not in here**, though it lives in the same filter
 * set and is edited in the same dialog. What the scope line says is
 * `season · circle · league rules · this`, and the circle belongs at that end of
 * it: it names the *population* the two narrowings then cut down, the same job
 * the literal "every crawled league" used to do in that slot before a reader
 * could change it. See {@link tradeCircleSummary}.
 */
export function tradeFilterSummary(
  filters: TradeFilters,
  names: TradeNames,
): string {
  const window = tradeRangeLabel(filters.range).toLowerCase();
  const selection = sidesSummary(filters, names);
  return selection === null ? window : `${window} · ${selection}`;
}

/**
 * The two bays as one phrase, or null where neither says anything.
 *
 * It reads the bays rather than counting them, which is the whole change: "all of
 * 1 manager, 1 player" described the shape of a selection where "jkap gave Malik
 * Nabers" describes the question. The old wording could not do better — a flat
 * list of ids has no relation in it to spell out.
 *
 * Two shapes, and which one applies is decided by whether any asset was named:
 *
 * - **Nobody named an asset**, so the sentence is about the people: "jkap traded",
 *   or "jkap traded with DarksideEmperors". Naming the bays here would be
 *   describing sides that hold nothing.
 * - **Something was named**, so each bay carrying assets says what it took, under
 *   the label its relation earns it. A bay holding only a manager contributes no
 *   clause of its own — it is already spoken by the other bay's "gave".
 */
function sidesSummary(filters: TradeFilters, names: TradeNames): string | null {
  const [a, b] = filters.sides;
  if (isSideEmpty(a) && isSideEmpty(b)) return null;

  if (sideAssetCount(a) + sideAssetCount(b) === 0) {
    const who = [a.manager, b.manager]
      .filter((id): id is string => id !== null)
      .map(names.manager);
    return who.length === 2
      ? `${who[0]} traded with ${who[1]}`
      : `${who[0]} traded`;
  }

  const join = filters.match === "all" ? " and " : " or ";
  return filters.sides
    .map((side, index) => {
      if (sideAssetCount(side) === 0) return null;
      const assets = [
        ...side.players.map(names.player),
        ...side.picks.map(pickLabel),
      ].join(join);
      return `${sideLabel(filters, index as SideIndex, names)} ${assets}`;
    })
    .filter((clause): clause is string => clause !== null)
    .join(" · ");
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

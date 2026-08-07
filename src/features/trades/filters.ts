
import { shiftDays } from "../shared/date-range.ts";
import { ordinal } from "../shared/format.ts";

/**
 * What narrows the trades list, and the rules for deciding whether a trade
 * passes.
 *
 * Kept apart from the controls that render it, and pure, for the same reason the
 * league filters are: these are the rules, and they are worth reading and
 * testing without a fetch or a control behind them.
 *
 * **What is left here is the vocabulary, not the matching.** `tradeAssets`,
 * `tradeMatches` and `tradeOptions` used to live beside these — the predicate a
 * trade was judged by and the menu counted off the season — and both now happen
 * in SQL, because the browser no longer holds a season to run them over. Their
 * definitions did not move so much as change language: `tradeMatches` is the
 * selection half of `shared/trades/sql`, and `tradeOptions` is
 * `getTradeFacets`. What stays is what both ends still have to agree on — the
 * shape of a selection, the pick token\u2019s spelling, and how a seek resolves
 * against today.
 *
 * They are a *different* set from the league filters the page also carries, and
 * the two stay independent on purpose — the same distinction the manager tool
 * draws between its header filters and its ADP drawer. The league filters say
 * which leagues' trades are in the list at all; these say which of those trades
 * are worth looking at. One is about where you play, the other about what
 * happened there.
 */

/**
 * Where the board starts: a `YYYY-MM-DD` the reader jumped to, or null for the
 * newest trades.
 *
 * **A position rather than a window, and that is the whole of the change from
 * the range it replaced.** The board is a keyset walk newest-first, so "take me
 * to June" is exactly what its cursor already expresses — the read resumes at
 * that date and scrolls back from there, at the same cost on any date as on the
 * first page. A window needed two halves, a preset table and a mode to enter,
 * and answered a question this page's own ordering answers for free: everything
 * older than the date picked is *below* the date picked, which is where a reader
 * scrolling a chronological list expects to find it.
 *
 * **Null rather than today, though the control opens showing today.** No trade
 * completes in the future, so "today" and "the newest trades" are one board —
 * and spelling the default as a date would put a bound on the query string that
 * narrows nothing, splitting the cache into a fresh entry every midnight for an
 * answer that never differs. See {@link tradeSeekBounds}, which folds the two
 * together rather than trusting the caller to.
 */
export type TradeSeek = string | null;

/** The newest trades — the top of the board, which is where it opens. */
export const DEFAULT_TRADE_SEEK: TradeSeek = null;

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
 * The circles **in radius order, narrowest first** — the ordering the control
 * steps through and the pips count along.
 *
 * The order is the type's own claim made concrete: `mine ⊆ leaguemates ⊆
 * leaguemate-leagues ⊆ all`, so reading this table top to bottom is reading the
 * circle being drawn wider. It used to lead with `all` — the default, which is
 * the *widest* — and that was fine while the control was four keys with no
 * ordering to express; a stepper has nowhere to hide an arbitrary order, since
 * "narrower" and "wider" are its two presses.
 *
 * Each carries what it means in a sentence, because the names alone do not
 * separate the two leaguemate readings: one is about *who was dealing* and the
 * other about *where the deal happened*, and a reader picking between them is
 * picking between "what are the people I play against doing" and "what does the
 * market next to mine look like". The control names the circle and the sentence
 * under it says what that name means — so unlike the four keys it replaced,
 * `note` is read on every circle rather than only on the narrow ones.
 */
export const TRADE_CIRCLES: {
  value: TradeCircle;
  label: string;
  note: string;
}[] = [
  {
    value: "mine",
    label: "My leagues",
    note: "Leagues you field a team in.",
  },
  {
    value: "leaguemates",
    label: "Leaguemate trades",
    note: "Trades a leaguemate was party to, in any league of theirs.",
  },
  {
    value: "leaguemate-leagues",
    label: "Leaguemate leagues",
    note: "Any league a leaguemate plays in, whoever made the trade.",
  },
  {
    value: "all",
    label: "Every league",
    note: "The whole crawled market.",
  },
];

/** How far out a circle is drawn, `0` being the narrowest. */
export function circleIndex(circle: TradeCircle): number {
  return TRADE_CIRCLES.findIndex((option) => option.value === circle);
}

/**
 * One notch in or out along the radius — or **null where there is nowhere to
 * go**, which is what the control draws as an inert key.
 *
 * Null rather than clamping, because the two are different answers to the
 * reader: a key that silently re-selects the circle already showing is a press
 * that appears to do nothing, where an unlit key says the board cannot be
 * widened past every league or narrowed past your own.
 *
 * **Whether an account is stored is one of the bounds, not a check the caller
 * makes afterwards.** Every circle but the widest is drawn around a Sleeper
 * account, so with none stored the whole ladder collapses to a single rung —
 * and expressing that here rather than at the control is what keeps the rule in
 * one place. It was previously spelled `option.value !== "all" && account ===
 * null` inside the key that rendered each circle, which worked because there was
 * a key per circle to disable; a stepper has two keys and four values, so the
 * question it asks is "can I move", not "is this one allowed".
 */
export function stepCircle(
  circle: TradeCircle,
  step: 1 | -1,
  hasAccount: boolean,
): TradeCircle | null {
  if (!hasAccount) return null;
  const next = TRADE_CIRCLES[circleIndex(circle) + step];
  return next ? next.value : null;
}

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
  /** Where the board starts, newest-first — see {@link TradeSeek}. */
  seek: TradeSeek;
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
  seek: DEFAULT_TRADE_SEEK,
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

/** Nothing bounded — the whole board, from its newest trade back. */
const OPEN_BOUNDS: TradeBounds = { from: null, to: null };

/**
 * Resolve a seek against today, as instants.
 *
 * **Only the far end is ever bounded.** The board reads newest-first, so a
 * position in it is an upper bound and nothing else: everything older than the
 * date picked stays on the board, below it, which is what makes this a place to
 * scroll from rather than a slice to look at. There is no lower bound to set and
 * no second field to leave half-filled.
 *
 * Three cases fold to the same open answer, and each would otherwise be a
 * different kind of wrong:
 *
 * - **No seek** is the default and the top of the board.
 * - **A seek at or after today** bounds nothing, because no trade completes in
 *   the future — so a reader who picks today is back at the newest trades rather
 *   than on a second cache entry holding the identical board. It is what lets the
 *   control open on today's date without the default carrying a bound.
 * - **A date that doesn't parse** is an unpositioned board, never an empty one.
 *   `NaN` as a bound compares false against every trade, which would clear the
 *   list with nothing on screen to say why.
 *
 * The bound is the *next* midnight so the named day is included whole — the same
 * exclusive-end rule `/api/adp` applies to its dates, and what makes "jump to
 * today" show a trade completed an hour ago.
 *
 * Local time, not UTC and not ET: a trade carries an instant, and the day a
 * reader means by "the 30th" is the day where they are. This is the client, so
 * unlike the ADP board — where the same question is answered in SQL because only
 * the database knows the zone to read a bare date in — the reader's own zone is
 * the one in hand.
 *
 * `today` is passed in (`YYYY-MM-DD`) rather than read from the clock, so this
 * stays pure and the board moves when the date does rather than on every render.
 */
export function tradeSeekBounds(seek: TradeSeek, today: string): TradeBounds {
  // ISO dates sort as strings, which is the whole reason the app spells them
  // this way — no parse is needed to know a seek is not in the past.
  if (seek === null || seek >= today) return OPEN_BOUNDS;
  // Parsed before it is shifted: `shiftDays` builds a `Date` from the result and
  // would throw on an unreadable one, where this hands back the open board.
  if (startOfDay(seek) === null) return OPEN_BOUNDS;
  return { from: null, to: startOfDay(shiftDays(seek, 1)) };
}

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
 * How many filters are narrowing the list — what `Clear` is drawn against.
 *
 * A named manager counts as one, exactly as an asset does: both are one thing the
 * reader picked, and a bay that says "jkap got Nabers" is two narrowings however
 * differently the two are stored.
 *
 * **A seek counts, though it is a position rather than a filter.** Everything
 * newer than the date is off the board while it is set, so it is a narrowing by
 * the only test that matters here — whether `Clear` has something to undo. A
 * reader who jumped back in April and came to the page again in August would
 * otherwise have no one control that puts them back at the top.
 */
export function activeTradeFilterCount(filters: TradeFilters): number {
  return (
    (filters.seek === null ? 0 : 1) +
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

/**
 * The two bays as one phrase, or null where neither says anything.
 *
 * **What it no longer carries is anything a control on the page already says.**
 * It used to lead with the window and the whole line it sits in used to lead with
 * the circle, because both were set inside a modal and a modal hides its own
 * state. Both are keys and a date field on the page now, lit, a few pixels above
 * this line — so restating them here is the league detail panel's dropped team
 * plate again: a panel driven by a selection should not restate the selection.
 *
 * What is left is the one part of this filter set that has nowhere else to
 * surface. The bays print their own tokens, but the *relation* between them —
 * who gave what to whom — is only legible as a sentence, and the match mode is
 * legible nowhere at all: "all of" and "any of" are the difference between two
 * very different lists, and it is set behind a press in the search panel.
 *
 * Lower case because it is read mid-sentence, beside `filterSummary`'s account
 * of the league filters — the same rule, so the two halves of the scope line
 * read as one sentence.
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
export function tradeFilterSummary(
  filters: TradeFilters,
  names: TradeNames,
): string | null {
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

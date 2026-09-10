"use client";

import { useMemo } from "react";

import type {
  SubjectKind,
  WeekReading,
} from "./league-subjects.ts";
import { useLocalValue, writeLocal } from "./local-store.ts";

/*
 * Which readout columns a shares row carries, and in what order, remembered on
 * the device. The storage mechanics live in `local-store.ts`; what is here is
 * only what this key holds and the rules that keep it honest.
 *
 * **It is a sequence, not a set — and that is the one thing it does not share
 * with `lineup-columns.ts`.** The lineup columns are stored as a set and
 * rendered in canonical metric order, because a card's tile row is a strip of
 * equals; these are stored *as ordered* and rendered in that order, because the
 * strip is three keys wide and the reader drags them. So `normalize` here dedupes
 * but never sorts, and the read has to validate the stored array rather than
 * trust it: a hand-edited value, or one written by a build that offered a metric
 * this one does not, must not put a column on screen that nothing can render.
 *
 * It lives in `features/shared` on `lineup-columns.ts`'s terms — a
 * wrapper-over-`local-store` is this folder's pattern to own, `account.ts` being
 * the template — even though only the manager drawers read it today. The one
 * difference from that template is the `.ts` on the `local-store` import, which
 * is the repo's documented exception: the rules below decide what a reader sees
 * and are silent when wrong, so they have to resolve under Node's test runner,
 * which resolves the file it is given and knows nothing of the `@/*` aliases.
 */

const STORAGE_KEY = "thelab:shares-columns";

/**
 * The most columns a row can carry, on a panel that has not said otherwise.
 *
 * Three, and the number is about the row rather than about how many metrics
 * exist: a cell is 3.25–4.75rem, the name beside them has to stay readable, and
 * these drawers are 34rem at their widest. Five options and three slots is the
 * picker doing its job.
 */
export const MAX_SHARES_COLUMNS = 3;

/**
 * The week panel's own cap, which is four because its panel is 40rem.
 *
 * **A per-kind cap rather than a raised global one**, and the reason is in the
 * paragraph above: the number is a fact about the row's width, and the merged
 * week panel is the one panel that is wider. Raising the global to four would
 * let a 34rem manager drawer offer a fourth cell it measurably cannot hold —
 * a regression on a panel this change does not touch, made silently, in the
 * one place a reader would not think to look for it.
 *
 * Four is what its four readings need: the two sides' started and benched
 * counts are one reading split four ways, and a panel showing three of them
 * would be missing a quarter of what it is named for.
 */
const MAX_WEEK_COLUMNS = 4;

/** How many columns this panel's rows can carry. */
export function maxSharesColumns(kind: SubjectKind): number {
  return kind === "week" ? MAX_WEEK_COLUMNS : MAX_SHARES_COLUMNS;
}

/**
 * Every column a shares row can carry, in the order the spare keys offer them.
 *
 * Exhaustive by construction — the `Record` below is what a new id has to be
 * placed in before it compiles, the same seam `LineupMetricId` has on the
 * lineups side.
 */
const COLUMN_LABELS = {
  value: "Value",
  age: "Age",
  class: "Class",
  record: "Rec · Win",
  share: "Share",
  start: "Started",
  bench: "Bench",
  "opp-start": "Opp start",
  "opp-bench": "Opp bench",
} as const;

export type SharesColumnId = keyof typeof COLUMN_LABELS;

export const SHARES_COLUMN_IDS = Object.keys(
  COLUMN_LABELS,
) as SharesColumnId[];

/** The column's name, on the strip, in the Sort track and over its cells. */
export function sharesColumnLabel(id: SharesColumnId): string {
  return COLUMN_LABELS[id];
}

/**
 * What a shares row is wide enough to show, per column.
 *
 * A fixed width per metric rather than a share of the row: the header labels
 * sit *over* the cells they name, in a separate row outside the scroller, so
 * the two only line up if both read the same number.
 */
export const SHARES_COLUMN_WIDTHS: Record<SharesColumnId, string> = {
  value: "4.25rem",
  age: "3.25rem",
  class: "3.75rem",
  record: "4.25rem",
  share: "4.5rem",
  // **76px, and the four move together**, because they are one reading split
  // four ways: the merged panel draws all of them on one line and a cell a
  // quarter-rem narrower than the one beside it would read as a different kind
  // of number. It is what `n/total` plus a trailing percentage needs at
  // `--fs-11` without the two colliding.
  start: "4.75rem",
  bench: "4.75rem",
  "opp-start": "4.75rem",
  "opp-bench": "4.75rem",
};

/**
 * Which column each of the four week readings lights.
 *
 * **The `Record` is the tie**, which is what lets {@link WeekReading} spell
 * itself in the pure module with no imports and still be the same vocabulary as
 * the columns here: a reading renamed on one side stops compiling on the other,
 * rather than quietly lighting the wrong cell. It is an identity map today, and
 * being an identity map is the point rather than an accident to be optimised
 * away.
 */
export const WEEK_READING_COLUMN: Record<WeekReading, SharesColumnId> = {
  start: "start",
  bench: "bench",
  "opp-start": "opp-start",
  "opp-bench": "opp-bench",
};

/**
 * Which group a column belongs to, read as a **run** rather than as a key.
 *
 * The Sort track cuts a groove wherever the value changes down the list of
 * columns on screen, which is the tools tray's own rule one control over: the
 * separator is a property of the vocabulary rather than something a panel
 * passes in, so a track that offers `Started · Bench · Opp start · Opp bench`
 * gets the side boundary without being told where it is, and one that offers
 * three season metrics gets no groove at all.
 */
const COLUMN_GROUP: Record<SharesColumnId, string> = {
  value: "season",
  age: "season",
  class: "season",
  record: "season",
  share: "season",
  start: "mine",
  bench: "mine",
  "opp-start": "theirs",
  "opp-bench": "theirs",
};

/** Whether a groove is cut before this column, given the one before it. */
export function sharesColumnBreak(
  id: SharesColumnId,
  previous: SharesColumnId | undefined,
): boolean {
  return previous !== undefined && COLUMN_GROUP[id] !== COLUMN_GROUP[previous];
}

/**
 * Which columns each drawer can offer.
 *
 * **A `Record` over every {@link SubjectKind}, which is the seam rather than
 * bookkeeping**: a fifth panel does not compile until it has been given
 * columns, exactly as `LineupMetricId` breaks two compiles until a new metric
 * has been placed on both sides of the wire.
 *
 * The leaguemate panel is two of the five season metrics, and the three it
 * drops are not omissions: a value, an age and a draft class are facts about a
 * *player*, and there is no honest number of any of them for a person.
 *
 * The week panel offers neither set. A season's `Rec · Win` and a cross-league
 * `Share` are answers about a whole year, and it counts one week: its four are
 * how many of that week's lineups seated a player and how many left him off, on
 * each side of the games. A metric a panel cannot offer is dropped from a
 * stored selection rather than rendered blank — see {@link sharesColumns}.
 */
export const SHARES_COLUMNS_BY_KIND: Record<
  SubjectKind,
  readonly SharesColumnId[]
> = {
  player: ["value", "age", "class", "record", "share"],
  leaguemate: ["record", "share"],
  // **The one kind with no panel of its own.** A `leaguemate-player` is picked
  // from a chip inside the leaguemate panel's expanded row, so nothing renders
  // a list of them and nothing reads this entry today. It is here because the
  // `Record` is the seam: a kind that compiles without having been given
  // columns is a kind somebody can put in the rack tomorrow and find blank.
  // `share` is what a row of them would carry — how many of the leagues shared
  // with that person hold that player, which is exactly what the chip's own pip
  // already says.
  "leaguemate-player": ["share"],
  // **All four, and the panel's cap is four**, so a first visit shows every
  // one: they are one reading split four ways and a panel opening on three of
  // them would be missing a quarter of what it is named for. See
  // {@link maxSharesColumns}.
  week: ["start", "bench", "opp-start", "opp-bench"],
};

/**
 * The three columns a first visit shows.
 *
 * Value first because it is the figure a dynasty reader opens this panel for,
 * Share last because it is the one with a meter under it and a meter wants the
 * end of the row.
 */
export const DEFAULT_SHARES_COLUMNS: readonly SharesColumnId[] = [
  "value",
  "record",
  "share",
];

/**
 * Fold anything — a drag's result, a stored string's parse — into a valid
 * sequence: known ids only, deduped, **order preserved**, and never empty.
 * Applied on write *and* read so the two ends cannot disagree about what a
 * valid selection is.
 *
 * **It does not cap.** {@link maxSharesColumns} is a bound on how many columns
 * a *panel shows*, not on how many the reader has chosen across all of them:
 * the leaguemate panel offers two of the five, so a stored sequence carrying
 * three player metrics and two of its own is a perfectly valid record of one
 * reader's choices, and truncating it here would have opening one drawer throw
 * away the other's columns. The cap is applied where it means something, in
 * {@link sharesColumns}, and enforced in the strip by disabling.
 */
function normalize(ids: unknown): readonly SharesColumnId[] {
  if (!Array.isArray(ids)) return DEFAULT_SHARES_COLUMNS;
  const known = [
    ...new Set(
      ids.filter(
        (id): id is SharesColumnId =>
          typeof id === "string" && id in COLUMN_LABELS,
      ),
    ),
  ];
  return known.length > 0 ? known : DEFAULT_SHARES_COLUMNS;
}

/** Persist the chosen columns (normalized, see above) and notify readers. */
export function storeSharesColumns(ids: readonly SharesColumnId[]) {
  writeLocal(STORAGE_KEY, JSON.stringify(normalize(ids)));
}

/**
 * The stored sequence — the defaults on the server, on the first client render,
 * and wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 */
export function useSharesColumns(): readonly SharesColumnId[] {
  const raw = useLocalValue(STORAGE_KEY);
  // Parsed in a memo keyed on the raw string, per the store's contract.
  return useMemo(() => {
    if (!raw) return DEFAULT_SHARES_COLUMNS;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return DEFAULT_SHARES_COLUMNS;
    }
  }, [raw]);
}

/**
 * The stored sequence narrowed to what *this* panel can offer and capped at
 * {@link MAX_SHARES_COLUMNS}, never empty.
 *
 * **The fallback is everything the panel offers, not a fixed default and not
 * its last column.** A stored sequence naming nothing this panel can answer is
 * not a preference about this panel at all — it is the reader's answer for a
 * different one — so the honest default is what the panel is *for*, which is
 * every column it has, capped.
 *
 * It used to be the last column alone, on the argument that Share is what the
 * leaguemates panel is most about. **That was wrong for a panel whose columns
 * are a pair**, which is what the two week panels are: `Started` and `Bench`
 * are one reading split in two, and a first visit shown only the second would
 * be a panel silently missing the half it is named for — every reader's first
 * visit, since the stored default is three season metrics and neither week
 * panel offers any of them. The leaguemates panel gains its `Rec · Win` back on
 * the same terms, which is the column it was already offering and already
 * defaulting to whenever anything at all was stored for it.
 *
 * Nothing is written back — the stored sequence is the reader's answer for the
 * panel that can honour it, and rewriting it here would have opening one drawer
 * quietly edit the other.
 */
export function sharesColumns(
  stored: readonly SharesColumnId[],
  kind: SubjectKind,
): readonly SharesColumnId[] {
  const offered = SHARES_COLUMNS_BY_KIND[kind];
  const cap = maxSharesColumns(kind);
  const kept = stored.filter((id) => offered.includes(id)).slice(0, cap);
  return kept.length > 0 ? kept : offered.slice(0, cap);
}

/**
 * One panel's new order, folded back into the sequence both panels share.
 *
 * The naive write — store what this panel shows — is the bug worth naming: the
 * leaguemate panel offers two of the five metrics, so pressing anything in its
 * strip would store two ids and the player panel would come back with Value,
 * Age and Class gone. Nobody edited them.
 *
 * So the ids this panel **cannot** offer are kept, and kept *where they sat*:
 * the new order is spliced in at the position of the first offered id, with the
 * unoffered ones that preceded it still preceding it. A reorder made on one
 * panel therefore moves exactly the columns that panel shows, and the other
 * panel's leading order is undisturbed.
 */
export function mergeSharesColumns(
  stored: readonly SharesColumnId[],
  kind: SubjectKind,
  shown: readonly SharesColumnId[],
): readonly SharesColumnId[] {
  const offered = SHARES_COLUMNS_BY_KIND[kind];
  const pivot = stored.findIndex((id) => offered.includes(id));
  const split = pivot === -1 ? stored.length : pivot;
  const unoffered = (from: number, to: number) =>
    stored.slice(from, to).filter((id) => !offered.includes(id));

  return [
    ...unoffered(0, split),
    ...shown,
    ...unoffered(split, stored.length),
  ];
}

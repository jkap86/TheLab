"use client";

import { useMemo } from "react";

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
 * The most columns a row can carry.
 *
 * Three, and the number is about the row rather than about how many metrics
 * exist: a cell is 3.25–4.5rem, the name beside them has to stay readable, and
 * the drawer is 34rem at its widest. Five options and three slots is the picker
 * doing its job.
 */
export const MAX_SHARES_COLUMNS = 3;

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
};

/** Which of the two shares panels is asking. */
export type SharesPanelKind = "player" | "leaguemate";

/**
 * Which columns each drawer can offer.
 *
 * The leaguemate panel is two of the five, and the three it drops are not
 * omissions: a value, an age and a draft class are facts about a *player*, and
 * there is no honest number of any of them for a person. A metric a panel
 * cannot offer is dropped from a stored selection rather than rendered blank —
 * see {@link sharesColumns}.
 */
export const SHARES_COLUMNS_BY_KIND: Record<
  SharesPanelKind,
  readonly SharesColumnId[]
> = {
  player: ["value", "age", "class", "record", "share"],
  leaguemate: ["record", "share"],
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
 * **It does not cap.** {@link MAX_SHARES_COLUMNS} is a bound on how many
 * columns a *panel shows*, not on how many the reader has chosen across both:
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
 * **The fallback is the panel's last available column, not a fixed one.** A
 * reader whose stored sequence is all three player metrics opens the
 * leaguemates drawer and would otherwise be shown nothing; they get Share,
 * which is the column that panel is most about. Nothing is written back — the
 * stored sequence is the reader's answer for the panel that can honour it, and
 * rewriting it here would have opening one drawer quietly edit the other.
 */
export function sharesColumns(
  stored: readonly SharesColumnId[],
  kind: SharesPanelKind,
): readonly SharesColumnId[] {
  const offered = SHARES_COLUMNS_BY_KIND[kind];
  const kept = stored
    .filter((id) => offered.includes(id))
    .slice(0, MAX_SHARES_COLUMNS);
  return kept.length > 0 ? kept : [offered[offered.length - 1]];
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
  kind: SharesPanelKind,
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

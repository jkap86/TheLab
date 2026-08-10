/**
 * What a windowed shares list is made of: the row geometry, and the virtualizer
 * options both share views hand to `@tanstack/react-virtual`.
 *
 * It is a module of its own for the reason the ADP board's constants are: a
 * windowed list is arithmetic before it is markup — how tall a row is assumed to
 * be, how many are held either side of the fold, and *what identifies one* — and
 * none of that is reachable from a component this codebase has no DOM to mount.
 * Pure and with no runtime imports, so `tsx --test` can drive a real
 * `Virtualizer` against the same options the component builds and assert the
 * window it produces rather than a retyped copy of the rules.
 */

/**
 * The air between two cards, in px — the `gap-4` the unwindowed list wears.
 *
 * It is the virtualizer's own `gap` option rather than padding inside the
 * measured box, and that is not a preference. A share card *is* its `<li>`: the
 * border, the gradient and the rounded corners are on the element the
 * virtualizer measures, so padding for the gap would land inside the card's
 * visible surface and make every row 16px taller than it looks. `gap` is added
 * between items when the offsets are computed and belongs to neither of them,
 * which is exactly what a flex `gap` does — so the windowed list and the plain
 * one lay out identically.
 */
export const SHARE_ROW_GAP = 16;

/**
 * A first guess at a collapsed card's height, replaced by a real measurement the
 * moment the card mounts.
 *
 * It is measured rather than guessed, and the number is the *phone's*: below
 * `sm` the card stacks — the name line over the four stat columns, with `gap-3`
 * between them and `py-3` either side — and comes to 90px at 375 and 390 wide.
 * From `sm` up the two halves share a row and a card measures 58, so the
 * scrollbar settles *shorter* than it starts on a laptop and lands within two
 * pixels a row on a phone. That is the right way round: the mobile browse is the
 * one this windowing exists for, and it is where an estimate being wrong costs
 * the most scrolling to correct.
 *
 * Only the scrollbar is ever wrong about it — every mounted row is measured, so
 * nothing a reader can see is laid out on this number.
 */
export const SHARE_ROW_ESTIMATE = 88;

/**
 * How many cards are mounted either side of the visible window.
 *
 * Six is roughly half a screen of collapsed rows at this estimate, which is what
 * a flick covers between the scroll event and the render that answers it. It is
 * also what absorbs the one approximate number in the arithmetic: the list sits
 * inside the well's own padding, so `scrollMargin` is measured rather than known
 * ahead of time, and a row or two of slack keeps a late measurement invisible.
 */
export const SHARE_ROW_OVERSCAN = 6;

/**
 * The scroll box the virtualizer assumes before it has measured the real one.
 *
 * It matters only where there is nothing to measure — a static render, which is
 * how this list is tested — since in a browser the measurement lands before the
 * first paint. Zero (the library's default) makes the range come out *empty*, so
 * a server-rendered list would be no rows at all rather than a screenful; 640px
 * is a plausible sheet, and being wrong about it costs one over-rendered frame.
 */
export const SHARE_LIST_INITIAL_RECT = { width: 0, height: 640 };

/** The options a windowed shares list drives its virtualizer with. */
export type ShareWindowOptions = {
  count: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string;
  overscan: number;
  gap: number;
  initialRect: { width: number; height: number };
};

/**
 * The virtualizer's options for a list of `rows` identified by `rowKey`.
 *
 * **The key is the row's own domain id — a `player_id` or a `user_id` — and
 * never its index.** Everything the virtualizer remembers about a row is filed
 * under it: the measured height, and the element it is observing for resizes.
 * Keyed by position, typing into the sheet's search field would hand every row
 * the height of whoever used to sit at its index — an expanded card's height
 * landing on a collapsed one two hundred rows away, which is the gap-and-overlap
 * failure windowing is otherwise free of. Keyed by the player, a filter is just
 * a shorter list of rows the virtualizer already knows the size of.
 *
 * The bounds check is not defensive noise: `count` and `rows` are set from the
 * same array on the same render, but the virtualizer holds its options across
 * one and can ask about an index the list has since lost.
 */
export function shareWindowOptions<T>(
  rows: readonly T[],
  rowKey: (row: T) => string,
): ShareWindowOptions {
  return {
    count: rows.length,
    estimateSize: () => SHARE_ROW_ESTIMATE,
    getItemKey: (index) => {
      const row = rows[index];
      return row ? rowKey(row) : `#${index}`;
    },
    overscan: SHARE_ROW_OVERSCAN,
    gap: SHARE_ROW_GAP,
    initialRect: SHARE_LIST_INITIAL_RECT,
  };
}

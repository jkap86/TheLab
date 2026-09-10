"use client";

// Relative with an explicit extension, the way `summary-readings.ts` beside it
// reaches the same store: the parse below is read by Node's own test runner,
// which resolves neither the `@/*` aliases nor an extensionless specifier.
import { useLocalValue, writeLocal } from "./local-store.ts";

// Whether the gametime page's stat board is up, remembered on the device. The
// storage mechanics live in `local-store.ts`; what is here is only the key, the
// wrapper and the rule that keeps the value honest, on `summary-readings.ts`'s
// and `ktc-board.ts`'s exact terms.
//
// **It persists for the same courtesy the theme toggle gets**: a reader who
// works with the board up should not have to raise it on every visit, and
// raising it is a 340ms animation over the whole viewport rather than a press
// nobody notices. Nothing else about the board persists — the search, the
// position, the team and the sort are all a lookup rather than a place, and a
// board that came back narrowed to a receiver nobody remembers picking is
// worse than one that comes back at rest.
//
// **It is deliberately not in the URL**, which is the other place a reader's
// state could live on this page (`?league=`, `?week=`). A stat board is a
// reference table that acts on nothing, so putting it in the address bar would
// put it in the back stack — and a Back press that closed a table rather than
// leaving the page is the kind of thing `useActiveCard` takes on for a *card*
// precisely because a card is a place.
//
// **It lives in `features/shared` rather than beside its one reader** for the
// one reason that folder's rule allows: `local-store.ts` is out of the barrel,
// so it may only be reached by its own siblings. A feature-local wrapper would
// have to deep-import it.
//
// Default closed: a page whose first paint was a full-height table over the
// league cards would be a page about the table.
const STORAGE_KEY = "thelab:stat-board";

const OPEN = "1";
const SHUT = "0";

/**
 * The stored answer, or the default where nothing valid is stored.
 *
 * Exported for the test: a value read as open when it was written as shut is a
 * board that will not stay down, with a green suite behind it.
 */
export function parseStatBoardOpen(raw: string | null): boolean {
  return raw === OPEN;
}

/** Persist whether the board is up, and notify readers. */
export function storeStatBoardOpen(open: boolean) {
  writeLocal(STORAGE_KEY, open ? OPEN : SHUT);
}

/**
 * Whether the board is up — `false` on the server, on the first client render,
 * and wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 *
 * That trade is *why* the height is a transition rather than a jump: a stored
 * `open` arrives one frame after paint, and what a reader sees is the board
 * rising as the page settles rather than a table appearing under them.
 */
export function useStatBoardOpen(): boolean {
  return parseStatBoardOpen(useLocalValue(STORAGE_KEY));
}

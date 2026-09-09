"use client";

// Relative with an explicit extension, the way `lineup-columns.ts` beside it
// reaches the same store: the parse below is read by Node's own test runner,
// which resolves neither the `@/*` aliases nor an extensionless specifier.
import { readLocal, useLocalValue, writeLocal } from "./local-store.ts";

// Whether an **open** league card keeps its summary readings on screen — the
// manager card's standing strip and four rank windows, the lineup checker's
// projection strip and four check windows — remembered on the device. The
// storage mechanics live in `local-store.ts`; what is here is only the key, the
// wrapper and the one rule that keeps the value honest, on `ktc-board.ts`'s
// and `account.ts`'s exact terms.
//
// **One boolean per device, not per card, and one key for both pages.** An
// open card is the screen: the list stands down around it and the page stops
// scrolling, so every pixel the summary keeps is a row the two panes under it
// do not get. The readings folded here are the two that are only useful on a
// *shut* card — a standing beside a hundred other standings, four checks
// scanned down a column — and a reader who wants them back while a card is
// open wants them back on `/lineupchecker` as readily as on `/manager`. The
// two cards are one object seen from two tools; a preference that held on one
// and not the other would be the drift the convergence pass removed, one
// setting deep.
//
// **Default off: the fold is the point.** A stored value is read as the two
// literal strings this writes and nothing else, so a hand-edited or stale key
// falls back to the fold rather than to whatever `Boolean()` makes of it.
const STORAGE_KEY = "thelab:card-summary-readings";

const SHOWN = "1";
const FOLDED = "0";

/**
 * The stored answer, or the default where nothing valid is stored.
 *
 * Exported for the test: it is the whole of what this module decides, and a
 * value read as shown when it was written as folded would be a card that
 * refuses to fold with a green suite behind it.
 */
export function parseSummaryReadings(raw: string | null): boolean {
  return raw === SHOWN;
}

/** Persist whether an open card shows its summary readings, and notify readers. */
export function storeSummaryReadings(shown: boolean) {
  writeLocal(STORAGE_KEY, shown ? SHOWN : FOLDED);
}

/**
 * Flip the stored answer.
 *
 * Reads the store rather than a value the caller closed over, so the handler a
 * page hands to a hundred `memo`'d cards is one module-level function with no
 * dependency to change under it — a `useCallback` over the current value would
 * be a new identity on every toggle, and every card on the page re-rendered to
 * move the one that is open.
 */
export function toggleSummaryReadings() {
  storeSummaryReadings(!parseSummaryReadings(readLocal(STORAGE_KEY)));
}

/**
 * Whether an open card shows its summary readings — `false` on the server, on
 * the first client render, and wherever nothing valid is stored (the documented
 * `local-store` trade: a stored choice swaps in after hydration).
 *
 * No `useMemo`: the value is derived from a string with one comparison, and
 * `useSyncExternalStore`'s identity check already holds on the string.
 */
export function useSummaryReadings(): boolean {
  return parseSummaryReadings(useLocalValue(STORAGE_KEY));
}

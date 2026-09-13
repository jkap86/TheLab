"use client";

// Relative with an explicit extension, the way `stat-board-open.ts` beside it
// reaches the same store: the two parsers below are read by Node's own test
// runner, which resolves neither the `@/*` aliases nor an extensionless
// specifier.
import { useLocalValue, writeLocal } from "./local-store.ts";

// Whether the manager page's shares console is up, and which of its two lists
// it is showing. The storage mechanics live in `local-store.ts`; what is here
// is only the keys, the wrappers and the rules that keep the values honest —
// `stat-board-open.ts`'s exact terms, one page over.
//
// **The open flag persists for the same courtesy the theme toggle gets**: a
// reader who works with the console up should not have to raise it on every
// visit, and raising it is a 340ms animation over most of the viewport rather
// than a press nobody notices.
//
// **The tab persists and nothing else does.** Which of the two lists a reader
// reaches for is a device preference in the sense the theme is — somebody who
// opens this panel to find leaguemates opens it to find leaguemates — where
// the query, the sort, the picked row and the facets are all *ways of reading
// a list* and come back at rest. That is `SharesDrawer`'s own call about
// `sort`, and the handoff names the tab as "a device preference at most".
//
// **Neither is in the URL**, which is the other place a reader's state could
// live on this page (`?league=`). A shares console is a control over the grid
// rather than a place in it, so putting it in the address bar would put it in
// the back stack — and a Back press that closed a panel rather than leaving
// the page is the kind of thing `useActiveCard` takes on for a *card*
// precisely because a card is a place. The *narrowing* the console applies is
// not stored either, and deliberately: it is `subjects`, it is named by
// `SubjectTokens` above the grid, and it is undone there.
const OPEN_KEY = "thelab:shares-console";
const TAB_KEY = "thelab:shares-console-tab";

const OPEN = "1";
const SHUT = "0";

/** Which list the console is showing — the two tabs on the bar. */
export type SharesTab = "player" | "leaguemate";

/**
 * The stored answer, or the default where nothing valid is stored.
 *
 * Exported for the test: a value read as open when it was written as shut is a
 * console that will not stay down, with a green suite behind it.
 */
export function parseSharesConsoleOpen(raw: string | null): boolean {
  return raw === OPEN;
}

/**
 * The stored tab, or `player` where nothing valid is stored.
 *
 * **Players is the default rather than the last-written**, for the reason that
 * list is the one the page's own subject narrowing is usually built from: a
 * console that opened on a vocabulary nobody asked for costs a press, and this
 * one costs nothing to be wrong about.
 */
export function parseSharesTab(raw: string | null): SharesTab {
  return raw === "leaguemate" ? "leaguemate" : "player";
}

/** Persist whether the console is up, and notify readers. */
export function storeSharesConsoleOpen(open: boolean) {
  writeLocal(OPEN_KEY, open ? OPEN : SHUT);
}

/** Persist which list it shows, and notify readers. */
export function storeSharesTab(tab: SharesTab) {
  writeLocal(TAB_KEY, tab);
}

/**
 * Whether the console is up — `false` on the server, on the first client
 * render, and wherever nothing valid is stored (the documented `local-store`
 * trade: a stored choice swaps in after hydration).
 *
 * That trade is *why* the height is a transition rather than a jump: a stored
 * `open` arrives one frame after paint, and what a reader sees is the console
 * rising as the page settles rather than a panel appearing under them.
 */
export function useSharesConsoleOpen(): boolean {
  return parseSharesConsoleOpen(useLocalValue(OPEN_KEY));
}

/** Which list it shows — `player` until a stored choice arrives. */
export function useSharesTab(): SharesTab {
  return parseSharesTab(useLocalValue(TAB_KEY));
}

"use client";

// Relative with an explicit extension, the way `stat-board-open.ts` and
// `shares-console-open.ts` beside it reach the same store: the parse below is
// read by Node's own test runner, which resolves neither the `@/*` aliases nor
// an extensionless specifier.
import { useLocalValue, writeLocal } from "./local-store.ts";

// Whether the lineup checker's start/sit console is up, remembered on the
// device. The storage mechanics live in `local-store.ts`; what is here is only
// the key, the wrapper and the rule that keeps the value honest — the exact
// terms `stat-board-open.ts` and `shares-console-open.ts` are written on.
//
// **A key of its own rather than a share of the manager console's**, and the
// two are not the same question. `thelab:shares-console` says whether a reader
// wants the *shares* panel up over a season's league grid; this says whether
// they want a *week's* start/sit calls up over the checker's. They are two
// panels on two pages answering two questions, and a reader who works with one
// raised has said nothing about the other — where the league *filters* are
// deliberately one key across the three tools, because a narrowing is a
// vocabulary and `dynasty` means the same thing of anybody's leagues.
//
// **It persists for the same courtesy the theme toggle gets**: a reader who
// works with the console up should not have to raise it on every visit, and
// raising it is a 340ms animation over most of the viewport rather than a
// press nobody notices. Nothing else about the console persists — the query,
// the sort, the picked row and the open trays are all *ways of reading a list*
// and come back at rest, which is `SharesDrawer`'s own call about `sort`.
//
// **It is deliberately not in the URL**, which is the other place a reader's
// state could live on this page (`?league=`, `?week=`). A start/sit console is
// a control over the grid rather than a place in it, so putting it in the
// address bar would put it in the back stack — and a Back press that collapsed
// a panel rather than leaving the page is the kind of thing `useActiveCard`
// takes on for a *card* precisely because a card is a place. The **narrowing**
// the console applies is not stored either, and deliberately: it is
// `subjects`, it is named by `SubjectTokens` above the grid, and it is undone
// there.
//
// **It also drives the page's latch**, which is the one thing it does beyond
// saying where the panel is: `entries` and `weekSubjectRolls` are a walk over
// every player of every roster on the account, so the page builds neither
// until this has been true once. The latch never goes back, so a picked
// subject keeps narrowing the grid after the console comes down.
//
// Default closed: a page whose first paint was a 62dvh panel over the league
// cards would be a page about the panel.
const STORAGE_KEY = "thelab:start-sit-console";

const OPEN = "1";
const SHUT = "0";

/**
 * The stored answer, or the default where nothing valid is stored.
 *
 * Exported for the test: a value read as open when it was written as shut is a
 * console that will not stay down, with a green suite behind it.
 */
export function parseStartSitConsoleOpen(raw: string | null): boolean {
  return raw === OPEN;
}

/** Persist whether the console is up, and notify readers. */
export function storeStartSitConsoleOpen(open: boolean) {
  writeLocal(STORAGE_KEY, open ? OPEN : SHUT);
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
export function useStartSitConsoleOpen(): boolean {
  return parseStartSitConsoleOpen(useLocalValue(STORAGE_KEY));
}

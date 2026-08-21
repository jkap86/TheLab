/**
 * What the browser does with an answer that arrived **partly unanswered**.
 *
 * Five of this app's reads carry a bonus computed beside their subject — the
 * manager's projected ranks, the lineup solve behind the KTC and ADP starter
 * splits, League Details' two price columns, and the lineup checker's week — and
 * every one of them is deliberately allowed to fail on its own, because the
 * answer around it is still worth having. What was missing is the other half of
 * that bargain: a section that could not be computed has to stay *retryable*.
 *
 * A `200` is a success to React Query, so a payload carrying a failed section
 * was held for its query's whole stale time — five minutes for the ranks, fifteen
 * for the KTC and ADP valuations — and every consumer inside that window read a
 * blank column as a fact. The retry never ran, because nothing had failed; the
 * revalidation never ran, because the entry was fresh.
 *
 * {@link degradedStaleTime} is the fix and it is one line per read: a payload
 * whose status says a section failed is worth **zero** milliseconds, so it is on
 * screen (the columns it filled are still drawn from it) and simultaneously
 * stale, which is what makes the next mount, the next reconnect and the next
 * consumer of the key re-ask. A payload that is merely *empty* keeps its full
 * stale time, which is the distinction the statuses exist to carry.
 *
 * **Zero rather than a short window**, because there is no interval that is
 * right: the read failed for a reason this layer cannot see, and the cheapest
 * honest thing is to let the *next* thing that needs it find out. Nothing here
 * schedules a refetch of its own — a stale entry with no observer costs nothing,
 * and a poll would turn one busy database into a page hammering it.
 *
 * Pure, with every payload arriving as an erased `import type`, so the
 * predicates below are driven directly by the runner alongside the query tests
 * that hash these keys.
 */

import type {
  LeagueValuesPayload,
  ManagerAdpValuePayload,
  ManagerKtcPayload,
  ManagerMatchupsPayload,
  ManagerRanksPayload,
} from "@/shared/contract";

/**
 * Just enough of a React Query `Query` to read the data off it.
 *
 * Written structurally rather than imported so this module stays free of runtime
 * imports — and a function taking *less* than a `Query` is assignable wherever
 * one taking a `Query` is, so the hooks below hand it straight to `staleTime`.
 */
export type DataHolder<T> = { state: { data?: T | undefined } };

/**
 * A stale time that collapses to zero once the answer says something in it
 * failed.
 *
 * `fresh` is the read's ordinary window — the one every non-degraded answer
 * keeps, and the one whose ordering against the server-side TTL behind it is
 * asserted in `cache-layering.test.ts`. Nothing about that ordering changes: a
 * degraded payload is not a shorter-lived version of a good one, it is an answer
 * this layer must not remember at all.
 */
export function degradedStaleTime<T>(
  fresh: number,
  degraded: (data: T) => boolean,
): (query: DataHolder<T>) => number {
  return (query) => {
    const data = query.state.data;
    return data !== undefined && degraded(data) ? 0 : fresh;
  };
}

/**
 * The projected ranks failed — and `"skipped"` is emphatically not that.
 *
 * A `?projections=0` payload is the cheap answer a reader whose columns name no
 * projected metric actually asked for; treating it as degraded would make the
 * commonest ranks read in the app permanently stale and re-fetched on every
 * mount.
 */
export const ranksDegraded = (data: ManagerRanksPayload): boolean =>
  data.projections === "error";

/** The lineup solve behind every KTC `split` and starter rank failed. */
export const ktcDegraded = (data: ManagerKtcPayload): boolean =>
  data.lineups === "error";

/** The same solve, behind the ADP valuation's splits and ranks. */
export const adpValueDegraded = (data: ManagerAdpValuePayload): boolean =>
  data.lineups === "error";

/**
 * Either price lens on a League Details panel failed.
 *
 * One predicate for both because they share an entry: the two lenses are one
 * request and one cache key, so whichever of them failed, the entry holding it
 * is the one that must not be kept. The *payload* still tells the two apart —
 * a KTC outage leaves every ADP number intact and vice versa, which is what
 * {@link valuesFailures} names for the reader.
 */
export const valuesDegraded = (data: LeagueValuesPayload): boolean =>
  data.ktc_status === "error" || data.adp_status === "error";

/** The lineup checker's week solve failed. */
export const matchupsDegraded = (data: ManagerMatchupsPayload): boolean =>
  data.projections === "error";

/**
 * Which sections of the manager leagues list could not be computed, named as a
 * reader would name the columns they fill.
 *
 * Not counted — named. A reader looking at a row of em dashes needs to know
 * *which* numbers are missing and that they are missing rather than zero; how
 * many reads were involved is this app's business.
 */
export function managerFailures(sections: {
  ranks: ManagerRanksPayload | null;
  ktc: ManagerKtcPayload | null;
  adp: ManagerAdpValuePayload | null;
}): string[] {
  const failed: string[] = [];
  if (sections.ranks && ranksDegraded(sections.ranks))
    failed.push("projected points");
  if (sections.ktc && ktcDegraded(sections.ktc)) failed.push("KTC starter splits");
  if (sections.adp && adpValueDegraded(sections.adp))
    failed.push("ADP starter splits");
  return failed;
}

/** The same, for one League Details panel's two price lenses. */
export function valuesFailures(values: LeagueValuesPayload | null): string[] {
  if (!values) return [];
  const failed: string[] = [];
  if (values.ktc_status === "error") failed.push("KTC values");
  if (values.adp_status === "error") failed.push("ADP values");
  return failed;
}

/**
 * The sentence a panel shows beside content it can still draw, or null when
 * there is nothing to say.
 *
 * **Beside, never instead of.** Every read this can describe is a bonus on top
 * of something already on screen, so the failure is a line above the list rather
 * than a dialog or a replacement for it — the call `manager-players` already
 * makes for a failed background refetch, and the one the lineup checker makes
 * for a failed matchups read.
 *
 * It says the two things a reader can act on: that the blanks are a shortfall
 * rather than a zero, and that nothing needs pressing — the entry is stale, so
 * the next read of it re-asks.
 */
export function degradedNotice(failed: readonly string[]): string | null {
  if (failed.length === 0) return null;
  return `Couldn't load ${joinList(failed)} — those columns read blank rather than zero, and will be re-read.`;
}

/** `a`, `a and b`, `a, b and c` — the app's own comma-and-and. */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
